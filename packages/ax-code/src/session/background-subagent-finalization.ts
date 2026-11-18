import { BackgroundShell } from "../tool/bash-background"
import { BackgroundNotification } from "./background-notification"
import { waitForNestedSubagentResults } from "./background-subagent-delivery"
import type { SessionID } from "./schema"
import { TaskQueue } from "./task-queue"

export const SUBAGENT_FINALIZATION_WINDOW_MS = 2 * 60 * 1000

const BACKGROUND_FINALIZE_PROMPT =
  `Background work started by this task has finished. ` +
  `Produce the final result for this task now in plain text, using bash_output to read any background shell output you have not consumed and including the evidence from any background tasks that completed. ` +
  `Do not start new shells or monitors, and do not delegate further. ` +
  `If the evidence is incomplete, explicitly say what was inspected and what remains unresolved.`

const BACKGROUND_ONGOING_PROMPT =
  `Background work started by this task is still running and did not finish within the available time. ` +
  `Produce the best final result for this task now in plain text, using bash_output to read any background output already produced. ` +
  `Say explicitly which background work (shells or tasks) is still running and what evidence remains pending. ` +
  `Do not start new shells or monitors, and do not delegate further.`

type SubagentBackgroundWork = {
  sessionID: SessionID
  shellPending: boolean
  nestedPending: boolean
  needsNestedCollection: boolean
}

export async function inspectSubagentBackgroundWork(
  sessionID: SessionID,
  since: number,
): Promise<SubagentBackgroundWork | undefined> {
  // Persistent monitors are progress. A shell completion notification or a
  // nested handoff from this execution still needs a final turn.
  const shellPending =
    BackgroundShell.list(sessionID).some((shell) => shell.status === "running" && shell.persistent !== true) ||
    BackgroundNotification.pendingCompletionCount(sessionID) > 0
  const nested = await TaskQueue.nestedSubagentWork({ sessionID, since })
  const needsNestedCollection = nested.pending || nested.settled
  if (!shellPending && !needsNestedCollection) return
  return { sessionID, shellPending, nestedPending: nested.pending, needsNestedCollection }
}

export async function prepareSubagentBackgroundFinalization(input: {
  work: SubagentBackgroundWork
  startedAt: number
  executionBudgetMs: number
  signal: AbortSignal
  tools?: Record<string, boolean>
}): Promise<{ timedOut: boolean; text: string; tools: Record<string, boolean> }> {
  const { sessionID, shellPending, nestedPending } = input.work
  const deadline = input.startedAt + input.executionBudgetMs - SUBAGENT_FINALIZATION_WINDOW_MS
  let timedOut = false
  if (shellPending) {
    const outcome = await BackgroundShell.waitForCompletion(sessionID, {
      signal: input.signal,
      timeoutMs: Math.max(0, deadline - Date.now()),
    })
    timedOut = outcome === "timeout"
  }
  if (nestedPending) {
    const outcome = await waitForNestedSubagentResults({
      sessionID,
      signal: input.signal,
      timeoutMs: Math.max(0, deadline - Date.now()),
    })
    timedOut ||= outcome === "timeout"
  }
  return {
    timedOut,
    text: timedOut ? BACKGROUND_ONGOING_PROMPT : BACKGROUND_FINALIZE_PROMPT,
    tools: { ...input.tools, bash: false, monitor: false, task: false, task_parallel: false },
  }
}
