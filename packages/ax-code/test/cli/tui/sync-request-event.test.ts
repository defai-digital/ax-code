import { describe, expect, test } from "bun:test"
import type { PermissionRequest, QuestionRequest } from "@ax-code/sdk/v2"
import { handleRequestSyncEvent } from "../../../src/cli/cmd/tui/context/sync-request-event"

function createPermissionRequest(input?: Partial<PermissionRequest>): PermissionRequest {
  return {
    id: "perm_1",
    sessionID: "ses_1",
    permission: "shell",
    patterns: [],
    metadata: {},
    always: [],
    ...input,
  }
}

function createQuestionRequest(input?: Partial<QuestionRequest>): QuestionRequest {
  return {
    id: "question_1",
    sessionID: "ses_1",
    questions: [
      {
        header: "Plan",
        question: "Which rollout should we pick?",
        options: [
          { label: "Incremental rollout", description: "Recommended small, low-risk path" },
          { label: "Rewrite first", description: "Large refactor with more risk" },
        ],
      },
    ],
    ...input,
  }
}

describe("tui sync request event", () => {
  test("adds permission requests to the store when autonomous mode is off", () => {
    const permission: Record<string, PermissionRequest[]> = {}

    const handled = handleRequestSyncEvent(
      { type: "permission.asked", properties: createPermissionRequest() },
      {
        autonomous: false,
        updatePermission(updater) {
          updater(permission)
        },
        updateQuestion: () => undefined,
        replyPermission: () => undefined,
        replyQuestion: () => undefined,
        onWarn: () => undefined,
      },
    )

    expect(handled).toBe(true)
    expect(permission).toEqual({
      ses_1: [createPermissionRequest()],
    })
  })

  test("auto-replies to permission requests in autonomous mode and warns on failure", async () => {
    const warnings: Array<{ label: string; error: unknown }> = []
    const payloads: Array<{ requestID: string; reply: "once" }> = []

    const handled = handleRequestSyncEvent(
      { type: "permission.asked", properties: createPermissionRequest({ id: "perm_2" }) },
      {
        autonomous: true,
        updatePermission: () => undefined,
        updateQuestion: () => undefined,
        replyPermission(payload) {
          payloads.push(payload)
          throw new Error("permission failed")
        },
        replyQuestion: () => undefined,
        onWarn(label, error) {
          warnings.push({ label, error })
        },
      },
    )

    await Promise.resolve()

    expect(handled).toBe(true)
    expect(payloads).toEqual([{ requestID: "perm_2", reply: "once" }])
    expect(warnings).toHaveLength(1)
    expect(warnings[0]?.label).toBe("autonomous permission reply failed")
  })

  test("auto-replies to question requests in autonomous mode", async () => {
    const payloads: Array<{ requestID: string; answers: string[][] }> = []

    const handled = handleRequestSyncEvent(
      { type: "question.asked", properties: createQuestionRequest({ id: "question_2" }) },
      {
        autonomous: true,
        updatePermission: () => undefined,
        updateQuestion: () => undefined,
        replyPermission: () => undefined,
        replyQuestion(payload) {
          payloads.push(payload)
        },
        onWarn: () => undefined,
      },
    )

    await Promise.resolve()

    expect(handled).toBe(true)
    expect(payloads).toEqual([{
      requestID: "question_2",
      answers: [["Incremental rollout"]],
    }])
  })

  test("removes replied and rejected requests from their stores", () => {
    const permission: Record<string, PermissionRequest[]> = {
      ses_1: [createPermissionRequest({ id: "perm_3" })],
    }
    const question: Record<string, QuestionRequest[]> = {
      ses_1: [createQuestionRequest({ id: "question_3" })],
    }

    handleRequestSyncEvent(
      { type: "permission.replied", properties: { sessionID: "ses_1", requestID: "perm_3" } },
      {
        autonomous: false,
        updatePermission(updater) {
          updater(permission)
        },
        updateQuestion: () => undefined,
        replyPermission: () => undefined,
        replyQuestion: () => undefined,
        onWarn: () => undefined,
      },
    )

    handleRequestSyncEvent(
      { type: "question.rejected", properties: { sessionID: "ses_1", requestID: "question_3" } },
      {
        autonomous: false,
        updatePermission: () => undefined,
        updateQuestion(updater) {
          updater(question)
        },
        replyPermission: () => undefined,
        replyQuestion: () => undefined,
        onWarn: () => undefined,
      },
    )

    expect(permission).toEqual({ ses_1: [] })
    expect(question).toEqual({ ses_1: [] })
  })
})
