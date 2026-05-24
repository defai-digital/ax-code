import { describe, expect, test } from "bun:test"
import { SuperLongPolicy } from "@/session/super-long-policy"

describe("SuperLongPolicy.state", () => {
  test("defaults on for Qwen3.7-Max", () => {
    expect(SuperLongPolicy.state({ modelID: "qwen3.7-max" })).toEqual({
      enabled: true,
      source: "model-default",
    })
  })

  test("defaults off for other models", () => {
    expect(SuperLongPolicy.state({ modelID: "claude-sonnet-4.5" }).enabled).toBe(false)
  })

  test("session override wins over model default and config", () => {
    expect(
      SuperLongPolicy.state({
        modelID: "qwen3.7-max",
        config: { enabled: true },
        sessionOverride: false,
      }),
    ).toEqual({ enabled: false, source: "session-override" })
  })

  test("config wins over model default when no session override exists", () => {
    expect(
      SuperLongPolicy.state({
        modelID: "qwen3.7-max",
        config: { enabled: false },
      }),
    ).toEqual({ enabled: false, source: "config" })
  })
})

describe("SuperLongPolicy.runtimeState", () => {
  test("session override env wins over base env, config, and model default", () => {
    expect(
      SuperLongPolicy.runtimeState({
        modelID: "qwen3.7-max",
        config: { enabled: true },
        env: {
          AX_CODE_SUPER_LONG_SESSION_OVERRIDE: "false",
          AX_CODE_SUPER_LONG: "true",
        },
      }),
    ).toEqual({ enabled: false, source: "session-override" })
  })

  test("base env wins over config and model default", () => {
    expect(
      SuperLongPolicy.runtimeState({
        modelID: "qwen3.7-max",
        config: { enabled: true },
        env: {
          AX_CODE_SUPER_LONG: "0",
        },
      }),
    ).toEqual({ enabled: false, source: "env" })
  })

  test("falls back to config and then model default when env is unset", () => {
    expect(
      SuperLongPolicy.runtimeState({
        modelID: "qwen3.7-max",
        config: { enabled: false },
        env: {},
      }),
    ).toEqual({ enabled: false, source: "config" })
    expect(
      SuperLongPolicy.runtimeState({
        modelID: "qwen3.7-max",
        env: {},
      }),
    ).toEqual({ enabled: true, source: "model-default" })
  })
})

describe("SuperLongPolicy.duration", () => {
  test("accepts exactly the 72 hour ceiling", () => {
    expect(SuperLongPolicy.duration(SuperLongPolicy.MAX_DURATION_MS)).toEqual({
      ok: true,
      durationMs: SuperLongPolicy.MAX_DURATION_MS,
    })
  })

  test("rejects durations above the 72 hour ceiling", () => {
    expect(SuperLongPolicy.duration(SuperLongPolicy.MAX_DURATION_MS + 1)).toEqual({
      ok: false,
      reason: "duration_exceeds_ceiling",
      maxDurationMs: SuperLongPolicy.MAX_DURATION_MS,
      requestedDurationMs: SuperLongPolicy.MAX_DURATION_MS + 1,
    })
  })
})

describe("SuperLongPolicy.deadline", () => {
  test("does not expire when Super-Long is disabled", () => {
    expect(
      SuperLongPolicy.deadline({
        enabled: false,
        startedAt: 0,
        now: SuperLongPolicy.MAX_DURATION_MS + 1,
      }),
    ).toEqual({
      ok: true,
      expired: false,
      elapsedMs: SuperLongPolicy.MAX_DURATION_MS + 1,
      durationMs: SuperLongPolicy.MAX_DURATION_MS,
    })
  })

  test("expires at the 72 hour ceiling when Super-Long is enabled", () => {
    expect(
      SuperLongPolicy.deadline({
        enabled: true,
        startedAt: 1_000,
        now: 1_000 + SuperLongPolicy.MAX_DURATION_MS,
      }),
    ).toEqual({
      ok: true,
      expired: true,
      elapsedMs: SuperLongPolicy.MAX_DURATION_MS,
      durationMs: SuperLongPolicy.MAX_DURATION_MS,
    })
  })

  test("rejects requested durations above the hard ceiling", () => {
    expect(
      SuperLongPolicy.deadline({
        enabled: true,
        startedAt: 0,
        now: 0,
        requestedDurationMs: SuperLongPolicy.MAX_DURATION_MS + 1,
      }),
    ).toEqual({
      ok: false,
      reason: "duration_exceeds_ceiling",
      maxDurationMs: SuperLongPolicy.MAX_DURATION_MS,
      requestedDurationMs: SuperLongPolicy.MAX_DURATION_MS + 1,
    })
  })
})

describe("SuperLongPolicy.evaluatePacing", () => {
  const policy: SuperLongPolicy.PacingPolicy = {
    windowMs: 60_000,
    maxRequests: 2,
    minDelayMs: 10_000,
  }

  test("allows the first request in a window", () => {
    const decision = SuperLongPolicy.evaluatePacing({
      now: 100_000,
      state: { timestamps: [] },
      policy,
    })
    expect(decision.waitMs).toBe(0)
    expect(decision.reason).toBe("allowed")
  })

  test("enforces minimum delay between requests", () => {
    const decision = SuperLongPolicy.evaluatePacing({
      now: 105_000,
      state: { timestamps: [100_000] },
      policy,
    })
    expect(decision.waitMs).toBe(5_000)
    expect(decision.reason).toBe("min-delay")
  })

  test("enforces rolling-window request ceiling", () => {
    const decision = SuperLongPolicy.evaluatePacing({
      now: 130_000,
      state: { timestamps: [100_000, 115_000] },
      policy,
    })
    expect(decision.waitMs).toBe(30_000)
    expect(decision.reason).toBe("rolling-window")
  })

  test("drops expired timestamps before evaluating", () => {
    const decision = SuperLongPolicy.evaluatePacing({
      now: 170_001,
      state: { timestamps: [100_000, 115_000] },
      policy,
    })
    expect(decision.waitMs).toBe(0)
    expect(decision.timestamps).toEqual([115_000])
  })
})
