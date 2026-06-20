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

function userMessage(): MessageV2.User {
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
    time: { created: 1 },
  } as MessageV2.User
}

afterEach(() => {
  restoreSuperLongEnv()
})

describe("enforceSuperLongDeadline", () => {
  test("skips durable runtime lookup when super-long is disabled", async () => {
    clearSuperLongEnv()
    const startedAt = vi.spyOn(SuperLongRuntime, "sessionStartedAt").mockResolvedValue(0)
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
      expect(startedAt).not.toHaveBeenCalled()
    } finally {
      startedAt.mockRestore()
    }
  })

  test("reports enabled=true while an active super-long run is within its deadline", async () => {
    clearSuperLongEnv()
    const startedAt = vi.spyOn(SuperLongRuntime, "sessionStartedAt").mockResolvedValue(0)
    try {
      await expect(
        enforceSuperLongDeadline({
          sessionID: "ses_test" as any,
          lastUser: userMessage(),
          autonomous: true,
          config: { enabled: true },
          now: 1_000,
        }),
      ).resolves.toEqual({ action: "continue", enabled: true })
      expect(startedAt).toHaveBeenCalledTimes(1)
    } finally {
      startedAt.mockRestore()
    }
  })

  test("honors a configured duration shorter than the 72h ceiling", async () => {
    clearSuperLongEnv()
    const startedAt = vi.spyOn(SuperLongRuntime, "sessionStartedAt").mockResolvedValue(0)
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
      expect(within).toEqual({ action: "continue", enabled: true })

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
      startedAt.mockRestore()
      updateMessageWithParts.mockRestore()
      publishError.mockRestore()
    }
  })

  test("stops expired super-long sessions and records a synthetic assistant when needed", async () => {
    clearSuperLongEnv()
    const startedAt = vi.spyOn(SuperLongRuntime, "sessionStartedAt").mockResolvedValue(0)
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
      startedAt.mockRestore()
      updateMessageWithParts.mockRestore()
      publishError.mockRestore()
    }
  })
})
