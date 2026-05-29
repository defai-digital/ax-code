import { applyHeadlessProjectionEvent, createHeadlessProjectionState } from "@ax-code/sdk/headless/projection"
import {
  fixtureHeadlessEvents,
  fixtureQueueItems,
  fixtureRuntimeCatalog,
  fixtureScheduledTasks,
  fixtureSelectedSessionID,
  fixtureSessionEvidence,
  fixtureTerminals,
  fixtureWorktrees,
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
    NonNullable<AppProjectionState["session_goal"][string]>
  >()

  for (const event of events) {
    applyHeadlessProjectionEvent(state, event)
  }

  return state
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
