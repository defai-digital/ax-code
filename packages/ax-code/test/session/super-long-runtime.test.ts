import { describe, expect, test } from "bun:test"
import path from "path"
import { tmpdir } from "../fixture/fixture"
import { SuperLongPolicy } from "@/session/super-long-policy"

describe("SuperLongRuntime", () => {
  test("keeps a durable session start across prompt-loop resumes", async () => {
    await using tmp = await tmpdir()
    const previous = process.env.AX_CODE_SUPER_LONG_RUNTIME_STORE
    process.env.AX_CODE_SUPER_LONG_RUNTIME_STORE = path.join(tmp.path, "super-long-runtime.json")
    try {
      const { SuperLongRuntime } = await import("@/session/super-long-runtime")
      await SuperLongRuntime.resetForTest()

      const first = await SuperLongRuntime.sessionStartedAt({ sessionID: "ses_qwen", now: 1_000 })
      const resumed = await SuperLongRuntime.sessionStartedAt({ sessionID: "ses_qwen", now: 2_000 })

      expect(first).toBe(1_000)
      expect(resumed).toBe(1_000)
    } finally {
      if (previous === undefined) delete process.env.AX_CODE_SUPER_LONG_RUNTIME_STORE
      else process.env.AX_CODE_SUPER_LONG_RUNTIME_STORE = previous
    }
  })

  test("reserves provider pacing through a durable store", async () => {
    await using tmp = await tmpdir()
    const previous = process.env.AX_CODE_SUPER_LONG_RUNTIME_STORE
    process.env.AX_CODE_SUPER_LONG_RUNTIME_STORE = path.join(tmp.path, "super-long-runtime.json")
    try {
      const { SuperLongRuntime } = await import("@/session/super-long-runtime")
      await SuperLongRuntime.resetForTest()
      const policy: SuperLongPolicy.PacingPolicy = {
        windowMs: 1_000,
        maxRequests: 10,
        minDelayMs: 100,
      }

      const first = await SuperLongRuntime.reservePacing({ key: "alibaba-coding-plan/qwen3.7-max", now: 1_000, policy })
      const second = await SuperLongRuntime.reservePacing({
        key: "alibaba-coding-plan/qwen3.7-max",
        now: 1_050,
        policy,
      })

      expect(first.decision.reason).toBe("allowed")
      expect(first.state?.timestamps).toEqual([1_000])
      expect(second.decision).toMatchObject({ reason: "min-delay", waitMs: 50 })
      expect(second.state).toBeUndefined()
    } finally {
      if (previous === undefined) delete process.env.AX_CODE_SUPER_LONG_RUNTIME_STORE
      else process.env.AX_CODE_SUPER_LONG_RUNTIME_STORE = previous
    }
  })
})
