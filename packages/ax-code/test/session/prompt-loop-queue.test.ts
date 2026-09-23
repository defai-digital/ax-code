import { describe, expect, test } from "vitest"
import { finishPromptLoopQueue } from "../../src/session/prompt/prompt-loop-queue"
import { SessionID } from "../../src/session/schema"

describe("finishPromptLoopQueue", () => {
  test("resumes durable queued prompts after an unfinished run", async () => {
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
        return {} as any
      },
    })

    expect(calls).toEqual(["queued", "idle", "resume"])
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

  test("drains waiting follow-ups after a normal synchronous turn goes idle", async () => {
    const calls: string[] = []

    await finishPromptLoopQueue({
      sessionID: SessionID.descending(),
      reason: "completed",
      queuedCallbacks: () => [],
      markIdle: () => calls.push("idle"),
      cancel: async () => {
        calls.push("cancel")
      },
      resumeLoop: async () => {
        throw new Error("should not resume")
      },
      drainFollowups: async () => {
        calls.push("drain")
      },
    })

    // The loop-completion cleanup cancel must settle before a waiting
    // followup is admitted, or the queue executor's busy check could observe
    // stale run state.
    expect(calls).toEqual(["cancel", "drain"])
  })

  test.each(["error", "step_limit", "stalled", "budget_limited"] as const)(
    "drains waiting follow-ups when a synchronous turn ends with reason %s",
    async (reason) => {
      const calls: string[] = []

      await finishPromptLoopQueue({
        sessionID: SessionID.descending(),
        reason,
        queuedCallbacks: () => [],
        markIdle: () => undefined,
        cancel: async () => {
          calls.push("cancel")
        },
        resumeLoop: async () => {
          throw new Error("should not resume")
        },
        drainFollowups: async () => {
          calls.push("drain")
        },
      })

      expect(calls).toEqual(["cancel", "drain"])
    },
  )

  test("never drains waiting follow-ups when the loop ends aborted", async () => {
    const calls: string[] = []

    await finishPromptLoopQueue({
      sessionID: SessionID.descending(),
      reason: "aborted",
      queuedCallbacks: () => [],
      markIdle: () => undefined,
      cancel: async () => {
        calls.push("cancel")
      },
      resumeLoop: async () => {
        throw new Error("should not resume")
      },
      drainFollowups: async () => {
        calls.push("drain")
      },
    })

    // An explicit abort already paused pending follow-ups before the loop
    // observed its abort signal; starting one here would race that pause.
    expect(calls).toEqual(["cancel"])
  })

  test("tolerates a missing drainFollowups dependency", async () => {
    const calls: string[] = []

    await finishPromptLoopQueue({
      sessionID: SessionID.descending(),
      reason: "completed",
      queuedCallbacks: () => [],
      markIdle: () => undefined,
      cancel: async () => {
        calls.push("cancel")
      },
      resumeLoop: async () => {
        throw new Error("should not resume")
      },
    })

    expect(calls).toEqual(["cancel"])
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
