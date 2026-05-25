import { describe, expect, test } from "bun:test"
import { finishPromptLoopQueue } from "../../src/session/prompt-loop-queue"
import { SessionID } from "../../src/session/schema"

describe("finishPromptLoopQueue", () => {
  test("cancels unfinished runs", async () => {
    const sessionID = SessionID.descending()
    const calls: string[] = []

    await finishPromptLoopQueue({
      sessionID,
      reason: "error",
      queuedCallbacks: () => {
        calls.push("queued")
        return [{}]
      },
      markIdle: () => calls.push("idle"),
      cancel: async () => {
        calls.push("cancel")
      },
      resumeLoop: async () => {
        calls.push("resume")
        throw new Error("should not resume")
      },
    })

    expect(calls).toEqual(["cancel"])
  })

  test("cancels completed runs without queued callbacks", async () => {
    const calls: string[] = []

    await finishPromptLoopQueue({
      sessionID: SessionID.descending(),
      reason: "completed",
      queuedCallbacks: () => {
        calls.push("queued")
        return []
      },
      markIdle: () => calls.push("idle"),
      cancel: async () => {
        calls.push("cancel")
      },
      resumeLoop: async () => {
        calls.push("resume")
        throw new Error("should not resume")
      },
    })

    expect(calls).toEqual(["queued", "cancel"])
  })

  test("marks completed runs idle and resumes when callbacks are queued", async () => {
    const calls: string[] = []

    finishPromptLoopQueue({
      sessionID: SessionID.descending(),
      reason: "completed",
      queuedCallbacks: () => {
        calls.push("queued")
        return [{}]
      },
      markIdle: () => calls.push("idle"),
      cancel: async () => {
        calls.push("cancel")
      },
      resumeLoop: async () => {
        calls.push("resume")
        return {} as any
      },
    })

    await Promise.resolve()
    expect(calls).toEqual(["queued", "idle", "resume"])
  })
})
