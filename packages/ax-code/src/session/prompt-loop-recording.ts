import { Recorder } from "../replay/recorder"
import { BlastRadius } from "./blast-radius"
import type { SessionID } from "./schema"

export type PromptLoopEndReason = "completed" | "aborted" | "error" | "step_limit" | "stalled"

type PromptLoopRecordingDeps = {
  begin: typeof Recorder.begin
  emit: typeof Recorder.emit
  end: typeof Recorder.end
  resetBlastRadius: typeof BlastRadius.reset
}

const defaultDeps: PromptLoopRecordingDeps = {
  begin: (sessionID) => Recorder.begin(sessionID),
  emit: (event) => Recorder.emit(event),
  end: (sessionID) => Recorder.end(sessionID),
  resetBlastRadius: (sessionID) => BlastRadius.reset(sessionID),
}

export function beginPromptLoopRecording(sessionID: SessionID, deps: Pick<PromptLoopRecordingDeps, "begin"> = defaultDeps) {
  deps.begin(sessionID)
}

export async function finishPromptLoopRecording(
  input: {
    sessionID: SessionID
    sessionStarted: boolean
    isResumingActiveLoop: boolean
    reason: PromptLoopEndReason
    totalSteps: number
  },
  deps: Omit<PromptLoopRecordingDeps, "begin"> = defaultDeps,
) {
  if (input.sessionStarted && !input.isResumingActiveLoop) {
    deps.emit({
      type: "session.end",
      sessionID: input.sessionID,
      reason: input.reason,
      totalSteps: input.totalSteps,
    })
  }
  await deps.end(input.sessionID)
  deps.resetBlastRadius(input.sessionID)
}
