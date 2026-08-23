import { describe, expect, test } from "vitest"
import {
  buildBenchConfig,
  formatAgentReport,
  parseEvents,
  runAgentTask,
  type AgentCaseResult,
  type AgentTaskSpec,
  type SpawnFn,
} from "./harness"

const toolUse = (tool: string, status: string, input?: unknown, timestamp?: number) =>
  JSON.stringify({
    type: "tool_use",
    timestamp: timestamp ?? 1_000,
    sessionID: "ses_bench",
    part: { tool, state: { status, input } },
  })

const NDJSON = [
  JSON.stringify({ type: "step_start", timestamp: 1_000, sessionID: "ses_bench" }),
  toolUse("computer_action", "completed", { type: "launch_app", app: "TextEdit" }, 1_100),
  toolUse("computer_snapshot", "completed", { app: "TextEdit" }, 1_200),
  toolUse("computer_action", "completed", { type: "click", target: { describe: "the Save button" } }, 1_300),
  toolUse("computer_action", "error", { type: "type", text: "x" }, 1_400),
  toolUse("computer_plan", "completed", { task: "save" }, 1_500),
  toolUse("bash", "completed", { command: "ls" }, 1_600),
  JSON.stringify({ type: "text", timestamp: 1_700, sessionID: "ses_bench", part: { text: "done" } }),
  "not-json-partial-line",
].join("\n")

describe("parseEvents", () => {
  test("counts computer tool usage, grounder targets, errors, and wall-clock", () => {
    const metrics = parseEvents(NDJSON, "")
    expect(metrics.sessionID).toBe("ses_bench")
    expect(metrics.steps).toBe(3)
    expect(metrics.observes).toBe(1)
    expect(metrics.plans).toBe(1)
    expect(metrics.grounderTargets).toBe(1)
    expect(metrics.toolErrors).toBe(1)
    expect(metrics.wallMs).toBe(700)
    expect(metrics.finalText).toBe("done")
    // non-computer tools are not counted
    expect(metrics.steps + metrics.observes + metrics.plans).toBe(5)
  })

  test("counts permission auto-rejections from stderr", () => {
    const stderr = [
      "permission requested: computer click:app:TextEdit — auto-rejecting in headless mode",
      "some other warning",
      "permission requested: computer type:* — auto-rejecting in headless mode",
    ].join("\n")
    expect(parseEvents("", stderr).permissionAutoRejects).toBe(2)
  })

  test("tolerates empty and partial streams", () => {
    const metrics = parseEvents("", "")
    expect(metrics.steps).toBe(0)
    expect(metrics.wallMs).toBe(0)
    expect(metrics.sessionID).toBeUndefined()
  })
})

describe("buildBenchConfig", () => {
  test("pre-allows the computer permission and raises the stall breaker", () => {
    const config = buildBenchConfig("axnative") as any
    expect(config.computer.provider).toBe("axnative")
    expect(config.permission.computer).toBe("allow")
    expect(config.autonomy.stall.tool_only_turns).toBe(500)
    expect(config.session.max_steps).toBe(1000)
  })
})

describe("runAgentTask", () => {
  const task: AgentTaskSpec = {
    id: "AG-T",
    name: "test task",
    prompt: "do the thing",
    verify: async (probes) => {
      const clip = await probes.readClipboard()
      return clip === undefined ? undefined : clip.includes("marker")
    },
  }

  const fakeSpawn =
    (result: { stdout?: string; stderr?: string; exitCode?: number; timedOut?: boolean }): SpawnFn =>
    async () => ({
      stdout: result.stdout ?? NDJSON,
      stderr: result.stderr ?? "",
      exitCode: result.exitCode ?? 0,
      timedOut: result.timedOut ?? false,
    })

  test("passes when the run completes and the post-condition holds", async () => {
    const result = await runAgentTask(
      task,
      { model: "test/model" },
      { readClipboard: async () => "marker" },
      fakeSpawn({}),
    )
    expect(result.ok).toBe(true)
    expect(result.verify).toBe("ok")
    expect(result.metrics.steps).toBe(3)
  })

  test("fails on a missed post-condition even when the run completed", async () => {
    const result = await runAgentTask(
      task,
      { model: "test/model" },
      { readClipboard: async () => "wrong" },
      fakeSpawn({}),
    )
    expect(result.ok).toBe(false)
    expect(result.verify).toBe("no-match")
    expect(result.detail).toContain("post-condition")
  })

  test("fails on non-zero exit and on timeout", async () => {
    const exited = await runAgentTask(
      task,
      { model: "m" },
      { readClipboard: async () => "marker" },
      fakeSpawn({ exitCode: 1 }),
    )
    expect(exited.ok).toBe(false)
    expect(exited.detail).toContain("exited 1")
    const timed = await runAgentTask(
      task,
      { model: "m" },
      { readClipboard: async () => "marker" },
      fakeSpawn({ timedOut: true }),
    )
    expect(timed.ok).toBe(false)
    expect(timed.detail).toContain("timeout")
  })

  test("verify skipped when the probe cannot decide; run outcome decides", async () => {
    const result = await runAgentTask(
      task,
      { model: "test/model" },
      { readClipboard: async () => undefined },
      fakeSpawn({}),
    )
    expect(result.verify).toBe("skipped")
    expect(result.ok).toBe(true)
  })

  test("passes the bench config and model to the CLI invocation", async () => {
    let seenArgs: string[] = []
    let seenEnv: Record<string, string> = {}
    const capturing: SpawnFn = async (_cli, args, options) => {
      seenArgs = args
      seenEnv = options.env
      return { stdout: "", stderr: "", exitCode: 0, timedOut: false }
    }
    await runAgentTask(task, { model: "openai/gpt-4o" }, { readClipboard: async () => undefined }, capturing)
    expect(seenArgs).toEqual(["run", "--format", "json", "-m", "openai/gpt-4o", "do the thing"])
    const config = JSON.parse(seenEnv.AX_CODE_CONFIG_CONTENT ?? "{}")
    expect(config.permission.computer).toBe("allow")
  })
})

describe("formatAgentReport", () => {
  test("renders rows with metrics and totals", () => {
    const mk = (id: string, ok: boolean): AgentCaseResult => ({
      id,
      name: id,
      ok,
      verify: ok ? "ok" : "no-match",
      metrics: {
        steps: 5,
        observes: 2,
        plans: 0,
        grounderTargets: 1,
        toolErrors: 0,
        permissionAutoRejects: 0,
        wallMs: 1234,
      },
    })
    const out = formatAgentReport("openai/gpt-4o", [mk("AG-001", true), mk("AG-002", false)])
    expect(out).toContain("agent-level (L2)")
    expect(out).toContain("openai/gpt-4o")
    expect(out).toContain("AG-001")
    expect(out).toContain("1/2 passed")
  })
})
