import { cmd } from "@/cli/cmd/cmd"
import { cliBooleanFlagValue } from "@/cli/boolean-flag"
import { Rpc } from "@/util/rpc"
import { type rpc } from "./worker"
import { createRequire } from "module"
import path from "path"
import { fileURLToPath, pathToFileURL } from "url"
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
import { Global } from "@/global"
import { Installation } from "@/installation"
import { internalBaseUrl } from "@/util/internal-url"
import type { StreamConnectionStatus } from "./util/resilient-stream"
import { runtimeMode } from "@/installation/runtime-mode"
import { spawn } from "node:child_process"
import { flushTuiStdout, resetTuiTerminalState } from "./terminal-cleanup"
import { parseIntegerEnv } from "./util/env"
import { formatWorkerLoadError } from "./util/log-error"
import { parseTuiJsonPayload } from "./util/json"
import { hasExplicitNetworkBindFlag } from "./util/network-flags"
import { registerTuiProcessHandler } from "./util/lifecycle"
import { readOptionalJsonState } from "./util/optional-json-state"
import { toErrorMessage } from "@/util/error-message"
import { Shell } from "@/shell/shell"
import {
  nextTuiStartupUpgradeCheckState,
  shouldRunTuiStartupUpgradeCheck,
  type TuiStartupUpgradeCheckState,
} from "./upgrade-check-view-model"

declare global {
  const AX_CODE_WORKER_PATH: string
}

type RpcClient = ReturnType<typeof Rpc.client<typeof rpc>>
const log = Log.create({ service: "tui.thread" })
const require = createRequire(import.meta.url)

export const DEFAULT_TUI_WORKER_READY_TIMEOUT_MS = 10_000
export const DEFAULT_TUI_UPGRADE_CHECK_DELAY_MS = 30_000
export const DEFAULT_TUI_UPGRADE_CHECK_INTERVAL_MS = 24 * 60 * 60 * 1_000
export const DEFAULT_TUI_BACKEND_SHUTDOWN_TIMEOUT_MS = 5_000
export const DEFAULT_TUI_BACKEND_TERMINATE_GRACE_MS = 1_000

export type BackendTransport = "worker" | "process"
type RpcWireTarget = {
  postMessage: (data: string) => void | null
  onmessage: ((ev: MessageEvent<any>) => any) | null
  // See `Rpc.MessageTarget.onWireDeath` — process-stdio transport calls
  // this on broken stdin / EPIPE / child exit so the RPC client can
  // fast-fail every pending call instead of waiting the full
  // RPC_TIMEOUT_MS each.
  onWireDeath?: (() => void) | null
}

type BackendRuntime = {
  mode: BackendTransport
  target: string
  pid?: number
  wire: RpcWireTarget
  terminate: () => Promise<void>
}

export function tuiWorkerReadyTimeoutMs(env: Record<string, string | undefined> = process.env) {
  return parseIntegerEnv({
    env,
    name: "AX_CODE_TUI_WORKER_READY_TIMEOUT_MS",
    fallback: DEFAULT_TUI_WORKER_READY_TIMEOUT_MS,
    min: 1,
  })
}

export function tuiBackendTransport(
  env: Record<string, string | undefined> = process.env,
  runtime: { hasBun?: boolean; mode?: string } = {
    hasBun: Boolean(process.versions.bun),
    mode: process.versions.bun ? runtimeMode() : "node-source",
  },
): BackendTransport {
  const requested = env.AX_CODE_TUI_BACKEND_TRANSPORT
  // The process backend works on every runtime, so an explicit request is always
  // honored. Worker mode needs Bun's global `Worker` and a loadable worker entry,
  // neither of which exists under Node (the node-bundled dist ships no worker
  // bundle), so a requested (or default) "worker" transport is only honored on
  // the Bun source/dev runtime; everything else (Node, Bun-compiled) falls back
  // to the process backend rather than ReferenceError on `new Worker`.
  if (requested === "process") return "process"
  return runtime.hasBun && runtime.mode !== "compiled" ? "worker" : "process"
}

export function tuiUpgradeCheckDelayMs(env: Record<string, string | undefined> = process.env) {
  return parseIntegerEnv({
    env,
    name: "AX_CODE_TUI_UPGRADE_CHECK_DELAY_MS",
    fallback: DEFAULT_TUI_UPGRADE_CHECK_DELAY_MS,
    min: 0,
  })
}

export function tuiUpgradeCheckIntervalMs(env: Record<string, string | undefined> = process.env) {
  return parseIntegerEnv({
    env,
    name: "AX_CODE_TUI_UPGRADE_CHECK_INTERVAL_MS",
    fallback: DEFAULT_TUI_UPGRADE_CHECK_INTERVAL_MS,
    min: 0,
  })
}

export function tsxLoaderImportSpecifier() {
  return pathToFileURL(require.resolve("tsx")).href
}

function tuiUpgradeCheckStatePath() {
  return path.join(Global.Path.state, "upgrade-check.json")
}

async function shouldRunStartupUpgradeCheck() {
  const intervalMs = tuiUpgradeCheckIntervalMs()
  const statePath = tuiUpgradeCheckStatePath()
  const nowMs = Date.now()
  const persisted = await readOptionalJsonState<TuiStartupUpgradeCheckState>(statePath)
  if (persisted.status === "invalid") {
    log.debug("skipping startup upgrade check because state failed to load", {
      statePath,
      error: persisted.error,
    })
    return false
  }
  const shouldRun = shouldRunTuiStartupUpgradeCheck({
    state: persisted.status === "found" ? persisted.value : undefined,
    currentVersion: Installation.VERSION,
    nowMs,
    intervalMs,
  })
  if (!shouldRun) return false

  await Filesystem.writeJson(
    statePath,
    nextTuiStartupUpgradeCheckState({
      currentVersion: Installation.VERSION,
      nowMs,
    }),
  ).catch((error) => {
    log.debug("failed to persist upgrade check state", {
      statePath,
      error,
    })
  })
  return true
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
  // A source run executes a `.ts` entry, which plain `node` cannot load — forward
  // the tsx loader. A node-bundled run executes a `.js` entry and needs nothing.
  // Also forward the solid-loader (tsconfig path aliases, .tsx JSX transform,
  // text-asset imports, Bun→Node module rebinding). Bun resolved tsconfig paths
  // natively; on Node + tsx the solid-loader's resolve hook is required.
  let loaderArgs: string[] = []
  if (/\.[cm]?tsx?$/.test(resolvedEntry)) {
    loaderArgs = ["--import", tsxLoaderImportSpecifier()]
    // Forward the solid-loader if the parent process uses it. Convert relative
    // paths to absolute so the child process resolves correctly regardless of
    // its CWD.
    for (let i = 0; i < process.execArgv.length; i++) {
      const arg = process.execArgv[i]
      if (arg === "--import" && process.execArgv[i + 1]?.includes("solid-loader")) {
        const loaderPath = process.execArgv[i + 1]
        const absLoader = path.isAbsolute(loaderPath) ? loaderPath : path.resolve(process.cwd(), loaderPath)
        loaderArgs.push("--import", absLoader)
        break
      }
      if (arg.startsWith("--import=") && arg.includes("solid-loader")) {
        const loaderPath = arg.slice("--import=".length)
        const absLoader = path.isAbsolute(loaderPath) ? loaderPath : path.resolve(process.cwd(), loaderPath)
        loaderArgs.push("--import", absLoader)
        break
      }
    }
  }
  const args = [...loaderArgs, "--conditions=browser", resolvedEntry, "tui-backend", "--stdio"]
  return {
    command: process.execPath,
    args,
    label: `${process.execPath} ${args.join(" ")}`,
  }
}

function isBackendProtocolMessage(line: string) {
  const parsed = parseTuiJsonPayload(line)
  if (!parsed || typeof parsed !== "object") return false
  const type = (parsed as { type?: unknown }).type
  return type === "rpc.result" || type === "rpc.error" || type === "rpc.event"
}

function createProcessWire(child: any, target: string): RpcWireTarget {
  const wire: RpcWireTarget = {
    onmessage: null,
    onWireDeath: null,
    postMessage(data) {
      const stdin = child.stdin
      if (!stdin || stdin.destroyed) {
        // Pipe is gone (child exited / stdin closed). Fire onWireDeath
        // so the RPC client fast-fails every pending call instead of
        // waiting the full 60s `RPC_TIMEOUT_MS` each. Idempotent —
        // null'd handlers below mean a second death event is a no-op.
        DiagnosticLog.recordProcess("tui.backendStdinUnavailable", { target })
        wire.onWireDeath?.()
        wire.onmessage = null
        wire.onWireDeath = null
        return
      }
      try {
        stdin.write(data + "\n")
      } catch (error) {
        DiagnosticLog.recordProcess("tui.backendStdinWriteFailed", { target, error })
        Log.Default.warn("TUI backend stdin write failed", {
          target,
          error: toErrorMessage(error),
        })
        wire.onWireDeath?.()
        wire.onmessage = null
        wire.onWireDeath = null
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
      error: toErrorMessage(error),
    })
    wire.onWireDeath?.()
    wire.onmessage = null
    wire.onWireDeath = null
  })
  child.stdout?.on("error", (error: unknown) => {
    DiagnosticLog.recordProcess("tui.backendStdoutStreamError", { target, error })
    Log.Default.warn("TUI backend stdout stream error", {
      target,
      error: toErrorMessage(error),
    })
  })
  child.stderr?.on("error", (error: unknown) => {
    DiagnosticLog.recordProcess("tui.backendStderrStreamError", { target, error })
    Log.Default.warn("TUI backend stderr stream error", {
      target,
      error: toErrorMessage(error),
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
    // Reached only under the Bun source/dev runtime (see tuiBackendTransport):
    // Bun provides a global `Worker` and can load the worker entry directly. The
    // ambient DOM `WorkerOptions` lib type lacks `env`, so cast.
    const worker = new Worker(input.workerTarget, { env: input.env } as unknown as WorkerOptions)
    return {
      mode: "worker",
      target: String(input.workerTarget),
      wire: worker as unknown as RpcWireTarget,
      terminate: async () => {
        worker.terminate()
      },
    }
  }

  const command = input.processCommand ?? backendProcessCommand()
  const child = spawn(command.command, command.args, {
    cwd: input.cwd,
    env: input.env,
    stdio: ["pipe", "pipe", "pipe"],
  }) as any
  let terminating = false
  let exited = false
  let resolveExited: () => void = () => {}
  const exitedPromise = new Promise<void>((resolve) => {
    resolveExited = resolve
  })
  child.on("error", (error: unknown) => {
    DiagnosticLog.recordProcess("tui.backendProcessError", { error, target: command.label })
    Log.Default.error("TUI backend process failed", {
      error: toErrorMessage(error),
      target: command.label,
    })
  })
  child.on("exit", (code: number | null, signal: string | null) => {
    exited = true
    resolveExited()
    if (terminating) return
    DiagnosticLog.recordProcess("tui.backendProcessExited", { code, signal, target: command.label })
    Log.Default.warn("TUI backend process exited", { code, signal, target: command.label })
  })
  const waitForExit = async (timeoutMs: number) => {
    const timeout = new Promise<"timeout">((resolve) => {
      const timer = setTimeout(() => resolve("timeout"), timeoutMs)
      timer.unref?.()
    })
    return Promise.race([exitedPromise.then(() => "exited" as const), timeout])
  }
  return {
    mode: "process",
    target: command.label,
    pid: child.pid,
    wire: createProcessWire(child, command.label),
    terminate: async () => {
      terminating = true
      DiagnosticLog.recordProcess("tui.backendProcessTerminateStarted", {
        target: command.label,
        pid: child.pid,
      })
      try {
        child.stdin?.end()
        DiagnosticLog.recordProcess("tui.backendProcessStdinClosed", {
          target: command.label,
          pid: child.pid,
        })
      } catch (error) {
        DiagnosticLog.recordProcess("tui.backendProcessStdinCloseFailed", {
          target: command.label,
          pid: child.pid,
          error,
        })
      }
      const hasExited = () => exited || child.exitCode !== null || child.signalCode !== null
      const terminateProcess = () =>
        Shell.killTree(child, {
          exited: () => hasExited(),
        })
          .then(() => {
            DiagnosticLog.recordProcess("tui.backendProcessKilled", {
              target: command.label,
              pid: child.pid,
            })
          })
          .catch((error) => {
            DiagnosticLog.recordProcess("tui.backendProcessKillFailed", {
              target: command.label,
              pid: child.pid,
              error,
            })
          })

      await terminateProcess()
      if ((await waitForExit(DEFAULT_TUI_BACKEND_TERMINATE_GRACE_MS)) === "timeout" && !exited) {
        await terminateProcess()
        await waitForExit(DEFAULT_TUI_BACKEND_TERMINATE_GRACE_MS)
      }
      DiagnosticLog.recordProcess("tui.backendProcessTerminateCompleted", {
        target: command.label,
        pid: child.pid,
        exited,
      })
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
  // Legacy flat bundle layout: worker.js sits next to the bundled index.js.
  // Probe this before the source/dev .ts fallback so old source-bundle installs
  // do not crash with a ModuleNotFound on worker.ts.
  const flat = new URL("./worker.js", import.meta.url)
  if (await Filesystem.exists(fileURLToPath(flat))) return flat
  // Source/dev layout: worker.ts is the sibling source file under src/.
  // Bun's runtime can load .ts directly, so this is the contributor path.
  return new URL("./worker.ts", import.meta.url)
}

async function input(value?: string) {
  const piped = process.stdin.isTTY
    ? undefined
    : await new Promise<string>((resolve, reject) => {
        const chunks: Buffer[] = []
        process.stdin.on("data", (chunk: Buffer) => chunks.push(chunk))
        process.stdin.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")))
        process.stdin.on("error", reject)
      })
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
      // Sibling event under the worker-era name. Kept alongside
      // backendTargetResolved for observability backwards compat — the
      // other backend/worker event pairs (Spawned, Ready, HandshakeFailed)
      // already emit both names, and dashboards / log-watchers tuned to
      // the older `tui.worker*` taxonomy continue to fire here.
      DiagnosticLog.recordProcess("tui.workerTargetResolved", {
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
      if (cliBooleanFlagValue(process.argv, "--print-logs") === true) sanitized.AX_CODE_PRINT_LOGS = "1"
      const backend = await createBackendRuntime({
        mode: backendTransport,
        workerTarget: file,
        processCommand,
        cwd,
        env: Object.fromEntries(Object.entries(sanitized).filter((e): e is [string, string] => e[1] !== undefined)),
      })
      DiagnosticLog.recordProcess("tui.backendSpawned", {
        mode: backend.mode,
        target: backend.target,
        pid: backend.pid,
      })
      DiagnosticLog.recordProcess("tui.workerSpawned", { mode: backend.mode, target: backend.target, pid: backend.pid })
      if (backend.mode === "worker") {
        const worker = backend.wire as unknown as Worker
        worker.onerror = (e) => {
          DiagnosticLog.recordProcess("tui.workerError", { error: e, target: backend.target })
          Log.Default.error(e)
          UI.error(formatWorkerLoadError(backend.target, e))
          // Attempt graceful backend termination before exit so the child
          // process (if any) is cleaned up and the terminal state is restored.
          backend
            .terminate()
            .catch((err) => {
              log.warn("failed to terminate backend after worker error", { error: toErrorMessage(err) })
            })
            .finally(() => {
              process.exit(1)
            })
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
      ).catch(async (error) => {
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
          error: toErrorMessage(error),
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
        await backend.terminate()
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
      let threadErrorExitScheduled = false
      const error = (e: unknown) => {
        DiagnosticLog.recordProcess("tui.threadError", { error: e })
        Log.Default.error(e)
        process.exitCode = 1
        resetTuiTerminalState()
        if (threadErrorExitScheduled) return
        threadErrorExitScheduled = true
        const timer = setTimeout(() => process.exit(1), 100)
        timer.unref?.()
        void flushTuiStdout().finally(() => {
          clearTimeout(timer)
          process.exit(1)
        })
      }
      const reload = () => {
        client.call("reload", undefined).catch((err) => {
          Log.Default.warn("backend reload failed", {
            error: toErrorMessage(err),
          })
        })
      }
      const unregisterProcessHandlers = [
        registerTuiProcessHandler("uncaughtException", error, { name: "thread-uncaught-exception" }),
        registerTuiProcessHandler("unhandledRejection", error, { name: "thread-unhandled-rejection" }),
        registerTuiProcessHandler("SIGUSR2", reload, { name: "thread-sigusr2-reload" }),
      ]

      let stopped = false
      const stop = async () => {
        if (stopped) return
        stopped = true
        for (const unregister of unregisterProcessHandlers) unregister()
        await withTimeout(client.call("shutdown", undefined), DEFAULT_TUI_BACKEND_SHUTDOWN_TIMEOUT_MS).catch(
          (error) => {
            Log.Default.warn("backend shutdown failed", {
              error: toErrorMessage(error),
            })
          },
        )
        await backend.terminate()
      }

      const prompt = await input(args.prompt)
      const config = await Instance.provide({
        directory: cwd,
        fn: () => TuiConfig.get(),
      })

      const network = await resolveNetworkOptions(args)
      const external =
        hasExplicitNetworkBindFlag() || network.mdns || network.port !== 0 || network.hostname !== "127.0.0.1"

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

      const upgradeDelayMs = tuiUpgradeCheckDelayMs()
      // Upgrade checks are non-critical and can touch installation/network
      // surfaces. Keep them away from the first interactive turn, especially
      // in packaged installs where the TUI shares a stdio backend with prompt
      // submission.
      const upgradeTimer =
        upgradeDelayMs === 0
          ? undefined
          : setTimeout(() => {
              shouldRunStartupUpgradeCheck()
                .then((shouldRun) => {
                  if (!shouldRun) return
                  return client.call("checkUpgrade", { directory: cwd })
                })
                .catch((error) => {
                  log.debug("upgrade check request failed", {
                    directory: cwd,
                    error,
                  })
                })
            }, upgradeDelayMs)
      upgradeTimer?.unref?.()

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
            error: toErrorMessage(error),
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
        if (upgradeTimer) clearTimeout(upgradeTimer)
        await stop()
      }
    } finally {
      unguard?.()
    }
    await flushTuiStdout()
    process.exit(0)
  },
})
