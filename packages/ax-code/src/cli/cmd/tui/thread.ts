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

declare global {
  const AX_CODE_WORKER_PATH: string
}

type RpcClient = ReturnType<typeof Rpc.client<typeof rpc>>

export const DEFAULT_TUI_WORKER_READY_TIMEOUT_MS = 10_000

export function tuiWorkerReadyTimeoutMs(env: Record<string, string | undefined> = process.env) {
  const value = env.AX_CODE_TUI_WORKER_READY_TIMEOUT_MS
  if (!value) return DEFAULT_TUI_WORKER_READY_TIMEOUT_MS
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : DEFAULT_TUI_WORKER_READY_TIMEOUT_MS
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
      void client.call("setWorkspace", { workspaceID })
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
      const file = await target()
      DiagnosticLog.recordProcess("tui.workerTargetResolved", { target: String(file) })
      try {
        process.chdir(next)
      } catch {
        UI.error("Failed to change directory to " + next)
        return
      }
      const cwd = Filesystem.resolve(process.cwd())

      const sanitized = Env.sanitize()
      if (process.argv.includes("--print-logs")) sanitized.AX_CODE_PRINT_LOGS = "1"
      const worker = new Worker(file, {
        env: Object.fromEntries(Object.entries(sanitized).filter((e): e is [string, string] => e[1] !== undefined)),
      })
      DiagnosticLog.recordProcess("tui.workerSpawned", { target: String(file) })
      worker.onerror = (e) => {
        DiagnosticLog.recordProcess("tui.workerError", { error: e, target: String(file) })
        Log.Default.error(e)
        UI.error(`Worker failed to load (${String(file)}): ${e instanceof ErrorEvent ? e.message : String(e)}`)
        process.exit(1)
      }
      worker.onmessageerror = (e) => {
        DiagnosticLog.recordProcess("tui.workerMessageError", { error: e })
        Log.Default.error(e)
      }

      const client = Rpc.client<typeof rpc>(worker)
      const workerReadyTimeoutMs = tuiWorkerReadyTimeoutMs()
      const workerReady = await withTimeout(
        client.call("health", undefined),
        workerReadyTimeoutMs,
        `TUI worker did not become ready after ${workerReadyTimeoutMs}ms`,
      ).catch((error) => {
        DiagnosticLog.recordProcess("tui.workerHandshakeFailed", {
          error,
          target: String(file),
          timeoutMs: workerReadyTimeoutMs,
        })
        Log.Default.error("TUI worker failed readiness handshake", {
          error: error instanceof Error ? error.message : String(error),
          target: String(file),
          timeoutMs: workerReadyTimeoutMs,
        })
        UI.error(
          [
            "TUI worker did not become ready.",
            "This usually points to Bun Worker startup, OpenTUI preload, or runtime packaging.",
            "Run with --debug --print-logs and inspect process.jsonl around tui.workerHandshakeFailed.",
          ].join("\n"),
        )
        worker.terminate()
        process.exitCode = 1
        return undefined
      })
      if (!workerReady) return
      DiagnosticLog.recordProcess("tui.workerReady", {
        ...workerReady,
        target: String(file),
        timeoutMs: workerReadyTimeoutMs,
      })
      const internalEvents = createEventSource(client)
      const error = (e: unknown) => {
        DiagnosticLog.recordProcess("tui.threadError", { error: e })
        Log.Default.error(e)
      }
      const reload = () => {
        client.call("reload", undefined).catch((err) => {
          Log.Default.warn("worker reload failed", {
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
          Log.Default.warn("worker shutdown failed", {
            error: error instanceof Error ? error.message : String(error),
          })
        })
        worker.terminate()
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
