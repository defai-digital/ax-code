import { describe, expect, test } from "vitest"
import {
  isSteerableDraft,
  steerBusySession,
  type SteerClient,
} from "../../../src/cli/tui/component/prompt/prompt-steer"

function client(input: {
  generation?: string | null
  steeringError?: unknown
  receipt?: { status: "accepted" | "applied" | "rejected"; reason?: string }
  steerError?: unknown
}) {
  const calls: unknown[] = []
  const fake: SteerClient = {
    async steering(parameters) {
      calls.push({ steering: parameters })
      if (input.steeringError) return { error: input.steeringError }
      return { data: { generation: input.generation ?? null } }
    },
    async steer(parameters) {
      calls.push({ steer: parameters })
      if (input.steerError) return { error: input.steerError }
      return { data: input.receipt }
    },
  }
  return { fake, calls }
}

describe("prompt steer delivery", () => {
  test("only text drafts on a busy or retrying normal-mode session are steerable", () => {
    expect(isSteerableDraft({ mode: "normal", statusType: "busy", hasAttachments: false })).toBe(true)
    expect(isSteerableDraft({ mode: "normal", statusType: "retry", hasAttachments: false })).toBe(true)
    expect(isSteerableDraft({ mode: "normal", statusType: "idle", hasAttachments: false })).toBe(false)
    expect(isSteerableDraft({ mode: "shell", statusType: "busy", hasAttachments: false })).toBe(false)
    expect(isSteerableDraft({ mode: "normal", statusType: "busy", hasAttachments: true })).toBe(false)
  })

  test("delivers into the active generation with the message id as the idempotency key", async () => {
    const { fake, calls } = client({ generation: "gen-1", receipt: { status: "accepted" } })
    const outcome = await steerBusySession(fake, { sessionID: "ses_1", clientID: "msg_1", text: "use the other file" })
    expect(outcome).toEqual({ kind: "delivered", status: "accepted" })
    expect(calls).toEqual([
      { steering: { sessionID: "ses_1" } },
      { steer: { sessionID: "ses_1", expectedGeneration: "gen-1", clientID: "msg_1", text: "use the other file" } },
    ])
  })

  test("falls back to the follow-up queue when no generation is active", async () => {
    const { fake, calls } = client({ generation: null })
    const outcome = await steerBusySession(fake, { sessionID: "ses_1", clientID: "msg_1", text: "hi" })
    expect(outcome).toEqual({ kind: "fallback", reason: "generation_not_active" })
    expect(calls).toHaveLength(1)
  })

  test("falls back when the generation ended during admission, fails on other rejections", async () => {
    const ended = client({
      generation: "gen-1",
      receipt: { status: "rejected", reason: "generation_ended_before_application" },
    })
    expect(await steerBusySession(ended.fake, { sessionID: "ses_1", clientID: "msg_1", text: "hi" })).toEqual({
      kind: "fallback",
      reason: "generation_ended_before_application",
    })
    const vetoed = client({ generation: "gen-1", receipt: { status: "rejected", reason: "admission_rejected" } })
    expect(await steerBusySession(vetoed.fake, { sessionID: "ses_1", clientID: "msg_1", text: "hi" })).toEqual({
      kind: "failed",
      message: "admission_rejected",
    })
  })

  test("surfaces transport errors as failures without touching the queue", async () => {
    const { fake } = client({ steeringError: { data: { message: "socket hang up" } } })
    expect(await steerBusySession(fake, { sessionID: "ses_1", clientID: "msg_1", text: "hi" })).toEqual({
      kind: "failed",
      message: "socket hang up",
    })
    const steerFailed = client({ generation: "gen-1", steerError: new Error("409 conflict") })
    expect(await steerBusySession(steerFailed.fake, { sessionID: "ses_1", clientID: "msg_1", text: "hi" })).toEqual({
      kind: "failed",
      message: "409 conflict",
    })
  })
})
