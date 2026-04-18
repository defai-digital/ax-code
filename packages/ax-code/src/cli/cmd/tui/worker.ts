import { Installation } from "@/installation"
import { Server } from "@/server/server"
import { Log } from "@/util/log"
import { Instance } from "@/project/instance"
import { InstanceBootstrap } from "@/project/bootstrap"
import { Rpc } from "@/util/rpc"
import { upgrade } from "@/cli/upgrade"
import { Config } from "@/config/config"
import { GlobalBus } from "@/bus/global"
import { createOpencodeClient, type Event } from "@ax-code/sdk/v2"
import { Flag } from "@/flag/flag"
import { setTimeout as sleep } from "node:timers/promises"
import { writeHeapSnapshot } from "node:v8"
import { DiagnosticLog } from "@/debug/diagnostic-log"

const debugDir = process.env.AX_CODE_DEBUG === "1" ? process.env.AX_CODE_DEBUG_DIR : undefined
await DiagnosticLog.configure({
  enabled: Boolean(debugDir),
  dir: debugDir,
  includeContent: process.env.AX_CODE_DEBUG_INCLUDE_CONTENT === "1",
  manifest: {
    component: "tui-worker",
    version: Installation.VERSION,
    pid: process.pid,
    argv: process.argv.slice(2),
    cwd: process.cwd(),
  },
})
if (debugDir) DiagnosticLog.installProcessDiagnostics()

await Log.init({
  print: process.argv.includes("--print-logs"),
  dev: Installation.isLocal(),
  level: (() => {
    if (debugDir) return "DEBUG"
    if (Installation.isLocal()) return "DEBUG"
    return "INFO"
  })(),
  ...(debugDir ? { dir: debugDir, name: "tui-worker" } : {}),
})

process.on("unhandledRejection", (e) => {
  DiagnosticLog.recordProcess("worker.unhandledRejection", { error: e })
  Log.Default.error("rejection", {
    e: e instanceof Error ? e.message : e,
  })
})

process.on("uncaughtException", (e) => {
  DiagnosticLog.recordProcess("worker.uncaughtException", { error: e })
  Log.Default.error("exception", {
    e: e instanceof Error ? e.message : e,
  })
})

// Subscribe to global events and forward them via RPC
GlobalBus.on("event", (event) => {
  Rpc.emit("global.event", event)
})

let server: Awaited<ReturnType<typeof Server.listen>> | undefined

const eventStream = {
  abort: undefined as AbortController | undefined,
  directory: process.cwd(),
}

const startEventStream = (input: { directory?: string }) => {
  const directory = input.directory ?? process.cwd()
  if (eventStream.abort) eventStream.abort.abort()
  const abort = new AbortController()
  eventStream.abort = abort
  eventStream.directory = directory
  DiagnosticLog.recordProcess("worker.eventStreamStarted", { directory })
  const signal = abort.signal

  const fetchFn = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init)
    const auth = getAuthorizationHeader()
    if (auth) request.headers.set("Authorization", auth)
    return Server.Default().fetch(request)
  }) as typeof globalThis.fetch

  const sdk = createOpencodeClient({
    baseUrl: "http://opencode.internal",
    directory,
    fetch: fetchFn,
    signal,
  })

  ;(async () => {
    while (!signal.aborted) {
      const events = await Promise.resolve(
        sdk.event.subscribe(
          {},
          {
            signal,
          },
        ),
      ).catch(() => undefined)

      if (!events) {
        await sleep(250)
        continue
      }

      for await (const event of events.stream) {
        Rpc.emit("event", event as Event)
      }

      if (!signal.aborted) {
        await sleep(250)
      }
    }
  })().catch((error) => {
    DiagnosticLog.recordProcess("worker.eventStreamError", { error })
    Log.Default.error("event stream error", {
      error: error instanceof Error ? error.message : error,
    })
  })
}

startEventStream({ directory: process.cwd() })

export const rpc = {
  async fetch(input: { url: string; method: string; headers: Record<string, string>; body?: string }) {
    const headers = { ...input.headers }
    const auth = getAuthorizationHeader()
    if (auth && !headers["authorization"] && !headers["Authorization"]) {
      headers["Authorization"] = auth
    }
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
    DiagnosticLog.recordProcess("worker.serverStarted", {
      hostname: input.hostname,
      port: input.port,
      mdns: input.mdns,
    })
    return { url: server.url.toString() }
  },
  async checkUpgrade(input: { directory: string }) {
    await Instance.provide({
      directory: input.directory,
      init: InstanceBootstrap,
      fn: async () => {
        await upgrade().catch(() => {})
      },
    })
  },
  async reload() {
    Config.global.reset()
    await Instance.disposeAll()
  },
  async setWorkspace(input: { workspaceID?: string }) {
    const nextDirectory = input.workspaceID ?? process.cwd()
    const previousDirectory = eventStream.directory
    if (nextDirectory === previousDirectory) return
    Instance.runtimeSnapshot({
      trigger: "workspace_switch",
      directory: nextDirectory,
    })
    DiagnosticLog.recordProcess("runtime.workspaceSwitch", {
      from: previousDirectory,
      to: nextDirectory,
    })
    startEventStream({ directory: nextDirectory })
  },
  async shutdown() {
    Log.Default.info("worker shutting down")
    if (eventStream.abort) eventStream.abort.abort()
    await Instance.disposeAll()
    if (server) await server.stop(true)
  },
}

Rpc.listen(rpc)

function getAuthorizationHeader(): string | undefined {
  const password = Flag.AX_CODE_SERVER_PASSWORD
  if (!password) return undefined
  const username = Flag.AX_CODE_SERVER_USERNAME ?? "ax-code"
  return `Basic ${btoa(`${username}:${password}`)}`
}
