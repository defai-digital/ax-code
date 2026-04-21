import { describe, expect, test } from "bun:test"
import {
  createBootstrapLifecycle,
  failBootstrapSpans,
  runBootstrapPhaseSequence,
  runBootstrapPhaseTasks,
} from "../../../src/cli/cmd/tui/context/sync-bootstrap-runner"

describe("tui sync bootstrap runner", () => {
  test("runs a bootstrap phase and forwards rejected summaries to the hooks", async () => {
    const rejected: string[] = []
    const settled: Array<{ rejected: string[] }> = []
    const spans: Array<Record<string, unknown> | undefined> = []

    const summary = await runBootstrapPhaseTasks({
      tasks: [() => Promise.resolve("ok"), () => Promise.reject(new Error("phase failed"))],
      onRejected(error) {
        rejected.push(error)
      },
      onSettled(result) {
        settled.push(result)
      },
      finishSpan(data) {
        spans.push(data)
      },
    })

    expect(summary).toEqual({ rejected: ["Error: phase failed"] })
    expect(rejected).toEqual(["Error: phase failed"])
    expect(settled).toEqual([{ rejected: ["Error: phase failed"] }])
    expect(spans).toEqual([{ rejected: 1 }])
  })

  test("finishes all bootstrap spans with a shared failure payload", () => {
    const spans: Array<Record<string, unknown> | undefined> = []

    failBootstrapSpans(
      new Error("bootstrap exploded"),
      (data) => {
        spans.push(data)
      },
      undefined,
      (data) => {
        spans.push(data)
      },
    )

    expect(spans).toEqual([
      { ok: false, error: "Error: bootstrap exploded" },
      { ok: false, error: "Error: bootstrap exploded" },
    ])
  })

  test("runs bootstrap phase after hooks in sequence after each summary settles", async () => {
    const events: string[] = []

    const summaries = await runBootstrapPhaseSequence([
      {
        tasks: [() => Promise.resolve().then(() => {
          events.push("blocking-task")
        })],
        after() {
          events.push("blocking-after")
        },
      },
      {
        tasks: [() => Promise.reject(new Error("core failed"))],
        onRejected(error) {
          events.push(`core-rejected:${error}`)
        },
        after(summary) {
          events.push(`core-after:${summary.rejected.length}`)
        },
      },
      {
        tasks: [() => Promise.resolve().then(() => {
          events.push("deferred-task")
        })],
        after() {
          events.push("deferred-after")
        },
      },
    ])

    expect(summaries).toEqual([
      { rejected: [] },
      { rejected: ["Error: core failed"] },
      { rejected: [] },
    ])
    expect(events).toContain("blocking-task")
    expect(events).toContain("deferred-task")
    expect(events).toContain("blocking-after")
    expect(events).toContain("core-rejected:Error: core failed")
    expect(events).toContain("core-after:1")
    expect(events).toContain("deferred-after")
    expect(events.indexOf("blocking-after")).toBeLessThan(events.indexOf("core-after:1"))
    expect(events.indexOf("core-rejected:Error: core failed")).toBeLessThan(events.indexOf("core-after:1"))
    expect(events.indexOf("core-after:1")).toBeLessThan(events.indexOf("deferred-after"))
  })

  test("does not invoke later phase tasks before earlier phase hooks complete", async () => {
    const events: string[] = []

    await runBootstrapPhaseSequence([
      {
        tasks: [() => {
          events.push("blocking-start")
          return Promise.resolve()
        }],
        async after() {
          events.push("blocking-after")
        },
      },
      {
        tasks: [() => {
          events.push("deferred-start")
          return Promise.resolve()
        }],
      },
    ])

    expect(events).toEqual(["blocking-start", "blocking-after", "deferred-start"])
  })

  test("creates startup lifecycle spans and routes failures through a single helper", async () => {
    const created: string[] = []
    const spanPayloads = new Map<string, Array<Record<string, unknown> | undefined>>()
    const failures: string[] = []

    const lifecycle = createBootstrapLifecycle({
      isStartupBootstrap: true,
      createSpan(name) {
        created.push(name)
        return (data) => {
          const payloads = spanPayloads.get(name) ?? []
          payloads.push(data)
          spanPayloads.set(name, payloads)
        }
      },
      onFailure(error) {
        failures.push(String(error))
      },
    })

    const coreSpan = lifecycle.createCoreSpan()
    const deferredSpan = lifecycle.createDeferredSpan()
    lifecycle.finishStartup()
    await expect(lifecycle.fail(new Error("bootstrap exploded"), deferredSpan, coreSpan)).rejects.toThrow(
      "bootstrap exploded",
    )

    expect(created).toEqual([
      "tui.startup.bootstrap",
      "tui.startup.bootstrapCore",
      "tui.startup.bootstrapDeferred",
    ])
    expect(spanPayloads.get("tui.startup.bootstrap")).toEqual([
      undefined,
      { ok: false, error: "Error: bootstrap exploded" },
    ])
    expect(spanPayloads.get("tui.startup.bootstrapCore")).toEqual([
      { ok: false, error: "Error: bootstrap exploded" },
    ])
    expect(spanPayloads.get("tui.startup.bootstrapDeferred")).toEqual([
      { ok: false, error: "Error: bootstrap exploded" },
    ])
    expect(failures).toEqual(["Error: bootstrap exploded"])
  })

  test("returns no-op lifecycle spans when startup bootstrap is disabled", async () => {
    const created: string[] = []
    const failures: string[] = []

    const lifecycle = createBootstrapLifecycle({
      isStartupBootstrap: false,
      createSpan(name) {
        created.push(name)
        return () => {}
      },
      onFailure(error) {
        failures.push(String(error))
      },
    })

    expect(lifecycle.startupSpan).toBeUndefined()
    expect(lifecycle.createCoreSpan()).toBeUndefined()
    expect(lifecycle.createDeferredSpan()).toBeUndefined()

    lifecycle.finishStartup()
    await expect(lifecycle.fail(new Error("bootstrap exploded"))).rejects.toThrow("bootstrap exploded")

    expect(created).toEqual([])
    expect(failures).toEqual(["Error: bootstrap exploded"])
  })

  test("preserves the original bootstrap error when failure cleanup also rejects", async () => {
    const failures: string[] = []

    const lifecycle = createBootstrapLifecycle({
      isStartupBootstrap: false,
      createSpan() {
        return () => {}
      },
      async onFailure(error) {
        failures.push(String(error))
        throw new Error("cleanup failed")
      },
    })

    await expect(lifecycle.fail(new Error("bootstrap exploded"))).rejects.toThrow("bootstrap exploded")
    expect(failures).toEqual(["Error: bootstrap exploded"])
  })
})
