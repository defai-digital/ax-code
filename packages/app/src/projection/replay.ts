import { applyHeadlessProjectionEvent, createHeadlessProjectionState } from "@ax-code/sdk/headless/projection"
import {
  fixtureScenarioByName,
  fixtureHeadlessEvents,
  fixtureQueueItems,
  fixtureRuntimeCatalog,
  fixtureScheduledTasks,
  fixtureSelectedSessionID,
  fixtureSessionEvidence,
  fixtureTerminals,
  fixtureWorktrees,
  type AppFixtureScenario,
  type AppFixtureScenarioName,
} from "../fixtures/headless"
import type { AppCommandCenterState, AppHeadlessEvent, AppProjectionState, AppQueueItem } from "./types"

export function replayAppProjection(events: readonly AppHeadlessEvent[]): AppProjectionState {
  const state = createHeadlessProjectionState<
    AppProjectionState["session"][number],
    AppProjectionState["todo"][string][number],
    AppProjectionState["session_diff"][string][number],
    NonNullable<AppProjectionState["session_status"][string]>,
    AppProjectionState["message"][string][number],
    AppProjectionState["part"][string][number],
    unknown,
    NonNullable<AppProjectionState["session_goal"][string]>,
    AppQueueItem
  >()

  for (const event of events) {
    applyHeadlessProjectionEvent(state, structuredClone(event))
  }

  return state
}

export function createFixtureCommandCenterStateFromScenario(
  input: AppFixtureScenarioName | AppFixtureScenario,
): AppCommandCenterState {
  const scenario = typeof input === "string" ? fixtureScenarioByName(input) : input
  const projection = replayAppProjection(scenario.events)

  return {
    projection,
    queue: [...(scenario.queue ?? projection.task_queue)],
    evidence: { ...(scenario.evidence ?? {}) },
    catalog: scenario.catalog ?? fixtureRuntimeCatalog,
    worktrees: [...(scenario.worktrees ?? [])],
    terminals: [...(scenario.terminals ?? [])],
    scheduledTasks: [...(scenario.scheduledTasks ?? [])],
    selectedSessionID: scenario.selectedSessionID,
  }
}

export function createFixtureCommandCenterState(): AppCommandCenterState {
  return {
    projection: replayAppProjection(fixtureHeadlessEvents),
    queue: [...fixtureQueueItems],
    evidence: { ...fixtureSessionEvidence },
    catalog: fixtureRuntimeCatalog,
    worktrees: [...fixtureWorktrees],
    terminals: [...fixtureTerminals],
    scheduledTasks: [...fixtureScheduledTasks],
    selectedSessionID: fixtureSelectedSessionID,
  }
}

export function queueSummary(items: readonly AppQueueItem[]) {
  return {
    total: items.length,
    running: items.filter((item) => item.status === "running").length,
    blocked: items.filter((item) => item.status === "blocked_permission" || item.status === "blocked_question").length,
    queued: items.filter((item) => item.status === "queued" || item.status === "waiting_for_idle").length,
  }
}
