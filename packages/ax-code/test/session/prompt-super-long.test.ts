import { afterEach, describe, expect, test, vi } from "vitest"
import { Session } from "../../src/session"
import { SuperLongRuntime } from "../../src/session/super-long-runtime"
import { enforceSuperLongDeadline } from "../../src/session/prompt-super-long"
import type { MessageV2 } from "../../src/session/message-v2"
import { Instance } from "../../src/project/instance"
import { tmpdir } from "../fixture/fixture"

const originalSuperLong = process.env.AX_CODE_SUPER_LONG
const originalSuperLongOverride = process.env.AX_CODE_SUPER_LONG_SESSION_OVERRIDE

function clearSuperLongEnv() {
  delete process.env.AX_CODE_SUPER_LONG
  delete process.env.AX_CODE_SUPER_LONG_SESSION_OVERRIDE
}

function restoreSuperLongEnv() {
  if (originalSuperLong === undefined) delete process.env.AX_CODE_SUPER_LONG
  else process.env.AX_CODE_SUPER_LONG = originalSuperLong
  if (originalSuperLongOverride === undefined) delete process.env.AX_CODE_SUPER_LONG_SESSION_OVERRIDE
  else process.env.AX_CODE_SUPER_LONG_SESSION_OVERRIDE = originalSuperLongOverride
}

function userMessage(createdAt = 1): MessageV2.User {
  return {
    id: "msg_user" as any,
    role: "user",
    sessionID: "ses_test" as any,
    agent: "build",
    variant: "primary",
    model: {
      providerID: "openai" as any,
      modelID: "gpt-5.2" as any,
    },
    time: { created: createdAt },
  } as MessageV2.User
}

afterEach(() => {
  restoreSuperLongEnv()
})

describe("enforceSuperLongDeadline", () => {
  test("skips durable runtime lookup when super-long is disabled", async () => {
    clearSuperLongEnv()
    const touchRun = vi.spyOn(SuperLongRuntime, "touchRun").mockResolvedValue({ startedAt: 0, totalSteps: 0 })
    try {
      await expect(
        enforceSuperLongDeadline({
          sessionID: "ses_test" as any,
          lastUser: userMessage(),
          autonomous: true,
          config: { enabled: false },
          now: 1_000,
        }),
      ).resolves.toEqual({ action: "continue", enabled: false })
      expect(touchRun).not.toHaveBeenCalled()
    } finally {
      touchRun.mockRestore()
    }
  })

  test("reports enabled=true and durable steps while a run is within its deadline", async () => {
    clearSuperLongEnv()
    const touchRun = vi.spyOn(SuperLongRuntime, "touchRun").mockResolvedValue({ startedAt: 0, totalSteps: 42 })
    try {
      await expect(
        enforceSuperLongDeadline({
          sessionID: "ses_test" as any,
          lastUser: userMessage(),
          autonomous: true,
          config: { enabled: true },
          stepsSinceLastCheck: 2,
          now: 1_000,
        }),
      ).resolves.toEqual({ action: "continue", enabled: true, durableTotalSteps: 42 })
      expect(touchRun).toHaveBeenCalledTimes(1)
      expect(touchRun).toHaveBeenCalledWith({ sessionID: "ses_test", now: 1_000, stepsDelta: 2 })
    } finally {
      touchRun.mockRestore()
    }
  })

  test("honors a configured duration shorter than the 72h ceiling", async () => {
    clearSuperLongEnv()
    const touchRun = vi.spyOn(SuperLongRuntime, "touchRun").mockResolvedValue({ startedAt: 0, totalSteps: 0 })
    const updateMessageWithParts = vi.spyOn(Session, "updateMessageWithParts").mockResolvedValue(undefined as any)
    const publishError = vi.spyOn(Session, "publishError").mockImplementation((() => undefined) as any)
    try {
      await using tmp = await tmpdir({ git: true })
      const twoHoursMs = 2 * 60 * 60 * 1000
      const config = { enabled: true, requestedDurationMs: twoHoursMs }
      const within = await Instance.provide({
        directory: tmp.path,
        fn: () =>
          enforceSuperLongDeadline({
            sessionID: "ses_test" as any,
            lastUser: userMessage(),
            autonomous: true,
            config,
            now: twoHoursMs - 1,
          }),
      })
      expect(within).toEqual({ action: "continue", enabled: true, durableTotalSteps: 0 })

      const expired = await Instance.provide({
        directory: tmp.path,
        fn: () =>
          enforceSuperLongDeadline({
            sessionID: "ses_test" as any,
            lastUser: userMessage(),
            autonomous: true,
            config,
            now: twoHoursMs,
          }),
      })
      expect(expired).toEqual({ action: "stop", reason: "step_limit", invalidatedMessages: true })
    } finally {
      touchRun.mockRestore()
      updateMessageWithParts.mockRestore()
      publishError.mockRestore()
    }
  })

  test("stops expired super-long sessions and records a synthetic assistant when needed", async () => {
    clearSuperLongEnv()
    const touchRun = vi.spyOn(SuperLongRuntime, "touchRun").mockResolvedValue({ startedAt: 0, totalSteps: 0 })
    const updateMessageWithParts = vi.spyOn(Session, "updateMessageWithParts").mockResolvedValue(undefined as any)
    const publishError = vi.spyOn(Session, "publishError").mockImplementation((() => undefined) as any)
    try {
      await using tmp = await tmpdir({ git: true })
      const result = await Instance.provide({
        directory: tmp.path,
        fn: () =>
          enforceSuperLongDeadline({
            sessionID: "ses_test" as any,
            lastUser: userMessage(),
            autonomous: true,
            config: { enabled: true },
            now: 72 * 60 * 60 * 1000,
          }),
      })

      expect(result).toEqual({ action: "stop", reason: "step_limit", invalidatedMessages: true })
      expect(updateMessageWithParts).toHaveBeenCalledTimes(1)
      expect(publishError).toHaveBeenCalledTimes(1)
    } finally {
      touchRun.mockRestore()
      updateMessageWithParts.mockRestore()
      publishError.mockRestore()
    }
  })

  test("degrades to non-super-long instead of stopping when the user prompts after expiry", async () => {
    clearSuperLongEnv()
    const touchRun = vi.spyOn(SuperLongRuntime, "touchRun").mockResolvedValue({ startedAt: 0, totalSteps: 0 })
    const updateMessageWithParts = vi.spyOn(Session, "updateMessageWithParts").mockResolvedValue(undefined as any)
    const publishError = vi.spyOn(Session, "publishError").mockImplementation((() => undefined) as any)
    try {
      const expiryMs = 72 * 60 * 60 * 1000
      touchRun.mockResolvedValue({ startedAt: 0, totalSteps: 17 })
      // The user message postdates the deadline: a fresh supervised prompt,
      // not the tail of the long run — the session must not stay bricked.
      const result = await enforceSuperLongDeadline({
        sessionID: "ses_test" as any,
        lastUser: userMessage(expiryMs + 60_000),
        autonomous: true,
        config: { enabled: true },
        stepsSinceLastCheck: 3,
        now: expiryMs + 120_000,
      })

      // durableTotalSteps must be surfaced: touchRun already accumulated the
      // 3-step delta, so the caller has to advance its reported watermark or
      // every later iteration of the degraded run re-reports the same steps.
      expect(result).toEqual({ action: "continue", enabled: false, durableTotalSteps: 17 })
      expect(touchRun).toHaveBeenCalledWith({ sessionID: "ses_test", now: expiryMs + 120_000, stepsDelta: 3 })
      expect(updateMessageWithParts).not.toHaveBeenCalled()
      expect(publishError).not.toHaveBeenCalled()
    } finally {
      touchRun.mockRestore()
      updateMessageWithParts.mockRestore()
      publishError.mockRestore()
    }
  })
})
