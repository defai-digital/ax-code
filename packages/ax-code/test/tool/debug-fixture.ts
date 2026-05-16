import { computeDebugCaseId } from "../../src/debug-engine/runtime-debug"
import { Installation } from "../../src/installation"
import { Recorder } from "../../src/replay/recorder"
import type { SessionID } from "../../src/session/schema"

export function fakeCtx(sessionID: string) {
  return {
    sessionID,
    messageID: "" as any,
    agent: "build",
    abort: new AbortController().signal,
    callID: "test",
    messages: [],
    metadata() {},
    ask: async () => {},
  } as any
}

export async function emitOpenedCase(sessionID: SessionID, directory: string, problem: string) {
  const caseId = computeDebugCaseId({ problem, runId: sessionID })
  Recorder.begin(sessionID)
  Recorder.emit({
    type: "session.start",
    sessionID: sessionID as any,
    agent: "build",
    model: "test/model",
    directory,
  })
  Recorder.emit({
    type: "tool.result",
    sessionID: sessionID as any,
    tool: "debug_open_case",
    callID: "call-open",
    status: "completed",
    output: `Opened debug case ${caseId}`,
    metadata: {
      caseId,
      debugCase: {
        schemaVersion: 1,
        caseId,
        problem,
        status: "open",
        createdAt: new Date().toISOString(),
        source: { tool: "debug_open_case", version: Installation.VERSION, runId: sessionID },
      },
    },
    durationMs: 1,
  })
  await new Promise((resolve) => setTimeout(resolve, 30))
  return caseId
}
