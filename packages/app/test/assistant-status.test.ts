import { describe, expect, test } from "bun:test"
import { computeAssistantStatus } from "../src/runtime/assistant-status"

describe("assistant status", () => {
  test("surfaces permission blocks as visible user-action status", () => {
    const snapshot = computeAssistantStatus({
      status: { type: "blocked", reason: "permission" },
      lastAssistantParts: [],
      sessionId: "ses_permission",
      pendingPermissions: [{ id: "perm_1" }],
      pendingQuestions: [],
      abortBusy: false,
    })

    expect(snapshot.working).toMatchObject({
      activity: "permission",
      isWorking: false,
      isWaitingForPermission: true,
      isWaitingForQuestion: false,
      statusText: "waiting for permission",
      canAbort: true,
    })
  })

  test("surfaces question blocks as visible user-action status", () => {
    const snapshot = computeAssistantStatus({
      status: { type: "blocked", reason: "question" },
      lastAssistantParts: [],
      sessionId: "ses_question",
      pendingPermissions: [],
      pendingQuestions: [{ id: "question_1" }],
      abortBusy: false,
    })

    expect(snapshot.working).toMatchObject({
      activity: "question",
      isWorking: false,
      isWaitingForPermission: false,
      isWaitingForQuestion: true,
      statusText: "waiting for answer",
      canAbort: true,
    })
  })

  test("uses in-flight tool parts for busy session status", () => {
    const snapshot = computeAssistantStatus({
      status: { type: "busy", waitState: "tool", step: 2, maxSteps: 4 },
      lastAssistantParts: [
        {
          id: "part_tool",
          messageID: "msg_assistant",
          type: "tool",
          toolName: "bash",
          text: "running",
        },
      ],
      sessionId: "ses_tool",
      pendingPermissions: [],
      pendingQuestions: [],
      abortBusy: false,
    })

    expect(snapshot.working).toMatchObject({
      activity: "tooling",
      activeToolName: "bash",
      statusText: "running command",
      waitState: "tool",
      step: 2,
      maxSteps: 4,
      canAbort: true,
    })
  })
})
