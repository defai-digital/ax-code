// Model-in-loop (L2) computer-use benchmark harness.
//
// Drives headless `ax-code run` sessions with a vision model against
// natural-language GUI tasks (test/computer-e2e/tasks.ts) and scores each run
// by an external post-condition (clipboard contents), never by model
// self-report. Metrics come from the `--format json` NDJSON event stream
// (tool_use completions/errors) plus stderr (permission auto-rejections):
// computer_action steps, observes, plans, grounder targets, tool errors,
// permission auto-rejects, wall-clock.
//
// The parsing/scoring logic is pure and unit-tested (harness.test.ts); the
// live arm (agent-e2e.live.test.ts) spawns real runs only when
// AX_COMPUTER_AGENT_LIVE=1 and AX_COMPUTER_AGENT_MODEL are set.

import { execFile } from "node:child_process"

// ---- types ----

/** external probes a task's post-condition may use (live: pbpaste; tests: fakes) */
export interface AgentProbes {
  readClipboard(): Promise<string | undefined>
}

export interface AgentTaskSpec {
  id: string
  name: string
  /** natural-language prompt handed to the agent verbatim */
  prompt: string
  /**
   * External post-condition. Returns true/false when decidable, undefined to
   * skip. A completed run whose verify returns false is a FAIL — the agent
   * finished but the goal state was not reached.
   */
  verify?: (probes: AgentProbes) => Promise<boolean | undefined>
}

export interface AgentRunMetrics {
  sessionID?: string
  /** computer_action tool calls (completed + errored) — the "steps" the report counts */
  steps: number
  /** computer_snapshot + computer_watch calls */
  observes: number
  /** computer_plan calls */
  plans: number
  /** computer_action calls whose target used { describe } (grounder path) */
  grounderTargets: number
  /** computer_* tool calls that ended in error (backend refusals included) */
  toolErrors: number
  /** permission asks the headless runner auto-rejected (safety-interrupt signal) */
  permissionAutoRejects: number
  wallMs: number
  finalText?: string
}

export interface AgentCaseResult {
  id: string
  name: string
  ok: boolean
  verify: "ok" | "no-match" | "skipped" | "error"
  detail?: string
  metrics: AgentRunMetrics
}

export interface AgentRunOptions {
  /** provider/model the session runs on, e.g. "openai/gpt-4o" */
  model: string
  /** ax-code CLI binary; default resolves from PATH */
  cli?: string
  /** computer.provider value for the bench config; default "axnative" */
  provider?: string
  /** per-task wall-clock cap; the process is killed past it */
  timeoutMs?: number
  /** project directory for the run (use a fresh tmpdir per task) */
  cwd?: string
}

export interface SpawnResult {
  stdout: string
  stderr: string
  exitCode: number
  /** true when the run hit the harness timeout and was killed */
  timedOut: boolean
}

export type SpawnFn = (
  cli: string,
  args: string[],
  options: { cwd?: string; env: Record<string, string>; timeoutMs: number },
) => Promise<SpawnResult>

// ---- bench config ----

/**
 * Inline config (AX_CODE_CONFIG_CONTENT) for a benchmark run: computer tools
 * enabled, RISK-class computer permission pre-allowed (headless `run`
 * auto-rejects every ask — see src/cli/cmd/run.ts), and the tool-only stall
 * breaker raised so a long observe→act streak is not cut short at the default
 * 35 turns.
 */
export function buildBenchConfig(provider: string): Record<string, unknown> {
  return {
    computer: { provider },
    permission: { computer: "allow" },
    autonomy: { stall: { tool_only_turns: 500 } },
    session: { max_steps: 1000 },
  }
}

// ---- event stream parsing ----

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined
}

/**
 * Parse a `--format json` NDJSON stream plus captured stderr into metrics.
 * Tolerant of partial lines (a killed run leaves an unterminated tail).
 */
export function parseEvents(stdout: string, stderr: string): AgentRunMetrics {
  const metrics: AgentRunMetrics = {
    steps: 0,
    observes: 0,
    plans: 0,
    grounderTargets: 0,
    toolErrors: 0,
    permissionAutoRejects: 0,
    wallMs: 0,
  }
  let firstTs: number | undefined
  let lastTs: number | undefined
  for (const line of stdout.split("\n")) {
    const trimmed = line.trim()
    if (!trimmed) continue
    let event: unknown
    try {
      event = JSON.parse(trimmed)
    } catch {
      continue
    }
    const record = asRecord(event)
    if (!record) continue
    if (typeof record.sessionID === "string" && !metrics.sessionID) metrics.sessionID = record.sessionID
    if (typeof record.timestamp === "number") {
      if (firstTs === undefined || record.timestamp < firstTs) firstTs = record.timestamp
      if (lastTs === undefined || record.timestamp > lastTs) lastTs = record.timestamp
    }
    if (record.type === "text") {
      const text = asRecord(record.part)
      if (typeof text?.text === "string") metrics.finalText = text.text
    }
    if (record.type !== "tool_use") continue
    const part = asRecord(record.part)
    const tool = part?.tool
    if (typeof tool !== "string" || !tool.startsWith("computer_")) continue
    const state = asRecord(part?.state)
    if (tool === "computer_action") {
      metrics.steps += 1
      const input = asRecord(state?.input)
      const target = asRecord(input?.target)
      if (typeof target?.describe === "string") metrics.grounderTargets += 1
    } else if (tool === "computer_snapshot" || tool === "computer_watch") {
      metrics.observes += 1
    } else if (tool === "computer_plan") {
      metrics.plans += 1
    }
    if (state?.status === "error") metrics.toolErrors += 1
  }
  if (firstTs !== undefined && lastTs !== undefined) metrics.wallMs = lastTs - firstTs
  metrics.permissionAutoRejects = stderr.split("\n").filter((line) => line.includes("auto-rejecting")).length
  return metrics
}

// ---- runner ----

const DEFAULT_TIMEOUT_MS = 600_000

/** default spawn: headless `ax-code run`, capturing stdout/stderr separately */
const defaultSpawn: SpawnFn = (cli, args, options) =>
  new Promise((resolve) => {
    execFile(
      cli,
      args,
      {
        cwd: options.cwd,
        env: { ...process.env, ...options.env },
        timeout: options.timeoutMs,
        maxBuffer: 64 * 1024 * 1024,
      },
      (error, stdout, stderr) => {
        const timedOut = Boolean(error && (error as { killed?: boolean }).killed)
        resolve({
          stdout: stdout ?? "",
          stderr: stderr ?? "",
          exitCode: error ? (typeof error.code === "number" ? error.code : 1) : 0,
          timedOut,
        })
      },
    )
  })

/**
 * Run one agent task and classify the result. A non-zero exit or timeout fails
 * the task; otherwise the external post-condition decides (verify=false ⇒ FAIL
 * even when the run completed cleanly).
 */
export async function runAgentTask(
  task: AgentTaskSpec,
  options: AgentRunOptions,
  probes: AgentProbes,
  spawn: SpawnFn = defaultSpawn,
): Promise<AgentCaseResult> {
  const env: Record<string, string> = {
    AX_CODE_CONFIG_CONTENT: JSON.stringify(buildBenchConfig(options.provider ?? "axnative")),
  }
  const args = ["run", "--format", "json", "-m", options.model, task.prompt]
  const spawnResult = await spawn(options.cli ?? "ax-code", args, {
    cwd: options.cwd,
    env,
    timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
  })
  const metrics = parseEvents(spawnResult.stdout, spawnResult.stderr)

  let ok = spawnResult.exitCode === 0 && !spawnResult.timedOut
  let detail: string | undefined
  if (spawnResult.timedOut) detail = `timeout after ${options.timeoutMs ?? DEFAULT_TIMEOUT_MS}ms`
  else if (spawnResult.exitCode !== 0) detail = `ax-code run exited ${spawnResult.exitCode}`

  let verify: AgentCaseResult["verify"] = "skipped"
  if (task.verify) {
    try {
      const verdict = await task.verify(probes)
      verify = verdict === undefined ? "skipped" : verdict ? "ok" : "no-match"
      if (verdict === false) {
        ok = false
        detail = "verify: post-condition not met"
      }
    } catch (error) {
      verify = "error"
      detail = `verify: ${error instanceof Error ? error.message : String(error)}`
    }
  }

  return { id: task.id, name: task.name, ok, verify, detail, metrics }
}

// ---- report ----

/** console-friendly summary; writing last-report.json is the live test's job */
export function formatAgentReport(model: string, cases: AgentCaseResult[]): string {
  const lines: string[] = []
  const header = `${"Task".padEnd(8)} | ${"Result".padEnd(24)} | ${"Steps".padEnd(5)} | ${"Obs".padEnd(4)} | ${"Plan".padEnd(4)} | ${"Err".padEnd(4)} | ${"PermRej".padEnd(7)} | Wall`
  const sep = "-".repeat(header.length)
  lines.push(sep)
  lines.push(`agent-level (L2) computer-use benchmark — model=${model}`)
  lines.push(sep)
  lines.push(header)
  lines.push(sep)
  for (const c of cases) {
    const verdict = c.ok ? `pass (verify:${c.verify})` : `FAIL ${c.detail ?? ""}`.slice(0, 60)
    lines.push(
      `${c.id.padEnd(8)} | ${verdict.padEnd(24)} | ${String(c.metrics.steps).padEnd(5)} | ${String(c.metrics.observes).padEnd(4)} | ${String(c.metrics.plans).padEnd(4)} | ${String(c.metrics.toolErrors).padEnd(4)} | ${String(c.metrics.permissionAutoRejects).padEnd(7)} | ${c.metrics.wallMs}ms`,
    )
  }
  lines.push(sep)
  const passed = cases.filter((c) => c.ok).length
  lines.push(`${passed}/${cases.length} passed`)
  lines.push(sep)
  return lines.join("\n")
}
