import { cmd } from "@/cli/cmd/cmd"
import { Rpc } from "@/util/rpc"
import { type rpc } from "./worker"
import path from "path"
import { fileURLToPath } from "url"
import { UI } from "@/cli/ui"
import { Log } from "@/util/log"
import { Env } from "@/util/env"
import { withTimeout } from "@/util/timeout"
import { withNetworkOptions, resolveNetworkOptions } from "@/cli/network"
import { Filesystem } from "@/util/filesystem"
import type { Event } from "@ax-code/sdk/v2"
import type { EventSource } from "./context/sdk"
import { win32DisableProcessedInput, win32InstallCtrlCGuard } from "./win32"
import { TuiConfig } from "@/config/tui"
import { Instance } from "@/project/instance"
import { writeHeapSnapshot } from "v8"
import { DiagnosticLog } from "@/debug/diagnostic-log"
import { internalBaseUrl } from "@/util/internal-url"
import type { StreamConnectionStatus } from "./util/resilient-stream"
import { runtimeMode } from "@/installation/runtime-mode"
import { spawn } from "node:child_process"

declare global {
  const AX_CODE_WORKER_PATH: string
}

type RpcClient = ReturnType<typeof Rpc.client<typeof rpc>>
const log = Log.create({ service: "tui.thread" })

export const DEFAULT_TUI_WORKER_READY_TIMEOUT_MS = 10_000

type BackendTransport = "worker" | "process"
type RpcWireTarget = {
  postMessage: (data: string) => void | null
  onmessage: ((ev: MessageEvent<any>) => any) | null
}

type BackendRuntime = {
  mode: BackendTransport
  target: string
  pid?: number
  wire: RpcWireTarget
  terminate: () => void
}

export function tuiWorkerReadyTimeoutMs(env: Record<string, string | undefined> = process.env) {
  const value = env.AX_CODE_TUI_WORKER_READY_TIMEOUT_MS
  if (!value) return DEFAULT_TUI_WORKER_READY_TIMEOUT_MS
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : DEFAULT_TUI_WORKER_READY_TIMEOUT_MS
}

function tuiBackendTransport(env: Record<string, string | undefined> = process.env): BackendTransport {
  const requested = env.AX_CODE_TUI_BACKEND_TRANSPORT
  if (requested === "worker" || requested === "process") return requested
  return runtimeMode() === "compiled" ? "process" : "worker"
}

function backendProcessCommand() {
  if (runtimeMode() === "compiled") {
    return {
      command: process.execPath,
      args: ["tui-backend", "--stdio"],
      label: `${process.execPath} tui-backend --stdio`,
    }
  }

  const entry = process.argv[1]
  if (!entry) throw new Error("Cannot start TUI backend process: missing CLI entrypoint")
  const resolvedEntry = path.isAbsolute(entry) ? entry : path.resolve(process.cwd(), entry)
  return {
    command: process.execPath,
    args: ["--conditions=browser", resolvedEntry, "tui-backend", "--stdio"],
    label: `${process.execPath} --conditions=browser ${resolvedEntry} tui-backend --stdio`,
  }
}

function isBackendProtocolMessage(line: string) {
  let parsed: unknown
  try {
    parsed = JSON.parse(line)
  } catch {
    return false
  }
  if (!parsed || typeof parsed !== "object") return false
  const type = (parsed as { type?: unknown }).type
  return type === "rpc.result" || type === "rpc.error" || type === "rpc.event"
}

function createProcessWire(child: any, target: string): RpcWireTarget {
  const wire: RpcWireTarget = {
    onmessage: null,
    postMessage(data) {
      const stdin = child.stdin
      if (!stdin || stdin.destroyed) {
        // Pipe is gone (child exited / stdin closed). Mark the wire dead
        // so the RPC client's pending-call timeout fires immediately
        // instead of waiting 60s for a response that will never arrive.
        wire.onmessage = null
        DiagnosticLog.recordProcess("tui.backendStdinUnavailable", { target })
        return
      }
      try {
        stdin.write(data + "\n")
      } catch (error) {
        wire.onmessage = null
        DiagnosticLog.recordProcess("tui.backendStdinWriteFailed", { target, error })
        Log.Default.warn("TUI backend stdin write failed", {
          target,
          error: error instanceof Error ? error.message : String(error),
        })
      }
    },
  }
  // Stream-level "error" events (EPIPE, broken pipe on SIGKILL, etc.)
  // crash the parent process if no listener is attached. These pipes
  // exist only in process transport — the worker transport's
  // MessageChannel cannot emit such errors. Swallow + log here so a
  // backend crash is reported as a graceful "backend exited" rather
  // than tearing down the thread.
  child.stdin?.on("error", (error: unknown) => {
    DiagnosticLog.recordProcess("tui.backendStdinStreamError", { target, error })
    Log.Default.warn("TUI backend stdin stream error", {
      target,
      error: error instanceof Error ? error.message : String(error),
    })
    wire.onmessage = null
  })
  child.stdout?.on("error", (error: unknown) => {
    DiagnosticLog.recordProcess("tui.backendStdoutStreamError", { target, error })
    Log.Default.warn("TUI backend stdout stream error", {
      target,
      error: error instanceof Error ? error.message : String(error),
    })
  })
  child.stderr?.on("error", (error: unknown) => {
    DiagnosticLog.recordProcess("tui.backendStderrStreamError", { target, error })
    Log.Default.warn("TUI backend stderr stream error", {
      target,
      error: error instanceof Error ? error.message : String(error),
    })
  })
  let buffer = ""
  child.stdout?.setEncoding("utf8")
  child.stdout?.on("data", (chunk: unknown) => {
    buffer += String(chunk)
    while (true) {
      const index = buffer.indexOf("\n")
      if (index < 0) break
      const line = buffer.slice(0, index)
      buffer = buffer.slice(index + 1)
      if (!line.trim()) continue
      if (!isBackendProtocolMessage(line)) {
        DiagnosticLog.recordProcess("tui.backendProtocolNoise", {
          target,
          length: line.length,
        })
        Log.Default.warn("TUI backend process wrote non-protocol stdout", {
          target,
          length: line.length,
        })
        continue
      }
      wire.onmessage?.({ data: line } as MessageEvent<any>)
    }
  })
  child.stderr?.setEncoding("utf8")
  child.stderr?.on("data", (chunk: unknown) => {
    const text = String(chunk).trim()
    if (!text) return
    DiagnosticLog.recordProcess("tui.backendProcessStderr", { text })
    Log.Default.warn("TUI backend process stderr", { text })
  })
  return wire
}

async function createBackendRuntime(input: {
  mode: BackendTransport
  workerTarget?: URL | string
  processCommand?: ReturnType<typeof backendProcessCommand>
  env: Record<string, string>
  cwd: string
}): Promise<BackendRuntime> {
  if (input.mode === "worker") {
    if (!input.workerTarget) throw new Error("Worker backend selected without a worker target")
    const worker = new Worker(input.workerTarget, { env: input.env })
    return {
      mode: "worker",
      target: String(input.workerTarget),
      wire: worker as unknown as RpcWireTarget,
      terminate: () => worker.terminate(),
    }
  }

  const command = input.processCommand ?? backendProcessCommand()
  const child = spawn(command.command, command.args, {
    cwd: input.cwd,
    env: input.env,
    stdio: ["pipe", "pipe", "pipe"],
  }) as any
  let terminating = false
  child.on("error", (error: unknown) => {
    DiagnosticLog.recordProcess("tui.backendProcessError", { error, target: command.label })
    Log.Default.error("TUI backend process failed", {
      error: error instanceof Error ? error.message : String(error),
      target: command.label,
    })
  })
  child.on("exit", (code: number | null, signal: string | null) => {
    if (terminating) return
    DiagnosticLog.recordProcess("tui.backendProcessExited", { code, signal, target: command.label })
    Log.Default.warn("TUI backend process exited", { code, signal, target: command.label })
  })
  return {
    mode: "process",
    target: command.label,
    pid: child.pid,
    wire: createProcessWire(child, command.label),
    terminate: () => {
      terminating = true
      child.kill()
    },
  }
}

function createWorkerFetch(client: RpcClient): typeof fetch {
  const fn = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const request = new Request(input, init)
    const body = request.body ? await request.text() : undefined
    const result = await client.call("fetch", {
      url: request.url,
      method: request.method,
      headers: Object.fromEntries(request.headers.entries()),
      body,
    })
    return new Response(result.body, {
      status: result.status,
      headers: result.headers,
    })
  }
  return fn as typeof fetch
}

function createEventSource(client: RpcClient): EventSource {
  let lastStatus: StreamConnectionStatus | undefined
  const statusListeners = new Set<(status: StreamConnectionStatus) => void>()
  client.on<StreamConnectionStatus>("event.status", (status) => {
    lastStatus = status
    for (const handler of statusListeners) handler(status)
  })
  void client
    .call("eventStatus", undefined)
    .then((status) => {
      if (!status) return
      lastStatus = status
      for (const handler of statusListeners) handler(status)
    })
    .catch(() => undefined)

  return {
    on: (handler) => client.on<Event>("event", handler),
    onStatus: (handler) => {
      if (lastStatus) handler(lastStatus)
      statusListeners.add(handler)
      return () => {
        statusListeners.delete(handler)
      }
    },
    status: () => lastStatus,
    setWorkspace: (workspaceID) => {
      void client.call("setWorkspace", { workspaceID }).catch((error) => {
        log.warn("failed to set workspace", { workspaceID, error })
        DiagnosticLog.recordProcess("tui.setWorkspaceFailed", { workspaceID, error })
      })
    },
  }
}

async function target() {
  if (typeof AX_CODE_WORKER_PATH !== "undefined") return AX_CODE_WORKER_PATH
  // Compiled-binary layout (legacy fallback): worker is at cli/cmd/tui/worker.js
  // relative to the entry point. Kept for backwards compatibility with builds
  // that emit the source-tree directory shape.
  const dist = new URL("./cli/cmd/tui/worker.js", import.meta.url)
  if (await Filesystem.exists(fileURLToPath(dist))) return dist
  // Source-bundle layout (ADR-002): build-source.ts emits flat-named outputs
  // so worker.js sits next to the bundled index.js. Probe this before the
  // source/dev .ts fallback so packaged users do not crash with a
  // ModuleNotFound on worker.ts that does not exist in the tarball.
  const flat = new URL("./worker.js", import.meta.url)
  if (await Filesystem.exists(fileURLToPath(flat))) return flat
  // Source/dev layout: worker.ts is the sibling source file under src/.
  // Bun's runtime can load .ts directly, so this is the contributor path.
  return new URL("./worker.ts", import.meta.url)
}

async function input(value?: string) {
  const piped = process.stdin.isTTY ? undefined : await Bun.stdin.text()
  if (!value) return piped
  if (!piped) return value
  return piped + "\n" + value
}

export const TuiThreadCommand = cmd({
  command: "$0 [project]",
  describe: "start ax-code tui",
  builder: (yargs) =>
    withNetworkOptions(yargs)
      .positional("project", {
        type: "string",
        describe: "path to start ax-code in",
      })
      .option("model", {
        type: "string",
        alias: ["m"],
        describe: "model to use in the format of provider/model",
      })
      .option("continue", {
        alias: ["c"],
        describe: "continue the last session",
        type: "boolean",
      })
      .option("session", {
        alias: ["s"],
        type: "string",
        describe: "session id to continue",
      })
      .option("fork", {
        type: "boolean",
        describe: "fork the session when continuing (use with --continue or --session)",
      })
      .option("prompt", {
        type: "string",
        describe: "prompt to use",
      })
      .option("agent", {
        type: "string",
        describe: "agent to use",
      }),
  handler: async (args) => {
    // Keep ENABLE_PROCESSED_INPUT cleared even if other code flips it.
    // (Important when running under `bun run` wrappers on Windows.)
    const unguard = win32InstallCtrlCGuard()
    try {
      // Must be the very first thing — disables CTRL_C_EVENT before any Worker
      // spawn or async work so the OS cannot kill the process group.
      win32DisableProcessedInput()

      if (args.fork && !args.continue && !args.session) {
        UI.error("--fork requires --continue or --session")
        process.exitCode = 1
        return
      }
      DiagnosticLog.recordProcess("tui.threadStarted", {
        args: process.argv.slice(2),
      })

      // Resolve relative --project paths from the caller's original cwd, then
      // use the real cwd after chdir so the thread and worker share the same
      // directory key. Filesystem.callerCwd() handles the --cwd offset.
      const root = Filesystem.resolve(Filesystem.callerCwd())
      const next = args.project
        ? Filesystem.resolve(path.isAbsolute(args.project) ? args.project : path.join(root, args.project))
        : root
      const backendTransport = tuiBackendTransport()
      const file = backendTransport === "worker" ? await target() : undefined
      const processCommand = backendTransport === "process" ? backendProcessCommand() : undefined
      DiagnosticLog.recordProcess("tui.backendTargetResolved", {
        mode: backendTransport,
        target: file ? String(file) : processCommand?.label,
        runtimeMode: runtimeMode(),
      })
      try {
        process.chdir(next)
      } catch {
        UI.error("Failed to change directory to " + next)
        return
      }
      const cwd = Filesystem.resolve(process.cwd())

      const sanitized = Env.sanitize()
      if (process.argv.includes("--print-logs")) sanitized.AX_CODE_PRINT_LOGS = "1"
      const backend = await createBackendRuntime({
        mode: backendTransport,
        workerTarget: file,
        processCommand,
        cwd,
        env: Object.fromEntries(Object.entries(sanitized).filter((e): e is [string, string] => e[1] !== undefined)),
      })
      DiagnosticLog.recordProcess("tui.backendSpawned", { mode: backend.mode, target: backend.target, pid: backend.pid })
      DiagnosticLog.recordProcess("tui.workerSpawned", { mode: backend.mode, target: backend.target, pid: backend.pid })
      if (backend.mode === "worker") {
        const worker = backend.wire as unknown as Worker
        worker.onerror = (e) => {
          DiagnosticLog.recordProcess("tui.workerError", { error: e, target: backend.target })
          Log.Default.error(e)
          UI.error(`Worker failed to load (${backend.target}): ${e instanceof ErrorEvent ? e.message : String(e)}`)
          process.exit(1)
        }
        worker.onmessageerror = (e) => {
          DiagnosticLog.recordProcess("tui.workerMessageError", { error: e })
          Log.Default.error(e)
        }
      }

      const client = Rpc.client<typeof rpc>(backend.wire)
      const workerReadyTimeoutMs = tuiWorkerReadyTimeoutMs()
      DiagnosticLog.recordProcess("tui.backendHandshakeStarted", {
        mode: backend.mode,
        target: backend.target,
        pid: backend.pid,
        timeoutMs: workerReadyTimeoutMs,
      })
      const workerReady = await withTimeout(
        client.call("health", undefined),
        workerReadyTimeoutMs,
        `TUI backend did not become ready after ${workerReadyTimeoutMs}ms`,
      ).catch((error) => {
        DiagnosticLog.recordProcess("tui.backendHandshakeFailed", {
          error,
          mode: backend.mode,
          target: backend.target,
          pid: backend.pid,
          timeoutMs: workerReadyTimeoutMs,
        })
        DiagnosticLog.recordProcess("tui.workerHandshakeFailed", {
          error,
          mode: backend.mode,
          target: backend.target,
          pid: backend.pid,
          timeoutMs: workerReadyTimeoutMs,
        })
        Log.Default.error("TUI backend failed readiness handshake", {
          error: error instanceof Error ? error.message : String(error),
          mode: backend.mode,
          target: backend.target,
          pid: backend.pid,
          timeoutMs: workerReadyTimeoutMs,
        })
        UI.error(
          [
            "TUI backend did not become ready.",
            "This usually points to backend transport startup, OpenTUI preload, or runtime packaging.",
            "Run with --debug --print-logs and inspect process.jsonl around tui.backendHandshakeFailed.",
          ].join("\n"),
        )
        backend.terminate()
        process.exitCode = 1
        return undefined
      })
      if (!workerReady) return
      DiagnosticLog.recordProcess("tui.backendReady", {
        ...workerReady,
        mode: backend.mode,
        target: backend.target,
        pid: backend.pid,
        timeoutMs: workerReadyTimeoutMs,
      })
      DiagnosticLog.recordProcess("tui.workerReady", {
        ...workerReady,
        mode: backend.mode,
        target: backend.target,
        pid: backend.pid,
        timeoutMs: workerReadyTimeoutMs,
      })
      const internalEvents = createEventSource(client)
      const error = (e: unknown) => {
        DiagnosticLog.recordProcess("tui.threadError", { error: e })
        Log.Default.error(e)
      }
      const reload = () => {
        client.call("reload", undefined).catch((err) => {
          Log.Default.warn("backend reload failed", {
            error: err instanceof Error ? err.message : String(err),
          })
        })
      }
      process.on("uncaughtException", error)
      process.on("unhandledRejection", error)
      process.on("SIGUSR2", reload)

      let stopped = false
      const stop = async () => {
        if (stopped) return
        stopped = true
        process.off("uncaughtException", error)
        process.off("unhandledRejection", error)
        process.off("SIGUSR2", reload)
        await withTimeout(client.call("shutdown", undefined), 5000).catch((error) => {
          Log.Default.warn("backend shutdown failed", {
            error: error instanceof Error ? error.message : String(error),
          })
        })
        backend.terminate()
      }

      const prompt = await input(args.prompt)
      const config = await Instance.provide({
        directory: cwd,
        fn: () => TuiConfig.get(),
      })

      const network = await resolveNetworkOptions(args)
      const external =
        process.argv.includes("--port") ||
        process.argv.includes("--hostname") ||
        process.argv.includes("--mdns") ||
        network.mdns ||
        network.port !== 0 ||
        network.hostname !== "127.0.0.1"

      const transport = external
        ? {
            url: (await client.call("server", network)).url,
            fetch: undefined,
            events: undefined,
          }
        : {
            url: internalBaseUrl(),
            fetch: createWorkerFetch(client),
            events: internalEvents,
          }
      DiagnosticLog.recordProcess("tui.threadTransportSelected", {
        mode: external ? "external" : "internal",
        url: transport.url,
      })

      const upgradeTimer = setTimeout(() => {
        client.call("checkUpgrade", { directory: cwd }).catch(() => {})
      }, 1000)
      upgradeTimer.unref?.()

      try {
        const appImportStartedAt = performance.now()
        DiagnosticLog.recordProcess("tui.appImportStarted", {})
        const app = await import("./app").catch((error) => {
          const elapsedMs = Math.round(performance.now() - appImportStartedAt)
          DiagnosticLog.recordProcess("tui.appImportFailed", {
            error,
            elapsedMs,
          })
          Log.Default.error("TUI app import failed", {
            error: error instanceof Error ? error.message : String(error),
            elapsedMs,
          })
          UI.error(
            [
              "TUI app failed to load.",
              "This usually points to OpenTUI/Solid module startup or bundled-runtime packaging.",
              "Run with --debug --print-logs and inspect process.jsonl around tui.appImportFailed.",
            ].join("\n"),
          )
          process.exitCode = 1
          return undefined
        })
        if (!app) return
        DiagnosticLog.recordProcess("tui.appImportReady", {
          elapsedMs: Math.round(performance.now() - appImportStartedAt),
        })
        const { tui } = app
        await tui({
          url: transport.url,
          async onSnapshot() {
            const tuiSnapshot = writeHeapSnapshot("tui.heapsnapshot")
            const server = await client.call("snapshot", undefined)
            return [tuiSnapshot, server]
          },
          config,
          directory: cwd,
          fetch: transport.fetch,
          events: transport.events,
          args: {
            continue: args.continue,
            sessionID: args.session,
            agent: args.agent,
            model: args.model,
            prompt,
            fork: args.fork,
          },
        })
      } finally {
        clearTimeout(upgradeTimer)
        await stop()
      }
    } finally {
      unguard?.()
    }
    process.exit(0)
  },
})
