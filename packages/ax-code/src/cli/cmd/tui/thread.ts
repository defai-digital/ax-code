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
import type { Args } from "./context/args"
import { win32DisableProcessedInput, win32InstallCtrlCGuard } from "./win32"
import { TuiConfig } from "@/config/tui"
import { Instance } from "@/project/instance"
import { writeHeapSnapshot } from "v8"
import { DiagnosticLog } from "@/debug/diagnostic-log"
import { resolveTuiRendererName } from "./renderer-choice"
import type { TuiRendererName } from "./renderer-adapter/types"

declare global {
  const AX_CODE_WORKER_PATH: string
}

type RpcClient = ReturnType<typeof Rpc.client<typeof rpc>>

export type TuiThreadInput = {
  url: string
  onSnapshot: () => Promise<string[]>
  config: TuiConfig.Info
  directory: string
  fetch?: typeof fetch
  events?: EventSource
  args: Args
}

export function validateTuiThreadArgs(args: { fork?: boolean; continue?: boolean; session?: string }) {
  if (args.fork && !args.continue && !args.session) return "--fork requires --continue or --session"
}

export function resolveTuiThreadDirectory(project?: string) {
  const root = Filesystem.resolve(Filesystem.callerCwd())
  return project ? Filesystem.resolve(path.isAbsolute(project) ? project : path.join(root, project)) : root
}

export function createWorkerFetch(client: RpcClient): typeof fetch {
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

export function createEventSource(client: RpcClient): EventSource {
  return {
    on: (handler) => client.on<Event>("event", handler),
    setWorkspace: (workspaceID) => {
      void client.call("setWorkspace", { workspaceID })
    },
  }
}

async function target() {
  if (typeof AX_CODE_WORKER_PATH !== "undefined") return AX_CODE_WORKER_PATH
  const dist = new URL("./cli/cmd/tui/worker.js", import.meta.url)
  if (await Filesystem.exists(fileURLToPath(dist))) return dist
  return new URL("./worker.ts", import.meta.url)
}

async function input(value?: string) {
  const piped = process.stdin.isTTY ? undefined : await Bun.stdin.text()
  if (!value) return piped
  if (!piped) return value
  return piped + "\n" + value
}

export async function createTuiThreadTransport(input: {
  args: {
    port?: number
    hostname?: string
    mdns?: boolean
  }
  client: RpcClient
  argv?: string[]
  resolveNetwork?: (args: { port?: number; hostname?: string; mdns?: boolean }) => Promise<{
    hostname: string
    port: number
    mdns: boolean
  }>
}) {
  const resolveNetwork =
    input.resolveNetwork ??
    (async (args: { port?: number; hostname?: string; mdns?: boolean }) => {
      const network = await resolveNetworkOptions(args as Parameters<typeof resolveNetworkOptions>[0])
      return {
        hostname: network.hostname,
        port: network.port,
        mdns: network.mdns,
      }
    })
  const network = await resolveNetwork(input.args)
  const argv = input.argv ?? process.argv
  const external =
    argv.includes("--port") ||
    argv.includes("--hostname") ||
    argv.includes("--mdns") ||
    network.mdns ||
    network.port !== 0 ||
    network.hostname !== "127.0.0.1"

  return external
    ? {
        url: (await input.client.call("server", network)).url,
        fetch: undefined,
        events: undefined,
      }
    : {
        url: "http://opencode.internal",
        fetch: createWorkerFetch(input.client),
        events: createEventSource(input.client),
      }
}

export async function launchTuiThreadRenderer(
  input: TuiThreadInput,
  dependencies: {
    rendererName?: TuiRendererName
    runNativeTuiSlice?: (input: TuiThreadInput) => Promise<unknown>
    runOpentui?: (input: TuiThreadInput) => Promise<unknown>
    recordProcess?: (eventType: string, data?: Record<string, unknown>) => void
  } = {},
) {
  const rendererName = dependencies.rendererName ?? resolveTuiRendererName()
  const recordProcess = dependencies.recordProcess ?? DiagnosticLog.recordProcess

  if (rendererName === "native") {
    recordProcess("tui.threadLaunchNative", { directory: input.directory })
    const runNativeTuiSlice =
      dependencies.runNativeTuiSlice ?? (await import("./native/vertical-slice")).runNativeTuiSlice
    return runNativeTuiSlice(input)
  }

  recordProcess("tui.threadLaunchOpentui", { directory: input.directory })
  const runOpentui = dependencies.runOpentui ?? (await import("./app")).tui
  return runOpentui(input)
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

      const argError = validateTuiThreadArgs(args)
      if (argError) {
        UI.error(argError)
        process.exitCode = 1
        return
      }

      const next = resolveTuiThreadDirectory(args.project)
      const file = await target()
      try {
        process.chdir(next)
      } catch {
        UI.error("Failed to change directory to " + next)
        return
      }
      const cwd = Filesystem.resolve(process.cwd())
      const debugDir = process.env.AX_CODE_DEBUG === "1" ? process.env.AX_CODE_DEBUG_DIR : undefined

      await DiagnosticLog.configure({
        enabled: Boolean(debugDir),
        dir: debugDir,
        includeContent: process.env.AX_CODE_DEBUG_INCLUDE_CONTENT === "1",
        manifest: {
          component: "tui-thread",
          version: process.env["npm_package_version"],
          argv: process.argv,
          cwd,
        },
      })
      if (debugDir) DiagnosticLog.installProcessDiagnostics()
      DiagnosticLog.recordProcess("tui.threadStarted", { directory: cwd })

      const sanitized = Env.sanitize()
      const worker = new Worker(file, {
        env: Object.fromEntries(Object.entries(sanitized).filter((e): e is [string, string] => e[1] !== undefined)),
      })
      DiagnosticLog.recordProcess("tui.workerSpawned", { target: String(file) })
      worker.onerror = (e) => {
        DiagnosticLog.recordProcess("tui.workerError", { error: e })
        Log.Default.error(e)
      }
      worker.onmessageerror = (e) => {
        DiagnosticLog.recordProcess("tui.workerMessageError", { error: e })
        Log.Default.error(e)
      }

      const client = Rpc.client<typeof rpc>(worker)
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

      const transport = await createTuiThreadTransport({
        args,
        client,
      })
      DiagnosticLog.recordProcess("tui.threadTransportSelected", {
        mode: transport.fetch ? "internal" : "external",
      })

      const upgradeTimer = setTimeout(() => {
        client.call("checkUpgrade", { directory: cwd }).catch(() => {})
      }, 1000)
      upgradeTimer.unref?.()

      // Main-thread liveness ping for the worker watchdog. If the renderer
      // wedges in a synchronous loop, setInterval stops firing here, the
      // worker's watchdog sees the gap, and writes `tui.worker.mainStalled`.
      // Only install when diagnostic logging is on — zero overhead otherwise.
      const mainPingInterval = debugDir
        ? setInterval(() => {
            client.call("pingMain", { time: Date.now() }).catch(() => {
              // The worker may not accept pings while shutting down; drop.
            })
          }, 500)
        : undefined
      mainPingInterval?.unref?.()

      try {
        const tuiInput = {
          url: transport.url,
          async onSnapshot() {
            const tui = writeHeapSnapshot("tui.heapsnapshot")
            const server = await client.call("snapshot", undefined)
            return [tui, server]
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
        }

        await launchTuiThreadRenderer(tuiInput)
      } finally {
        clearTimeout(upgradeTimer)
        if (mainPingInterval) clearInterval(mainPingInterval)
        await stop()
      }
    } finally {
      unguard?.()
    }
    process.exit(0)
  },
})
