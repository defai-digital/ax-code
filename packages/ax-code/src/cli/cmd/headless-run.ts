import { cmd } from "./cmd"
import { bootstrap } from "../bootstrap"
import { Filesystem } from "@/util/filesystem"
import { internalBaseUrl, isInternalHostname } from "@/util/internal-url"
import { buildAttachAuthHeaders } from "../attach-auth"
import { DEFAULT_SERVER_PORT } from "@/server/constants"
import type {
  HeadlessEventSink,
  HeadlessRuntimeCommand,
} from "@/runtime/headless"
import path from "node:path"

type FetchHandler = (request: Request) => Response | Promise<Response>

function assertInternalUrl(url: URL) {
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(`Internal fetch rejected: unsupported protocol ${url.protocol}`)
  }
  if (!isInternalHostname(url.hostname)) throw new Error(`Internal fetch rejected: ${url.hostname}`)
}

function createInternalFetch(handler: FetchHandler, headers?: Record<string, string>): typeof globalThis.fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init)
    assertInternalUrl(new URL(request.url))
    if (headers) {
      for (const [key, value] of Object.entries(headers)) {
        if (!request.headers.has(key)) request.headers.set(key, value)
      }
    }
    return handler(request)
  }) as typeof globalThis.fetch
}

export const HeadlessRunCommand = cmd({
  command: "headless-run [message..]",
  describe: false,
  builder: (yargs) =>
    yargs
      .positional("message", {
        describe: "message to send",
        type: "string",
        array: true,
        default: [],
      })
      .option("session", {
        alias: ["s"],
        describe: "session id to continue",
        type: "string",
      })
      .option("command", {
        describe: "slash command to run; message is passed as command arguments",
        type: "string",
      })
      .option("agent", {
        describe: "agent to use",
        type: "string",
      })
      .option("model", {
        alias: ["m"],
        describe: "model to use in provider/model format",
        type: "string",
      })
      .option("dir", {
        describe: "directory to run in",
        type: "string",
      })
      .option("attach", {
        describe: `attach to a running ax-code server, e.g. http://localhost:${DEFAULT_SERVER_PORT}`,
        type: "string",
      })
      .option("password", {
        alias: ["p"],
        describe: "basic auth password for --attach; defaults to AX_CODE_SERVER_PASSWORD",
        type: "string",
      })
      .option("autonomous", {
        describe: "auto-answer permission/question prompts through the headless effect policy",
        type: "boolean",
        default: true,
      })
      .option("idleTimeoutMs", {
        alias: ["idle-timeout-ms"],
        describe:
          "abort if the headless session emits no events for this long (inactivity timeout — a busy long run keeps resetting it); set 0 to disable",
        type: "number",
        default: 10 * 60 * 1000,
      })
      .option("eventLog", {
        alias: ["event-log"],
        describe: "also write raw headless JSONL events to this file",
        type: "string",
      })
      .option("transportSmoke", {
        alias: ["transport-smoke"],
        describe: "only verify backend subscription and event-log plumbing; does not create a session or send a prompt",
        type: "boolean",
        default: false,
      })
      .option("commandSmoke", {
        alias: ["command-smoke"],
        describe: "create a session and send a non-provider abort command to verify command-route plumbing",
        type: "boolean",
        default: false,
      }),
  handler: async (args) => {
    const { Server } = await import("@/server/server")
    const { ServerRuntimeAuth } = await import("@/server/runtime-auth")
    const { Provider } = await import("@/provider/provider")
    const {
      createHeadlessAgentRuntime,
      createHeadlessCompositeEventSink,
      createHeadlessJsonlEventSink,
      headlessSessionErrorMessage,
      isHeadlessSessionIdleEvent,
      runHeadlessSession,
    } = await import("@/runtime/headless")
    const { createHeadlessJsonlFileEventSink } = await import("@/runtime/headless/event-sink-node")
    const callerCwd = Filesystem.callerCwd()
    const directory = (() => {
      if (args.attach) return args.dir
      if (!args.dir) return callerCwd
      const next = path.resolve(callerCwd, args.dir)
      process.chdir(next)
      return process.cwd()
    })()

    let message = [...args.message, ...(args["--"] || [])].join(" ")
    if (!process.stdin.isTTY) {
      const chunks: Buffer[] = []
      for await (const chunk of process.stdin) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
      }
      message += "\n" + Buffer.concat(chunks).toString("utf8")
    }
    if (!message.trim() && !args.command && !args.transportSmoke && !args.commandSmoke) {
      throw new Error("headless-run requires a message, --command, --transport-smoke, or --command-smoke")
    }

    const runWithBackend = async (input: { baseUrl: string; fetch: typeof fetch }) => {
      const runtime = createHeadlessAgentRuntime({
        baseUrl: input.baseUrl,
        directory,
        fetch: input.fetch,
      })
      let sessionID: string | undefined
      let command: HeadlessRuntimeCommand | undefined

      if (!args.transportSmoke) {
        sessionID =
          args.session ?? (await runtime.createSession({ title: message.trim().slice(0, 50) || undefined })).id

        command = args.commandSmoke
          ? {
              type: "session.abort",
              sessionID,
            }
          : args.command
            ? {
                type: "session.command",
                mode: "async",
                sessionID,
                body: {
                  command: args.command,
                  arguments: message,
                  agent: args.agent,
                  model: args.model,
                },
              }
            : {
                type: "session.prompt",
                mode: "async",
                sessionID,
                body: {
                  agent: args.agent,
                  model: args.model ? Provider.parseModel(args.model) : undefined,
                  parts: [{ type: "text", text: message }],
                },
              }
      }

      const abort = new AbortController()
      const onSignal = () => abort.abort()
      const idleTimeoutMs =
        typeof args.idleTimeoutMs === "number" && Number.isFinite(args.idleTimeoutMs) && args.idleTimeoutMs > 0
          ? args.idleTimeoutMs
          : undefined
      let timedOut = false
      let idleTimer: ReturnType<typeof setTimeout> | undefined
      // Inactivity timer, re-armed on every event: a productive multi-hour
      // run (Super-Long, goals) streams events continuously and must not be
      // killed at a fixed deadline, while a genuinely hung session (e.g. a
      // permission ask nobody can answer) goes silent and still aborts.
      const armIdleTimer = () => {
        if (!idleTimeoutMs) return
        if (idleTimer) clearTimeout(idleTimer)
        idleTimer = setTimeout(() => {
          idleTimer = undefined
          timedOut = true
          abort.abort()
        }, idleTimeoutMs)
        idleTimer.unref?.()
      }
      armIdleTimer()
      const eventSinks: HeadlessEventSink[] = [
        createHeadlessJsonlEventSink((line) => {
          process.stdout.write(line)
        }),
      ]
      if (args.eventLog && args.eventLog !== "-") {
        const eventLogPath = path.resolve(callerCwd, args.eventLog)
        eventSinks.push(await createHeadlessJsonlFileEventSink(eventLogPath))
      }
      const eventSink = createHeadlessCompositeEventSink(eventSinks)
      let sessionError: string | undefined
      process.on("SIGINT", onSignal)
      process.on("SIGTERM", onSignal)
      try {
        await runHeadlessSession({
          baseUrl: input.baseUrl,
          directory,
          fetch: input.fetch,
          runtime,
          signal: abort.signal,
          command,
          eventSink,
          autonomous: args.autonomous,
          onRawEvent(event) {
            armIdleTimer()
            if (sessionID) sessionError = sessionError ?? headlessSessionErrorMessage(event, sessionID)
          },
          stopWhen({ event }) {
            if (args.transportSmoke || args.commandSmoke) return event.type === "server.connected"
            return isHeadlessSessionIdleEvent(event, sessionID)
          },
        })
        if (idleTimer) {
          clearTimeout(idleTimer)
          idleTimer = undefined
        }
        if (timedOut) {
          const target = args.transportSmoke || args.commandSmoke ? "server.connected" : "session idle"
          process.stderr.write(`headless-run aborted: no events for ${idleTimeoutMs}ms while waiting for ${target}\n`)
          process.exitCode = 124
        } else if (sessionError) {
          process.exitCode = 1
        }
      } finally {
        if (idleTimer) clearTimeout(idleTimer)
        process.off("SIGINT", onSignal)
        process.off("SIGTERM", onSignal)
      }
    }

    if (args.attach) {
      const attachUrl = new URL(args.attach)
      assertInternalUrl(attachUrl)
      const headers = buildAttachAuthHeaders(args.password)
      const fetchFn = createInternalFetch((request) => fetch(request), headers)
      await runWithBackend({ baseUrl: args.attach, fetch: fetchFn })
      return
    }

    await bootstrap(directory ?? callerCwd, async () => {
      const fetchFn = createInternalFetch((request) => {
        ServerRuntimeAuth.apply(request.headers)
        return Server.Default().fetch(request)
      })

      await runWithBackend({ baseUrl: internalBaseUrl(), fetch: fetchFn })
    })
  },
})
