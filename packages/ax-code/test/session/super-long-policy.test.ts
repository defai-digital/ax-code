import { describe, expect, test } from "bun:test"
import { SuperLongPolicy } from "@/session/super-long-policy"

const SEVENTY_TWO_HOURS_MS = 72 * 60 * 60 * 1000

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

  test("parses boolean env values with incidental whitespace", () => {
    expect(
      SuperLongPolicy.runtimeState({
        modelID: "claude-sonnet-4.5",
        env: {
          AX_CODE_SUPER_LONG: " true ",
        },
      }),
    ).toEqual({ enabled: true, source: "env" })
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

describe("SuperLongPolicy.providerPacing", () => {
  test("returns provider-specific pacing without sharing mutable policy objects", () => {
    const first = SuperLongPolicy.providerPacing("alibaba-qwen")!
    first.maxRequests = 99

    expect(SuperLongPolicy.providerPacing("alibaba-qwen")!.maxRequests).toBe(4)
    expect(SuperLongPolicy.providerPacing("openai")!.maxRequests).toBe(6)
  })

  test("skips pacing for local inference providers", () => {
    expect(SuperLongPolicy.providerPacing("ollama")).toBeUndefined()
    expect(SuperLongPolicy.providerPacing("ax-studio")).toBeUndefined()
  })

  test("skips pacing for self-hosted endpoints on a local hostname", () => {
    expect(SuperLongPolicy.providerPacing("my-vllm", { baseURL: "http://localhost:8000/v1" })).toBeUndefined()
    expect(SuperLongPolicy.providerPacing("my-vllm", { baseURL: "http://127.0.0.1:8080" })).toBeUndefined()
    expect(SuperLongPolicy.providerPacing("my-vllm", { baseURL: "http://[::1]:8000/v1" })).toBeUndefined()
  })

  test("keeps pacing for remote endpoints and malformed base URLs", () => {
    expect(SuperLongPolicy.providerPacing("my-proxy", { baseURL: "https://api.example.com/v1" })?.maxRequests).toBe(6)
    expect(SuperLongPolicy.providerPacing("my-proxy", { baseURL: "not a url" })?.maxRequests).toBe(6)
    expect(SuperLongPolicy.providerPacing("alibaba-qwen", { baseURL: "https://dashscope.example" })?.maxRequests).toBe(
      4,
    )
  })
})

describe("SuperLongPolicy.fromConfig", () => {
  test("maps undefined to an empty runtime config", () => {
    expect(SuperLongPolicy.fromConfig(undefined)).toEqual({})
  })

  test("maps the legacy boolean form", () => {
    expect(SuperLongPolicy.fromConfig(true)).toEqual({ enabled: true })
    expect(SuperLongPolicy.fromConfig(false)).toEqual({ enabled: false })
  })

  test("maps the object form and converts duration_hours to ms", () => {
    expect(SuperLongPolicy.fromConfig({ enabled: true, duration_hours: 2 })).toEqual({
      enabled: true,
      requestedDurationMs: 2 * 60 * 60 * 1000,
    })
    expect(SuperLongPolicy.fromConfig({})).toEqual({
      enabled: undefined,
      requestedDurationMs: undefined,
    })
  })
})

describe("SuperLongPolicy.duration", () => {
  test("accepts exactly the 72 hour ceiling", () => {
    expect(SuperLongPolicy.duration(SEVENTY_TWO_HOURS_MS)).toEqual({
      ok: true,
      durationMs: SEVENTY_TWO_HOURS_MS,
    })
  })

  test("rejects durations above the 72 hour ceiling", () => {
    expect(SuperLongPolicy.duration(SEVENTY_TWO_HOURS_MS + 1)).toEqual({
      ok: false,
      reason: "duration_exceeds_ceiling",
      maxDurationMs: SEVENTY_TWO_HOURS_MS,
      requestedDurationMs: SEVENTY_TWO_HOURS_MS + 1,
    })
  })

  test("normalizes invalid fallback durations when no duration is requested", () => {
    expect(SuperLongPolicy.duration(undefined, Number.NaN)).toEqual({
      ok: true,
      durationMs: SEVENTY_TWO_HOURS_MS,
    })
  })

  test("rejects invalid requested durations", () => {
    expect(SuperLongPolicy.duration(-1, SEVENTY_TWO_HOURS_MS + 1)).toEqual({
      ok: false,
      reason: "invalid_duration",
      requestedDurationMs: -1,
    })
    expect(SuperLongPolicy.duration(0)).toEqual({
      ok: false,
      reason: "invalid_duration",
      requestedDurationMs: 0,
    })
  })
})

describe("SuperLongPolicy.deadline", () => {
  test("does not expire when Super-Long is disabled", () => {
    expect(
      SuperLongPolicy.deadline({
        enabled: false,
        startedAt: 0,
        now: SEVENTY_TWO_HOURS_MS + 1,
      }),
    ).toEqual({
      ok: true,
      expired: false,
      elapsedMs: SEVENTY_TWO_HOURS_MS + 1,
      durationMs: SEVENTY_TWO_HOURS_MS,
    })
  })

  test("expires at the 72 hour ceiling when Super-Long is enabled", () => {
    expect(
      SuperLongPolicy.deadline({
        enabled: true,
        startedAt: 1_000,
        now: 1_000 + SEVENTY_TWO_HOURS_MS,
      }),
    ).toEqual({
      ok: true,
      expired: true,
      elapsedMs: SEVENTY_TWO_HOURS_MS,
      durationMs: SEVENTY_TWO_HOURS_MS,
    })
  })

  test("rejects requested durations above the hard ceiling", () => {
    expect(
      SuperLongPolicy.deadline({
        enabled: true,
        startedAt: 0,
        now: 0,
        requestedDurationMs: SEVENTY_TWO_HOURS_MS + 1,
      }),
    ).toEqual({
      ok: false,
      reason: "duration_exceeds_ceiling",
      maxDurationMs: SEVENTY_TWO_HOURS_MS,
      requestedDurationMs: SEVENTY_TWO_HOURS_MS + 1,
    })
  })

  test("normalizes invalid elapsed time to zero", () => {
    expect(
      SuperLongPolicy.deadline({
        enabled: true,
        startedAt: Number.NaN,
        now: 1_000,
      }),
    ).toEqual({
      ok: true,
      expired: false,
      elapsedMs: 0,
      durationMs: SEVENTY_TWO_HOURS_MS,
    })
  })
})

describe("SuperLongPolicy.deadlineStopDecision", () => {
  test("continues when the deadline is valid and not expired", () => {
    expect(
      SuperLongPolicy.deadlineStopDecision({
        deadline: {
          ok: true,
          expired: false,
          elapsedMs: 1_000,
          durationMs: SEVENTY_TWO_HOURS_MS,
        },
        source: "config",
      }),
    ).toEqual({ action: "continue" })
  })

  test("returns a stop payload when the requested duration exceeds the ceiling", () => {
    expect(
      SuperLongPolicy.deadlineStopDecision({
        deadline: {
          ok: false,
          reason: "duration_exceeds_ceiling",
          maxDurationMs: SEVENTY_TWO_HOURS_MS,
          requestedDurationMs: SEVENTY_TWO_HOURS_MS + 1,
        },
        source: "config",
      }),
    ).toEqual({
      action: "stop",
      reason: "step_limit",
      message:
        `Super-Long mode stopped because the requested runtime ceiling exceeds the hard 72 hour limit. ` +
        `Reduce the requested duration and resume the session.`,
      logMessage: "super-long deadline rejected",
      status: "error",
      errorCode: "SUPER_LONG_DURATION_EXCEEDS_CEILING",
      details: {
        maxDurationMs: SEVENTY_TWO_HOURS_MS,
        requestedDurationMs: SEVENTY_TWO_HOURS_MS + 1,
      },
    })
  })

  test("returns a stop payload when the runtime ceiling expires", () => {
    expect(
      SuperLongPolicy.deadlineStopDecision({
        deadline: {
          ok: true,
          expired: true,
          elapsedMs: SEVENTY_TWO_HOURS_MS,
          durationMs: SEVENTY_TWO_HOURS_MS,
        },
        source: "model-default",
      }),
    ).toEqual({
      action: "stop",
      reason: "step_limit",
      message:
        `Super-Long mode stopped after reaching the configured 72 hour runtime ceiling. ` +
        `Review the current state, then resume with a new supervised run if more work is required.`,
      logMessage: "super-long deadline reached",
      status: "stopped",
      errorCode: "SUPER_LONG_DEADLINE_REACHED",
      details: {
        elapsedMs: SEVENTY_TWO_HOURS_MS,
        durationMs: SEVENTY_TWO_HOURS_MS,
        source: "model-default",
      },
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

  test("records requests into a sorted active pacing window", () => {
    expect(
      SuperLongPolicy.recordRequest({
        now: 170_000,
        state: { timestamps: [165_000, 100_000, 150_000] },
        policy,
      }),
    ).toEqual({
      timestamps: [150_000, 165_000, 170_000],
    })
  })

  test("normalizes invalid pacing policy values before evaluating", () => {
    const decision = SuperLongPolicy.evaluatePacing({
      now: 100_000,
      state: { timestamps: [] },
      policy: {
        windowMs: Number.NaN,
        maxRequests: 0,
        minDelayMs: Number.POSITIVE_INFINITY,
      },
    })

    expect(decision).toEqual({
      waitMs: 0,
      reason: "allowed",
      timestamps: [],
    })
  })

  test("normalizes invalid pacing timestamps before recording", () => {
    expect(
      SuperLongPolicy.recordRequest({
        now: Number.NaN,
        state: { timestamps: [1_000] },
        policy,
      }),
    ).toEqual({
      timestamps: [0],
    })
  })
})
