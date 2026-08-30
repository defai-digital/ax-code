import { describe, expect, it } from "vitest"

import { isRuntimeCronExpression, isSlashCommandPrompt, slotTitle, transformDesktopScheduledTask } from "./transform.js"

const NOW = Date.parse("2026-08-30T12:00:00Z")

const baseTask = (overrides = {}) => ({
  id: "task-1",
  name: "Nightly digest",
  enabled: true,
  catchUpPolicy: "run_once",
  schedule: { kind: "daily", times: ["09:00"], timezone: "UTC" },
  execution: {
    prompt: "Summarize repository changes",
    providerID: "openai",
    modelID: "gpt-4.1",
  },
  state: { createdAt: 1, updatedAt: 2 },
  ...overrides,
})

const transform = (task, options = {}) =>
  transformDesktopScheduledTask(task, { now: NOW, expandPrompt: (prompt) => prompt, ...options })

describe("isRuntimeCronExpression", () => {
  it("accepts the runtime subset: wildcard, lists, ranges, steps", () => {
    expect(isRuntimeCronExpression("*/5 * * * *")).toBe(true)
    expect(isRuntimeCronExpression("0 9 * * 1-5")).toBe(true)
    expect(isRuntimeCronExpression("0 9,18 * * 0")).toBe(true)
    expect(isRuntimeCronExpression("0 0 1 1 *")).toBe(true)
    expect(isRuntimeCronExpression("0 9 * * 7")).toBe(true)
  })

  it("rejects names, special symbols, wrong field counts, and oversized input", () => {
    expect(isRuntimeCronExpression("0 9 * * MON")).toBe(false)
    expect(isRuntimeCronExpression("0 9 * jan *")).toBe(false)
    expect(isRuntimeCronExpression("0 0 L * *")).toBe(false)
    expect(isRuntimeCronExpression("0 0 ? * 5#3")).toBe(false)
    expect(isRuntimeCronExpression("0 9 * *")).toBe(false)
    expect(isRuntimeCronExpression("0 9 * * * *")).toBe(false)
    expect(isRuntimeCronExpression(`0 9 * * ${"1".repeat(200)}`)).toBe(false)
    expect(isRuntimeCronExpression("")).toBe(false)
  })
})

describe("isSlashCommandPrompt", () => {
  it("detects slash-command prompts", () => {
    expect(isSlashCommandPrompt("/review src")).toBe(true)
    expect(isSlashCommandPrompt("  /plan")).toBe(true)
    expect(isSlashCommandPrompt("summarize /path")).toBe(false)
  })
})

describe("slotTitle", () => {
  it("keeps the bare name for single-slot fan-out and suffixes multi-slot", () => {
    expect(slotTitle("Digest", 0, 1)).toBe("Digest")
    expect(slotTitle("Digest", 0, 3)).toBe("Digest (1/3)")
    expect(slotTitle("Digest", 2, 3)).toBe("Digest (3/3)")
  })

  it("clamps to the runtime title limit", () => {
    expect(slotTitle("x".repeat(300), 0, 1)).toHaveLength(200)
  })
})

describe("transformDesktopScheduledTask", () => {
  it("maps a single-time daily task to one daily payload", () => {
    const result = transform(baseTask())
    expect(result.status).toBe("ready")
    expect(result.payloads).toEqual([
      {
        title: "Nightly digest",
        prompt: "Summarize repository changes",
        schedule: { type: "daily", time: "09:00", timezone: "UTC" },
        model: { providerID: "openai", modelID: "gpt-4.1" },
        catchUpPolicy: "run_once",
      },
    ])
    expect(result.pause).toBe(false)
  })

  it("fans out multi-time daily schedules into N payloads with suffixes", () => {
    const result = transform(
      baseTask({ schedule: { kind: "daily", times: ["18:00", "09:00", "12:00"], timezone: "UTC" } }),
    )
    expect(result.status).toBe("ready")
    expect(result.payloads.map((payload) => payload.title)).toEqual([
      "Nightly digest (1/3)",
      "Nightly digest (2/3)",
      "Nightly digest (3/3)",
    ])
    expect(result.payloads.map((payload) => payload.schedule.time)).toEqual(["09:00", "12:00", "18:00"])
  })

  it("fans out weekly weekday x time cross products deterministically", () => {
    const result = transform(
      baseTask({ schedule: { kind: "weekly", weekdays: [5, 1], times: ["10:00", "08:00"], timezone: "UTC" } }),
    )
    expect(result.status).toBe("ready")
    expect(result.payloads.map((payload) => [payload.schedule.day, payload.schedule.time])).toEqual([
      [1, "08:00"],
      [1, "10:00"],
      [5, "08:00"],
      [5, "10:00"],
    ])
    expect(result.payloads[3].title).toBe("Nightly digest (4/4)")
  })

  it("accepts runtime-subset cron and rejects unsupported expressions", () => {
    const ok = transform(baseTask({ schedule: { kind: "cron", cron: "0 9 * * 1-5", timezone: "UTC" } }))
    expect(ok.status).toBe("ready")
    expect(ok.payloads[0].schedule).toEqual({ type: "cron", expression: "0 9 * * 1-5", timezone: "UTC" })

    const bad = transform(baseTask({ schedule: { kind: "cron", cron: "0 9 * * MON", timezone: "UTC" } }))
    expect(bad.status).toBe("skip")
    expect(bad.reason).toContain("not supported by the runtime scheduler")
  })

  it("converts a future one-time schedule to an epoch runAt", () => {
    const result = transform(
      baseTask({ schedule: { kind: "once", date: "2026-09-01", time: "09:30", timezone: "UTC" } }),
    )
    expect(result.status).toBe("ready")
    expect(result.payloads[0].schedule).toEqual({ type: "once", runAt: Date.parse("2026-09-01T09:30:00Z") })
  })

  it("reschedules an enabled past-due one-time task with a warning", () => {
    const result = transform(
      baseTask({ schedule: { kind: "once", date: "2026-08-01", time: "09:30", timezone: "UTC" } }),
    )
    expect(result.status).toBe("ready")
    expect(result.payloads[0].schedule.type).toBe("once")
    expect(result.payloads[0].schedule.runAt).toBeGreaterThan(NOW)
    expect(result.warnings.some((warning) => warning.includes("rescheduled"))).toBe(true)
  })

  it("skips a past-due one-time task whose catchUpPolicy is skip", () => {
    const result = transform(
      baseTask({
        catchUpPolicy: "skip",
        schedule: { kind: "once", date: "2026-08-01", time: "09:30", timezone: "UTC" },
      }),
    )
    expect(result.status).toBe("skip")
    expect(result.history).toBe(true)
  })

  it("skips consumed one-time tasks (enabled:false after firing)", () => {
    const result = transform(
      baseTask({
        enabled: false,
        schedule: { kind: "once", date: "2026-09-01", time: "09:30", timezone: "UTC" },
        state: { createdAt: 1, updatedAt: 2, lastRunAt: 3 },
      }),
    )
    expect(result.status).toBe("skip")
    expect(result.reason).toBe("one-time task already fired")
  })

  it("migrates a user-paused recurring task with the pause flag", () => {
    const result = transform(baseTask({ enabled: false }))
    expect(result.status).toBe("ready")
    expect(result.pause).toBe(true)
  })

  it("skips slash-command prompts", () => {
    const result = transform(baseTask({ execution: { prompt: "/review src", providerID: "openai", modelID: "gpt" } }))
    expect(result.status).toBe("skip")
    expect(result.reason).toContain("slash-command")
  })

  it("drops variant with a warning", () => {
    const result = transform(
      baseTask({ execution: { prompt: "work", providerID: "openai", modelID: "gpt", variant: "high" } }),
    )
    expect(result.status).toBe("ready")
    expect(result.payloads[0]).not.toHaveProperty("variant")
    expect(result.warnings.some((warning) => warning.includes("variant"))).toBe(true)
  })

  it("pre-expands snippets through the injected expander", () => {
    const result = transform(baseTask(), { expandPrompt: (prompt) => `${prompt} [expanded]` })
    expect(result.payloads[0].prompt).toBe("Summarize repository changes [expanded]")
  })

  it("skips prompts that exceed the runtime limit after expansion", () => {
    const result = transform(baseTask(), { expandPrompt: () => "x".repeat(20_001) })
    expect(result.status).toBe("skip")
    expect(result.reason).toContain("runtime limit")
  })

  it("maps agent and catchUpPolicy, and warns on incomplete model refs", () => {
    const withAgent = transform(
      baseTask({
        catchUpPolicy: "skip",
        execution: { prompt: "work", providerID: "openai", modelID: "gpt", agent: "build" },
      }),
    )
    expect(withAgent.payloads[0].agent).toBe("build")
    expect(withAgent.payloads[0].catchUpPolicy).toBe("skip")

    const noModel = transform(baseTask({ execution: { prompt: "work", providerID: "", modelID: "" } }))
    expect(noModel.status).toBe("ready")
    expect(noModel.payloads[0]).not.toHaveProperty("model")
    expect(noModel.warnings.some((warning) => warning.includes("providerID/modelID"))).toBe(true)
  })
})
