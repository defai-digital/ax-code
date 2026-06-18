import { Installation } from "@/installation"
import { cliBooleanFlagValue } from "@/cli/boolean-flag"
import { runtimeMode } from "@/installation/runtime-mode"
import { Server } from "@/server/server"
import { Log } from "@/util/log"
import { Instance } from "@/project/instance"
import { InstanceBootstrap } from "@/project/bootstrap"
import { Rpc } from "@/util/rpc"
import { upgrade } from "@/cli/upgrade"
import { Config } from "@/config/config"
import { GlobalBus } from "@/bus/global"
import { createOpencodeClient, type Event as OpencodeEvent } from "@ax-code/sdk/v2"
import { Flag } from "@/flag/flag"
import { writeHeapSnapshot } from "node:v8"
import { DiagnosticLog } from "@/debug/diagnostic-log"
import { internalBaseUrl } from "@/util/internal-url"
import { ServerRuntimeAuth } from "@/server/runtime-auth"
import path from "node:path"
import { tmpdir } from "node:os"
import { runResilientStream, type StreamConnectionStatus } from "./util/resilient-stream"
import { registerShutdownSignals } from "@/util/signals"
import { toErrorMessage } from "@/util/error-message"
import { stopServer as stopAxEngineServer } from "@/provider/ax-engine"

type GlobalEvent = {
  directory?: string
  payload: unknown
}

const debugEnabled = Flag.AX_CODE_DEBUG
const debugDir = debugEnabled ? (Flag.AX_CODE_DEBUG_DIR ?? path.join(tmpdir(), "ax-code-debug")) : undefined
await DiagnosticLog.configure({
  enabled: debugEnabled,
  dir: debugDir,
  includeContent: !!Flag.AX_CODE_DEBUG_INCLUDE_CONTENT,
  manifest: {
    component: "tui-worker",
    version: Installation.VERSION,
    pid: process.pid,
    argv: process.argv.slice(2),
    cwd: process.cwd(),
    runtimeMode: runtimeMode(),
  },
})
if (debugDir) DiagnosticLog.installProcessDiagnostics()

await Log.init({
  print: cliBooleanFlagValue(process.argv, "--print-logs") === true || Flag.AX_CODE_PRINT_LOGS,
  dev: Installation.isLocal(),
  level: (() => {
    if (debugDir) return "DEBUG"
    return "INFO"
  })(),
  ...(debugDir ? { dir: debugDir, name: "tui-worker" } : { name: Log.stampedName("tui-worker") }),
})

process.on("unhandledRejection", (e) => {
  DiagnosticLog.recordProcess("worker.unhandledRejection", { error: e })
  const error = e as Error
  Log.Default.error("rejection", {
    message: toErrorMessage(error),
    stack: error instanceof Error ? error.stack : undefined,
    code: error instanceof Error && "code" in error ? (error as NodeJS.ErrnoException).code : undefined,
  })
})

process.on("uncaughtException", (e) => {
  DiagnosticLog.recordProcess("worker.uncaughtException", { error: e })
  const error = e as Error
  Log.Default.error("exception", {
    message: toErrorMessage(error),
    stack: error instanceof Error ? error.stack : undefined,
    code: error instanceof Error && "code" in error ? (error as NodeJS.ErrnoException).code : undefined,
  })
  setTimeout(() => process.exit(1), 100)
})

const handleGlobalEvent = (event: GlobalEvent) => {
  Rpc.emit("global.event", event)
}

// Subscribe to global events and forward them via RPC
GlobalBus.on("event", handleGlobalEvent)

let server: Awaited<ReturnType<typeof Server.listen>> | undefined
let shutdownPromise: Promise<void> | undefined
let removeSignalHandlers: (() => void) | undefined

const eventStream = {
  abort: undefined as AbortController | undefined,
  status: undefined as StreamConnectionStatus | undefined,
  done: undefined as Promise<void> | undefined,
}

const startEventStream = async (input: { directory?: string }) => {
  if (eventStream.abort) {
    eventStream.abort.abort()
    await eventStream.done?.catch(() => {})
    eventStream.abort = undefined
    eventStream.done = undefined
  }
  const abort = new AbortController()
  eventStream.abort = abort
  const signal = abort.signal

  const fetchFn = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init)
    const auth = getAuthorizationHeader()
    if (auth) request.headers.set("Authorization", auth)
    ServerRuntimeAuth.apply(request.headers)
    return Server.Default().fetch(request)
  }) as typeof globalThis.fetch

  const sdk = createOpencodeClient({
    baseUrl: internalBaseUrl(),
    directory: input.directory ?? process.cwd(),
    fetch: fetchFn,
    signal,
  })

  const publishStatus = (status: StreamConnectionStatus) => {
    if (signal.aborted) return
    eventStream.status = status
    Rpc.emit("event.status", status)
  }

  const done = runResilientStream<OpencodeEvent>({
    signal,
    subscribe: (connectionSignal) =>
      sdk.event.subscribe(
        {},
        {
          signal: connectionSignal,
        },
      ),
    onEvent: (event) => {
      if (signal.aborted) return
      Rpc.emit("event", event)
    },
    onStatus: publishStatus,
    onError: (error, status) => {
      publishStatus(status)
      DiagnosticLog.recordProcess("worker.eventStreamError", { error, status })
      Log.Default.warn("event stream reconnecting", {
        error: error instanceof Error ? error.message : error,
        reason: status.reason,
        attempt: status.attempt,
      })
    },
  })
    .catch((error) => {
      DiagnosticLog.recordProcess("worker.eventStreamError", { error })
      Log.Default.error("event stream error", {
        error: error instanceof Error ? error.message : error,
      })
    })
    .finally(() => {
      if (eventStream.abort === abort) {
        eventStream.abort = undefined
        eventStream.done = undefined
      }
    })
  eventStream.done = done
}

export function assertRpcFetchUrlAllowed(inputUrl: string) {
  const requested = new URL(inputUrl)
  const expected = new URL(internalBaseUrl())
  if (requested.origin !== expected.origin) {
    throw new Error(`RPC fetch denied for non-internal origin: ${requested.origin}`)
  }
}

export const rpc = {
  health() {
    return {
      version: Installation.VERSION,
      runtimeMode: runtimeMode(),
      pid: process.pid,
      cwd: process.cwd(),
    }
  },
  async fetch(input: { url: string; method: string; headers: Record<string, string>; body?: string }) {
    assertRpcFetchUrlAllowed(input.url)
    const headers = { ...input.headers }
    const auth = getAuthorizationHeader()
    if (auth && !headers["authorization"] && !headers["Authorization"]) {
      headers["Authorization"] = auth
    }
    if (!headers[ServerRuntimeAuth.HEADER])
      headers[ServerRuntimeAuth.HEADER] = ServerRuntimeAuth.headers()[ServerRuntimeAuth.HEADER]
    const request = new Request(input.url, {
      method: input.method,
      headers,
      body: input.body,
    })
    const response = await Server.Default().fetch(request)
    const body = await response.text()
    return {
      status: response.status,
      headers: Object.fromEntries(response.headers.entries()),
      body,
    }
  },
  snapshot() {
    const result = writeHeapSnapshot("server.heapsnapshot")
    return result
  },
  async server(input: { port: number; hostname: string; mdns?: boolean; cors?: string[] }) {
    const { requireAuthForNetwork } = await import("../../network")
    requireAuthForNetwork(input.hostname)
    if (server) await server.stop(true)
    server = await Server.listen(input)
    // A new server instance means any cached shutdown is stale: the
    // resolved promise represents the prior teardown. If we left it in
    // place a follow-up `shutdown()` would early-return that resolved
    // promise and the new server would never be stopped. Production
    // doesn't hit this today (start → optional server → shutdown →
    // exit is the lifecycle), but reload + restart cycles in tests do.
    shutdownPromise = undefined
    return { url: server.url.toString() }
  },
  async checkUpgrade(input: { directory: string }) {
    await Instance.provide({
      directory: input.directory,
      init: InstanceBootstrap,
      fn: async () => {
        await upgrade().catch((error) => {
          Log.Default.debug("upgrade check failed", {
            directory: input.directory,
            error,
          })
        })
      },
    })
  },
  async reload() {
    await Instance.disposeAll()
    Config.global.reset()
  },
  async setWorkspace(input: { workspaceID?: string }) {
    await startEventStream({ directory: input.workspaceID ?? process.cwd() })
  },
  async shutdown() {
    // shutdown is invoked from multiple paths: the thread's explicit
    // RPC, the SIGTERM/SIGINT handlers, and the stdin-close fallback.
    // Cache the in-flight promise so concurrent calls converge instead
    // of running double-tear-down (which can throw on an already-
    // stopped server).
    if (shutdownPromise) return shutdownPromise
    shutdownPromise = (async () => {
      Log.Default.info("worker shutting down")
      removeSignalHandlers?.()
      removeSignalHandlers = undefined
      if (eventStream.abort) eventStream.abort.abort()
      await eventStream.done?.catch(() => {})
      eventStream.abort = undefined
      eventStream.done = undefined
      GlobalBus.off("event", handleGlobalEvent)
      await Instance.disposeAll()
      // Stop the local ax-engine server on quit so the loaded model is
      // unloaded and GPU/RAM is freed. No-op when we never started one
      // (e.g. an externally managed server has no tracked state).
      await stopAxEngineServer().catch((error) => {
        Log.Default.warn("ax-engine server stop failed", { error })
      })
      if (server) {
        const current = server
        server = undefined
        await current.stop(true)
      }
    })()
    return shutdownPromise
  },
  eventStatus() {
    return eventStream.status
  },
}

export async function startTuiBackend(transport: "worker" | "stdio" = "worker") {
  if (transport === "stdio") {
    const done = Rpc.listenStdio(rpc)
    // Process transport: signal-driven cleanup. The thread's
    // `child.kill()` lands as SIGTERM here; without these handlers the
    // process would die before draining `Instance.disposeAll()` /
    // `server.stop()`, leaking MCP child processes and the GlobalBus
    // listener.
    const onSignal = (signal: NodeJS.Signals) => {
      DiagnosticLog.recordProcess("backend.signalShutdown", { signal })
      void rpc
        .shutdown()
        .catch((error) => {
          DiagnosticLog.recordProcess("backend.signalShutdownFailed", { signal, error })
        })
        .finally(() => {
          DiagnosticLog.recordProcess("backend.signalExit", { signal })
          process.exit(signal === "SIGINT" ? 130 : 0)
        })
    }
    // SIGHUP added to the original SIGTERM/SIGINT set so SSH disconnect
    // and terminal close also drain MCP children, LSP servers, the HTTP
    // server, and the event-stream reconnect timer instead of orphaning
    // them. SIGQUIT too — ^\ shouldn't leak resources just because we
    // didn't bother to register it.
    removeSignalHandlers = registerShutdownSignals(onSignal)
    await startEventStream({ directory: process.cwd() })
    await done
    // Awaited shutdown after stdin closes. Covers the parent-crash
    // path where the OS closes our stdin pipe but never delivers a
    // SIGTERM (e.g. `kill -9` on the thread): without this, the
    // backend would orphan, holding MCP servers, LSP children, the
    // HTTP server, and the event stream reconnect timer alive.
    // shutdown() is idempotent — a second call after a SIGTERM-driven
    // fire-and-forget shutdown is a no-op.
    await rpc.shutdown().catch((error) => {
      DiagnosticLog.recordProcess("backend.exitShutdownFailed", { error })
    })
    return
  }
  Rpc.listen(rpc)
  // Worker transport: same intent, in case the runtime forwards a
  // signal before `worker.terminate()` lands. Idempotent against the
  // explicit `shutdown` RPC the thread normally invokes first. SIGHUP
  // and SIGQUIT included for parity with the stdio branch above.
  const onSignal = (signal: NodeJS.Signals) => {
    DiagnosticLog.recordProcess("worker.signalShutdown", { signal })
    void rpc.shutdown().catch((error) => {
      DiagnosticLog.recordProcess("worker.signalShutdownFailed", { signal, error })
    })
  }
  removeSignalHandlers = registerShutdownSignals(onSignal)
  await startEventStream({ directory: process.cwd() })
}

function isWorkerEntrypoint() {
  const entry = process.argv[1]
  return typeof entry === "string" && /(?:^|[/\\])worker\.(?:ts|js)$/.test(entry)
}

// Do not use `import.meta.main` here. In Bun's single-file compiled
// runtime, importing this module from the `tui-backend` command can still
// make the module look like the main entrypoint. That binds the Worker RPC
// transport before the command can bind stdio, and the packaged TUI backend
// never completes its readiness handshake.
if (isWorkerEntrypoint()) {
  await startTuiBackend("worker")
}

function getAuthorizationHeader(): string | undefined {
  const password = Flag.AX_CODE_SERVER_PASSWORD
  if (!password) return undefined
  const username = Flag.AX_CODE_SERVER_USERNAME ?? "ax-code"
  return `Basic ${btoa(`${username}:${password}`)}`
}
