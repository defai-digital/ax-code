import { EOL } from "os"
import type { Argv } from "yargs"
import path from "node:path"
import { bootstrap, bootstrapReadonly } from "../bootstrap"
import { cmd } from "./cmd"
import { Filesystem } from "@/util/filesystem"
import { internalBaseUrl } from "@/util/internal-url"
import { buildAttachAuthHeaders } from "../attach-auth"
import { DEFAULT_SERVER_PORT } from "@/server/constants"
import { assertLoopbackHttpUrl } from "@/runtime/listen-security"
import type { HeadlessRuntimeCommand } from "@/runtime/headless"
import { SessionGoal } from "../../session/goal"
import { SessionID } from "../../session/schema"

function jsonOption() {
  return {
    type: "boolean" as const,
    describe: "output machine-readable JSON",
  }
}

function writeJson(value: unknown) {
  process.stdout.write(JSON.stringify(value, null, 2) + EOL)
}

// Statuses a bare `goal resume` may pick on its own. A complete goal would be
// reactivated and a budget-limited one refused, so neither is a safe default.
const RESUMABLE_STATUSES = new Set(["paused", "blocked", "active"])

const RESUMABLE_GOAL_SESSION_DESCRIBE = "session id (defaults to the project's single resumable goal)"
const ANY_GOAL_SESSION_DESCRIBE = "session id (defaults to the project's single goal)"

/**
 * Resolve which session `goal resume` targets. An explicit --session wins;
 * otherwise the project's single resumable goal is picked. More than one
 * resumable goal is an error rather than a guess — resuming reactivates the
 * goal and starts burning budget, so the wrong pick is expensive.
 */
export async function resolveGoalSession(sessionID: string | undefined): Promise<SessionID> {
  if (sessionID) return SessionID.make(sessionID)
  const goals = await SessionGoal.list()
  const resumable = goals.filter((goal) => RESUMABLE_STATUSES.has(goal.status))
  if (resumable.length === 0) {
    throw new Error(
      goals.length === 0
        ? "No goal is set in this project."
        : "No resumable goal (paused, blocked, or active) in this project; pass --session explicitly.",
    )
  }
  if (resumable.length > 1) {
    throw new Error(
      `Multiple sessions have resumable goals: ${resumable.map((goal) => goal.sessionID).join(", ")} — pass --session.`,
    )
  }
  return resumable[0]!.sessionID
}

/**
 * Resolve which session a non-resume goal command (status/pause/clear)
 * targets. These only inspect or stop the goal — they never reactivate it —
 * so any existing goal resolves regardless of status.
 */
export async function resolveAnyGoalSession(sessionID: string | undefined): Promise<SessionID> {
  if (sessionID) return SessionID.make(sessionID)
  const goals = await SessionGoal.list()
  if (goals.length === 0) throw new Error("No goal is set in this project.")
  if (goals.length > 1) {
    throw new Error(`Multiple sessions have goals: ${goals.map((goal) => goal.sessionID).join(", ")} — pass --session.`)
  }
  return goals[0]!.sessionID
}

/**
 * Exit-code contract for `goal resume` (kimi-code headless parity):
 * 0 complete, 3 blocked, 4 budget-limited, 6 paused/non-terminal at idle,
 * 1 session error, 124 idle timeout.
 */
export function goalResumeExitCode(input: { goalStatus?: string; sessionError?: string; timedOut: boolean }): number {
  if (input.timedOut) return 124
  if (input.sessionError) return 1
  switch (input.goalStatus) {
    case "complete":
      return 0
    case "blocked":
      return 3
    case "budget_limited":
      return 4
    case "paused":
      return 6
    default:
      return 6
  }
}

function goalStatusFromEvent(event: unknown, sessionID: string): string | undefined {
  const typed = event as { type?: string; properties?: { sessionID?: string; goal?: { status?: string } | null } }
  if (typed?.type !== "session.goal") return undefined
  if (typed.properties?.sessionID !== sessionID) return undefined
  return typed.properties.goal?.status
}

function sessionFilter<T>(yargs: Argv<T>, describe = RESUMABLE_GOAL_SESSION_DESCRIBE) {
  return yargs.option("session", {
    alias: ["s"],
    type: "string",
    describe,
  })
}

function dirOption<T>(yargs: Argv<T>) {
  return yargs.option("dir", {
    describe: "directory of the project (defaults to the current directory)",
    type: "string",
  })
}

const GoalStatusCommand = cmd({
  command: "status",
  describe: "show the current session goal",
  builder: (yargs: Argv) => dirOption(sessionFilter(yargs, ANY_GOAL_SESSION_DESCRIBE)).option("json", jsonOption()),
  async handler(args) {
    await bootstrapReadonly(args.dir ?? process.cwd(), async () => {
      const sessionID = await resolveAnyGoalSession(args.session)
      const goal = await SessionGoal.get(sessionID)
      if (args.json) {
        writeJson(goal ? SessionGoal.publicInfo(goal) : null)
        return
      }
      process.stdout.write(SessionGoal.format(goal) + EOL)
    })
  },
})

const GoalPauseCommand = cmd({
  command: "pause",
  describe: "pause the current session goal",
  builder: (yargs: Argv) => dirOption(sessionFilter(yargs, ANY_GOAL_SESSION_DESCRIBE)),
  async handler(args) {
    await bootstrap(args.dir ?? process.cwd(), async () => {
      const sessionID = await resolveAnyGoalSession(args.session)
      const current = await SessionGoal.get(sessionID)
      const refusal = goalPauseRefusal(current)
      if (refusal) throw new Error(refusal)
      const goal = await SessionGoal.pause(sessionID)
      process.stdout.write(SessionGoal.format(goal) + EOL)
    })
  },
})

/**
 * Pausing a terminal goal would silently demote it to "paused", from which a
 * bare `goal resume` could resurrect work that already finished (or is
 * budget-exhausted and must not be reactivated implicitly). Returns the
 * refusal message, or undefined when the goal can be paused.
 */
export function goalPauseRefusal(goal: SessionGoal.Info | undefined): string | undefined {
  if (!goal) return "No goal is set for this session."
  if (goal.status === "complete" || goal.status === "budget_limited") {
    return `Goal is already ${goal.status}; nothing to pause.`
  }
  return undefined
}

const GoalClearCommand = cmd({
  command: "clear",
  describe: "clear the current session goal and its plan",
  builder: (yargs: Argv) => dirOption(sessionFilter(yargs, ANY_GOAL_SESSION_DESCRIBE)),
  async handler(args) {
    await bootstrap(args.dir ?? process.cwd(), async () => {
      const sessionID = await resolveAnyGoalSession(args.session)
      await SessionGoal.clear(sessionID)
      process.stdout.write("Goal cleared for this session." + EOL)
    })
  },
})

const GoalResumeCommand = cmd({
  command: "resume",
  describe: "resume the session goal and drive it until it settles",
  builder: (yargs: Argv) =>
    sessionFilter(yargs)
      .option("dir", {
        describe: "directory of the project",
        type: "string",
      })
      .option("attach", {
        describe: `attach to a running ax-code server, e.g. http://localhost:${DEFAULT_SERVER_PORT}`,
        type: "string",
      })
      .option("password", {
        describe: "basic auth password for --attach; defaults to AX_CODE_SERVER_PASSWORD",
        type: "string",
      })
      .option("model", {
        alias: ["m"],
        describe: "model to use in provider/model format (only needed when the plan must be rewritten)",
        type: "string",
      })
      .option("agent", {
        describe: "agent to use",
        type: "string",
      })
      .option("autonomous", {
        describe: "auto-answer permission/question prompts through the headless effect policy",
        type: "boolean",
        default: true,
      })
      .option("idle-timeout-ms", {
        describe:
          "abort if the session emits no events for this long (inactivity timeout — a busy long run keeps resetting it); set 0 to disable",
        type: "number",
        default: 10 * 60 * 1000,
      })
      .option("event-log", {
        describe: "also write raw headless JSONL events to this file",
        type: "string",
      }),
  async handler(args) {
    const { createInternalFetch } = await import("./headless-run")
    const callerCwd = Filesystem.callerCwd()
    const directory = (() => {
      if (args.attach) return args.dir
      if (!args.dir) return callerCwd
      const next = path.resolve(callerCwd, args.dir)
      process.chdir(next)
      return process.cwd()
    })()
    const target = directory ?? callerCwd

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

    const sessionID = await bootstrapReadonly(target, () => resolveGoalSession(args.session))
    const goal = await bootstrapReadonly(target, () => SessionGoal.get(sessionID))
    if (!goal) throw new Error(`No goal is set for session ${sessionID}.`)
    if (!RESUMABLE_STATUSES.has(goal.status)) {
      throw new Error(
        `Goal is ${goal.status}; only paused, blocked, or active goals can be resumed (clear it first to start over).`,
      )
    }

    const command: HeadlessRuntimeCommand = {
      type: "session.command",
      mode: "async",
      sessionID,
      body: {
        command: "goal",
        arguments: "resume",
        agent: args.agent,
        model: args.model ? Provider.parseModel(args.model) : undefined,
      },
    }

    const abort = new AbortController()
    const onSignal = () => abort.abort()
    const idleTimeoutMs =
      typeof args["idle-timeout-ms"] === "number" &&
      Number.isFinite(args["idle-timeout-ms"]) &&
      args["idle-timeout-ms"] > 0
        ? args["idle-timeout-ms"]
        : undefined
    let timedOut = false
    let idleTimer: ReturnType<typeof setTimeout> | undefined
    let goalStatus: string | undefined
    let sessionError: string | undefined
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

    const runWithBackend = async (input: { baseUrl: string; fetch: typeof fetch }) => {
      const runtime = createHeadlessAgentRuntime({
        baseUrl: input.baseUrl,
        directory: target,
        fetch: input.fetch,
      })
      const eventSinks = [
        createHeadlessJsonlEventSink((line) => {
          process.stdout.write(line)
        }),
      ]
      if (args["event-log"] && args["event-log"] !== "-") {
        eventSinks.push(await createHeadlessJsonlFileEventSink(args["event-log"], callerCwd))
      }
      const eventSink = createHeadlessCompositeEventSink(eventSinks)
      process.on("SIGINT", onSignal)
      process.on("SIGTERM", onSignal)
      try {
        await runHeadlessSession({
          baseUrl: input.baseUrl,
          directory: target,
          fetch: input.fetch,
          runtime,
          signal: abort.signal,
          command,
          eventSink,
          autonomous: args.autonomous,
          onRawEvent(event) {
            armIdleTimer()
            goalStatus = goalStatusFromEvent(event, sessionID) ?? goalStatus
            sessionError = sessionError ?? headlessSessionErrorMessage(event, sessionID)
          },
          stopWhen({ event }) {
            return isHeadlessSessionIdleEvent(event, sessionID)
          },
        })
      } finally {
        if (idleTimer) clearTimeout(idleTimer)
        process.off("SIGINT", onSignal)
        process.off("SIGTERM", onSignal)
      }
    }

    if (args.attach) {
      assertLoopbackHttpUrl(args.attach, "--attach URL")
      const headers = buildAttachAuthHeaders(args.password)
      const fetchFn = createInternalFetch((request) => fetch(request), headers)
      await runWithBackend({ baseUrl: args.attach, fetch: fetchFn })
    } else {
      const { Server } = await import("@/server/server")
      const { ServerRuntimeAuth } = await import("@/server/runtime-auth")
      await bootstrap(target, async () => {
        const fetchFn = createInternalFetch((request) => {
          ServerRuntimeAuth.apply(request.headers)
          return Server.Default().fetch(request)
        })
        await runWithBackend({ baseUrl: internalBaseUrl(), fetch: fetchFn })
      })
    }

    if (timedOut) {
      process.stderr.write(`goal resume aborted: no events for ${idleTimeoutMs}ms while waiting for session idle${EOL}`)
    }
    const exitCode = goalResumeExitCode({ goalStatus, sessionError, timedOut })
    process.exitCode = exitCode
    if (goalStatus) {
      process.stderr.write(`Goal ${goalStatus}: ${goal.objective}${EOL}`)
    } else if (sessionError) {
      process.stderr.write(`goal resume failed: ${sessionError}${EOL}`)
    }
  },
})

export const GoalCommand = cmd({
  command: "goal",
  describe: "inspect and control session goals",
  builder: (yargs: Argv) =>
    yargs
      .command(GoalStatusCommand)
      .command(GoalPauseCommand)
      .command(GoalClearCommand)
      .command(GoalResumeCommand)
      .demandCommand(),
  async handler() {},
})
