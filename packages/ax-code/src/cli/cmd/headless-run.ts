import { cmd } from "./cmd"
import { Filesystem } from "@/util/filesystem"
import {
  createHeadlessConsoleEventSinks,
  createHeadlessIdleAbort,
  headlessBackendOptions,
  resolveHeadlessWorkdir,
  withHeadlessBackend,
  withHeadlessGuards,
} from "./headless-shared"
import type { HeadlessRuntimeCommand } from "@/runtime/headless"
import { readNonTtyStdin } from "@/cli/stdin"

export const HeadlessRunCommand = cmd({
  command: "headless-run [message..]",
  describe: false,
  builder: (yargs) =>
    headlessBackendOptions(
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
        }),
    )
      .option("transport-smoke", {
        describe: "only verify backend subscription and event-log plumbing; does not create a session or send a prompt",
        type: "boolean",
        default: false,
      })
      .option("command-smoke", {
        describe: "create a session and send a non-provider abort command to verify command-route plumbing",
        type: "boolean",
        default: false,
      }),
  handler: async (args) => {
    const { Provider } = await import("@/provider/provider")
    const { createHeadlessAgentRuntime, headlessSessionErrorMessage, isHeadlessSessionIdleEvent, runHeadlessSession } =
      await import("@/runtime/headless")
    const callerCwd = Filesystem.callerCwd()
    const { directory } = resolveHeadlessWorkdir(args, callerCwd)

    let message = [...args.message, ...(args["--"] || [])].join(" ")
    if (!process.stdin.isTTY) {
      message += "\n" + (await readNonTtyStdin())
    }
    if (!message.trim() && !args.command && !args["transport-smoke"] && !args["command-smoke"]) {
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

      if (!args["transport-smoke"]) {
        sessionID =
          args.session ?? (await runtime.createSession({ title: message.trim().slice(0, 50) || undefined })).id

        command = args["command-smoke"]
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

      const idle = createHeadlessIdleAbort(args["idle-timeout-ms"])
      const eventSink = await createHeadlessConsoleEventSinks(args["event-log"], callerCwd)
      let sessionError: string | undefined
      await withHeadlessGuards(idle, async () => {
        await runHeadlessSession({
          baseUrl: input.baseUrl,
          directory,
          fetch: input.fetch,
          runtime,
          signal: idle.abort.signal,
          command,
          eventSink,
          autonomous: args.autonomous,
          onRawEvent(event) {
            idle.arm()
            if (sessionID) sessionError = sessionError ?? headlessSessionErrorMessage(event, sessionID)
          },
          stopWhen({ event }) {
            if (args["transport-smoke"] || args["command-smoke"]) return event.type === "server.connected"
            return isHeadlessSessionIdleEvent(event, sessionID)
          },
        })
        idle.stop()
        if (idle.timedOut) {
          const target = args["transport-smoke"] || args["command-smoke"] ? "server.connected" : "session idle"
          process.stderr.write(`headless-run aborted: no events for ${idle.timeoutMs}ms while waiting for ${target}\n`)
          process.exitCode = 124
        } else if (sessionError) {
          process.exitCode = 1
        }
      })
    }

    await withHeadlessBackend(args, directory ?? callerCwd, runWithBackend)
  },
})
