import { createFixtureCommandCenterState } from "../projection/replay"
import { createCommandCenterViewModel } from "../projection/view-model"
import { followLiveCommandCenterEventsWithReconnect } from "../runtime/live"
import { mkdir, writeFile } from "node:fs/promises"
import path from "node:path"
import { parseArgs } from "node:util"
import {
  runCommandCenterPerformanceSmoke,
  type CommandCenterPerformanceSmokeOptions,
  type CommandCenterPerformanceSmokeResult,
} from "./smoke"

export type CommandCenterReconnectSmokeResult = {
  attempts: number
  appliedCount: number
  statuses: string[]
  reconnectedSessionPresent: boolean
  reconnectedQueuePresent: boolean
  visibleSessions: number
  visibleQueueItems: number
  withinBudget: boolean
}

export type CommandCenterBetaQaSmokeResult = {
  longSession: CommandCenterPerformanceSmokeResult
  reconnect: CommandCenterReconnectSmokeResult
  withinBudget: boolean
}

export async function runCommandCenterBetaQaSmoke(
  options: {
    longSession?: CommandCenterPerformanceSmokeOptions
  } = {},
): Promise<CommandCenterBetaQaSmokeResult> {
  const longSession = runCommandCenterPerformanceSmoke(options.longSession)
  const reconnect = await runReconnectSmoke()
  return {
    longSession,
    reconnect,
    withinBudget: longSession.withinBudget && reconnect.withinBudget,
  }
}

async function runReconnectSmoke(): Promise<CommandCenterReconnectSmokeResult> {
  const state = createFixtureCommandCenterState()
  const statuses: string[] = []
  let subscriptions = 0

  const result = await followLiveCommandCenterEventsWithReconnect(
    state,
    () => ({
      subscribe: async function* () {
        subscriptions++
        if (subscriptions === 1) throw new Error("synthetic stream disconnect")
        yield {
          type: "session.created",
          properties: {
            info: {
              id: "qa_reconnected_session",
              title: "Reconnected beta QA session",
              project: "ax-code",
              updatedAt: Date.now(),
            },
          },
        }
        yield {
          type: "task.queue.updated",
          properties: {
            item: {
              id: "qa_reconnected_queue",
              projectID: "ax-code",
              directory: "/workspace/ax-code",
              sessionID: "qa_reconnected_session",
              kind: "prompt",
              status: "running",
              priority: 10,
              position: 0,
              title: "Reconnect follow-up",
              payload: {},
              time: { created: Date.now() },
            },
          },
        }
      },
    }),
    {
      maxAttempts: 2,
      retryDelayMs: 0,
      onStatus: (status) => statuses.push(status),
    },
  )
  const view = createCommandCenterViewModel(state)
  const reconnectedSessionPresent = view.sessions.some((session) => session.id === "qa_reconnected_session")
  const reconnectedQueuePresent = view.queue.some((item) => item.id === "qa_reconnected_queue")

  return {
    attempts: result.attempts,
    appliedCount: result.appliedCount,
    statuses,
    reconnectedSessionPresent,
    reconnectedQueuePresent,
    visibleSessions: view.sessions.length,
    visibleQueueItems: view.queue.length,
    withinBudget:
      result.attempts === 2 &&
      result.appliedCount === 2 &&
      statuses.join(",") === "connecting,error,connecting,connected,connected" &&
      reconnectedSessionPresent &&
      reconnectedQueuePresent,
  }
}

if (import.meta.main) {
  const { values } = parseArgs({
    args: process.argv.slice(2),
    options: {
      output: { type: "string" },
    },
    strict: true,
    allowPositionals: false,
  })
  const result = await runCommandCenterBetaQaSmoke()
  const json = JSON.stringify(result, null, 2)
  if (values.output) {
    await mkdir(path.dirname(values.output), { recursive: true })
    await writeFile(values.output, `${json}\n`)
  }
  console.log(json)
  if (!result.withinBudget) throw new Error("Command-center beta QA smoke failed")
}
