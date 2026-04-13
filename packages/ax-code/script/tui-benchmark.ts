import { performance } from "node:perf_hooks"
import path from "node:path"
import os from "node:os"
import { mkdir, writeFile } from "node:fs/promises"
import {
  TUI_PERFORMANCE_CRITERIA,
  TUI_PERFORMANCE_CRITERIA_VERSION,
  type TuiPerformanceCriterion,
} from "../src/cli/cmd/tui/performance-criteria"
import { lastAssistantText, transcriptItems } from "../src/cli/cmd/tui/routes/session/display"
import { messageScroll, nextVisibleMessage } from "../src/cli/cmd/tui/routes/session/navigation"
import { sessionTaskSummary } from "../src/cli/cmd/tui/routes/session/view-model"

export type TuiBenchmarkProbe =
  | "pty-first-frame"
  | "pty-input-echo"
  | "pty-paste-echo"
  | "pty-resize-stability"
  | "pty-mouse-click-release"
  | "pty-selection-drag-stability"
  | "fixture-replay"
  | "scroll-replay"
export type TuiBenchmarkMetric = "p95Ms" | "minFps"

export type TuiBenchmarkPlanItem = {
  id: string
  criterionID: string
  gate: TuiPerformanceCriterion["gate"]
  probe: TuiBenchmarkProbe
  metric: TuiBenchmarkMetric
  timeoutMs: number
  repeat: number
  command?: string[]
  inputSequence?: string
  workload: string
  measurement: string
}

export type TuiBenchmarkResult = {
  id: string
  criterionID: string
  metric: TuiBenchmarkMetric
  value?: number
  samples?: number[]
  skipped?: string
}

export type TuiBenchmarkVerdict = {
  ok: boolean
  failures: string[]
  notes: string[]
}

export type TuiBenchmarkReportMetadata = {
  generatedAt: string
  command?: string[]
  os: {
    platform: NodeJS.Platform
    release: string
    arch: string
  }
  runtime: {
    bun?: string
    node: string
  }
  terminal: {
    term?: string
    termProgram?: string
  }
  renderer: {
    name: "opentui"
    coreVersion?: string
    solidVersion?: string
  }
}

export type TuiBenchmarkReport = {
  version: string
  metadata: TuiBenchmarkReportMetadata
  results: TuiBenchmarkResult[]
  verdict: TuiBenchmarkVerdict
}

const DEFAULT_TIMEOUT_MS = 15_000
const DEFAULT_REPEAT = 3
const INPUT_ECHO_SEQUENCE = "axbench"
const PASTE_ECHO_SEQUENCE = "axpaste"
const SCROLL_REPLAY_ITERATIONS = 120

function criterion(id: string): TuiPerformanceCriterion {
  const item = TUI_PERFORMANCE_CRITERIA.find((entry) => entry.id === id)
  if (!item) throw new Error(`Missing TUI performance criterion: ${id}`)
  return item
}

export function createTuiBenchmarkPlan(
  input: {
    command?: string[]
    repeat?: number
    timeoutMs?: number
  } = {},
): TuiBenchmarkPlanItem[] {
  const repeat = input.repeat ?? DEFAULT_REPEAT
  const timeoutMs = input.timeoutMs ?? DEFAULT_TIMEOUT_MS

  return [
    planItem(criterion("startup.first-frame"), {
      probe: "pty-first-frame",
      metric: "p95Ms",
      repeat,
      timeoutMs,
      command: input.command,
    }),
    planItem(criterion("input.keypress-echo"), {
      probe: "pty-input-echo",
      metric: "p95Ms",
      repeat,
      timeoutMs,
      command: input.command,
      inputSequence: INPUT_ECHO_SEQUENCE,
    }),
    planItem(criterion("input.paste-echo"), {
      probe: "pty-paste-echo",
      metric: "p95Ms",
      repeat,
      timeoutMs,
      command: input.command,
      inputSequence: PASTE_ECHO_SEQUENCE,
    }),
    planItem(criterion("terminal.resize-stability"), {
      probe: "pty-resize-stability",
      metric: "p95Ms",
      repeat,
      timeoutMs,
      command: input.command,
    }),
    planItem(criterion("mouse.click-release"), {
      probe: "pty-mouse-click-release",
      metric: "p95Ms",
      repeat,
      timeoutMs,
      command: input.command,
    }),
    planItem(criterion("selection.drag-stability"), {
      probe: "pty-selection-drag-stability",
      metric: "p95Ms",
      repeat,
      timeoutMs,
      command: input.command,
    }),
    planItem(criterion("transcript.large-append"), {
      probe: "fixture-replay",
      metric: "p95Ms",
      repeat,
      timeoutMs,
    }),
    planItem(criterion("scroll.long-cjk-wrapped"), {
      probe: "scroll-replay",
      metric: "minFps",
      repeat,
      timeoutMs,
    }),
  ]
}

function planItem(
  criterion: TuiPerformanceCriterion,
  input: Pick<TuiBenchmarkPlanItem, "probe" | "metric" | "repeat" | "timeoutMs"> &
    Partial<Pick<TuiBenchmarkPlanItem, "command" | "inputSequence">>,
): TuiBenchmarkPlanItem {
  return {
    id: `${criterion.id}:${input.probe}`,
    criterionID: criterion.id,
    gate: criterion.gate,
    probe: input.probe,
    metric: input.metric,
    repeat: input.repeat,
    timeoutMs: input.timeoutMs,
    command: input.command,
    inputSequence: input.inputSequence,
    workload: criterion.workload,
    measurement: criterion.measurement,
  }
}

export function evaluateTuiBenchmarkResults(results: TuiBenchmarkResult[]): TuiBenchmarkVerdict {
  const failures: string[] = []
  const notes: string[] = []

  for (const result of results) {
    const target = criterion(result.criterionID).target
    if (result.skipped) {
      notes.push(`${result.id}: skipped: ${result.skipped}`)
      continue
    }
    if (result.value === undefined) {
      failures.push(`${result.id}: missing ${result.metric}`)
      continue
    }
    if (result.metric === "p95Ms" && target.p95Ms !== undefined && result.value > target.p95Ms) {
      failures.push(`${result.id}: p95 ${result.value.toFixed(1)}ms exceeds ${target.p95Ms}ms`)
    }
    if (result.metric === "minFps" && target.minFps !== undefined && result.value < target.minFps) {
      failures.push(`${result.id}: ${result.value.toFixed(1)}fps is below ${target.minFps}fps`)
    }
  }

  return { ok: failures.length === 0, failures, notes }
}

export async function createTuiBenchmarkReport(input: {
  results: TuiBenchmarkResult[]
  verdict: TuiBenchmarkVerdict
  command?: string[]
  generatedAt?: string
}): Promise<TuiBenchmarkReport> {
  const packageJSON = await readPackageJSON()

  return {
    version: TUI_PERFORMANCE_CRITERIA_VERSION,
    metadata: {
      generatedAt: input.generatedAt ?? new Date().toISOString(),
      command: input.command,
      os: {
        platform: process.platform,
        release: os.release(),
        arch: process.arch,
      },
      runtime: {
        bun: Bun.version,
        node: process.version,
      },
      terminal: {
        term: process.env["TERM"],
        termProgram: process.env["TERM_PROGRAM"],
      },
      renderer: {
        name: "opentui",
        coreVersion: packageJSON.dependencies?.["@opentui/core"],
        solidVersion: packageJSON.dependencies?.["@opentui/solid"],
      },
    },
    results: input.results,
    verdict: input.verdict,
  }
}

async function readPackageJSON(): Promise<{ dependencies?: Record<string, string> }> {
  return JSON.parse(await Bun.file(new URL("../package.json", import.meta.url)).text())
}

export function assertTuiBenchmarkOutputPath(outputPath: string) {
  const resolved = path.resolve(outputPath)
  const blocked = ["docs", "automatosx", "TODOS"].map((entry) => path.resolve(process.cwd(), entry))
  const blockedRoot = blocked.find((root) => resolved === root || resolved.startsWith(root + path.sep))
  if (blockedRoot) {
    throw new Error(`TUI benchmark reports must be written to temp or CI artifact paths, not ${blockedRoot}`)
  }
}

export async function runTuiBenchmarkPlan(plan: TuiBenchmarkPlanItem[]): Promise<TuiBenchmarkResult[]> {
  const results: TuiBenchmarkResult[] = []
  for (const item of plan) {
    if (isPtyProbe(item.probe) && !item.command?.length) {
      results.push({
        id: item.id,
        criterionID: item.criterionID,
        metric: item.metric,
        skipped: "run with --run -- <command> to execute PTY probes",
      })
      continue
    }

    const samples: number[] = []
    for (let i = 0; i < item.repeat; i++) {
      samples.push(await runSample(item))
    }
    results.push({
      id: item.id,
      criterionID: item.criterionID,
      metric: item.metric,
      value: p95(samples),
      samples,
    })
  }
  return results
}

export async function writeTuiBenchmarkReport(outputPath: string, report: TuiBenchmarkReport) {
  assertTuiBenchmarkOutputPath(outputPath)
  await mkdir(path.dirname(outputPath), { recursive: true })
  await writeFile(outputPath, JSON.stringify(report, null, 2) + "\n")
}

async function runSample(item: TuiBenchmarkPlanItem) {
  if (isPtyProbe(item.probe)) return runPtySample(item)
  if (item.probe === "fixture-replay") return runTranscriptFixtureSample()
  if (item.probe === "scroll-replay") return runScrollFixtureSample()
  throw new Error(`Unsupported TUI benchmark probe: ${item.probe}`)
}

function isPtyProbe(probe: TuiBenchmarkProbe) {
  return probe.startsWith("pty-")
}

function p95(values: number[]) {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.ceil(sorted.length * 0.95) - 1] ?? sorted.at(-1) ?? 0
}

function stripControls(value: string) {
  return value.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "").replace(/\x1b\][^\x07]*(\x07|\x1b\\)/g, "")
}

async function runPtySample(item: TuiBenchmarkPlanItem) {
  const { spawn } = await import("bun-pty")
  const [command, ...args] = item.command ?? []
  if (!command) throw new Error(`Missing command for ${item.id}`)

  return await new Promise<number>((resolve, reject) => {
    const start = performance.now()
    const proc = spawn(command, args, {
      name: "xterm-256color",
      cwd: process.cwd(),
      env: {
        ...process.env,
        TERM: "xterm-256color",
        AX_CODE_TUI_BENCHMARK: "1",
      },
    })
    let done = false
    let buffer = ""
    let inputStart = 0
    let inputSent = false
    let settleTimer: ReturnType<typeof setTimeout> | undefined

    const finish = (fn: () => void) => {
      if (done) return
      done = true
      clearTimeout(timeout)
      if (settleTimer) clearTimeout(settleTimer)
      subscription.dispose()
      try {
        proc.kill()
      } catch {}
      fn()
    }

    const timeout = setTimeout(() => {
      finish(() => reject(new Error(`${item.id} timed out after ${item.timeoutMs}ms`)))
    }, item.timeoutMs)

    const subscription = proc.onData((chunk) => {
      buffer += chunk
      const text = stripControls(buffer)
      if (item.probe === "pty-first-frame" && text.trim().length > 0) {
        finish(() => resolve(performance.now() - start))
        return
      }
      if (item.probe === "pty-input-echo" && text.trim().length > 0 && !inputSent) {
        inputSent = true
        inputStart = performance.now()
        proc.write(item.inputSequence ?? INPUT_ECHO_SEQUENCE)
      }
      if (item.probe === "pty-paste-echo" && text.trim().length > 0 && !inputSent) {
        inputSent = true
        inputStart = performance.now()
        proc.write(`\x1b[200~${item.inputSequence ?? PASTE_ECHO_SEQUENCE}\x1b[201~`)
      }
      if (item.probe === "pty-resize-stability" && text.trim().length > 0 && !inputSent) {
        inputSent = true
        inputStart = performance.now()
        const resizable = proc as { resize?: (cols: number, rows: number) => void }
        resizable.resize?.(100, 30)
        settleTimer = setTimeout(() => finish(() => resolve(performance.now() - inputStart)), 100)
      }
      if (item.probe === "pty-mouse-click-release" && text.trim().length > 0 && !inputSent) {
        inputSent = true
        inputStart = performance.now()
        proc.write("\x1b[<0;10;5M\x1b[<0;10;5m")
        settleTimer = setTimeout(() => finish(() => resolve(performance.now() - inputStart)), 100)
      }
      if (item.probe === "pty-selection-drag-stability" && text.trim().length > 0 && !inputSent) {
        inputSent = true
        inputStart = performance.now()
        proc.write("\x1b[<0;10;5M\x1b[<32;20;5M\x1b[<0;20;5m")
        settleTimer = setTimeout(() => finish(() => resolve(performance.now() - inputStart)), 100)
      }
      if (item.probe === "pty-input-echo" && inputSent && text.includes(item.inputSequence ?? INPUT_ECHO_SEQUENCE)) {
        finish(() => resolve(performance.now() - inputStart))
      }
      if (item.probe === "pty-paste-echo" && inputSent && text.includes(item.inputSequence ?? PASTE_ECHO_SEQUENCE)) {
        finish(() => resolve(performance.now() - inputStart))
      }
    })

    proc.onExit(({ exitCode }) => {
      if (!done) finish(() => reject(new Error(`${item.id} exited before completion with code ${exitCode}`)))
    })
  })
}

function runTranscriptFixtureSample() {
  const fixture = createTranscriptFixture(2_000)
  const start = performance.now()
  const items = transcriptItems(fixture.messages as any, fixture.parts as any)
  const summary = sessionTaskSummary(fixture.messages, fixture.parts as any)
  const assistant = lastAssistantText(fixture.messages, fixture.parts, undefined)
  if (items.length !== fixture.messages.length) throw new Error("transcript fixture item count mismatch")
  if (summary.total === 0) throw new Error("transcript fixture did not include task parts")
  if (!("text" in assistant)) throw new Error("transcript fixture missing assistant text")
  return performance.now() - start
}

function runScrollFixtureSample() {
  const fixture = createTranscriptFixture(2_000)
  const children = fixture.messages.map((message, index) => ({ id: message.id, y: index * 3 }))
  const iterations = SCROLL_REPLAY_ITERATIONS
  let scrollTop = 0
  const start = performance.now()

  for (let idx = 0; idx < iterations; idx++) {
    const direction = idx % 5 === 0 ? "prev" : "next"
    const targetID = nextVisibleMessage({
      direction,
      children,
      messages: fixture.messages,
      parts: fixture.parts,
      scrollTop,
    })
    const target = targetID ? children.find((child) => child.id === targetID) : undefined
    scrollTop += messageScroll({
      direction,
      target,
      scrollTop,
      height: 30,
    })
    if (scrollTop < 0) scrollTop = 0
  }

  const seconds = Math.max((performance.now() - start) / 1000, 0.001)
  return iterations / seconds
}

function createTranscriptFixture(count: number) {
  const messages: Array<{ id: string; role: "user" | "assistant" }> = []
  const parts: Record<
    string,
    Array<{
      type?: string
      text?: string
      synthetic?: boolean
      ignored?: boolean
      tool?: string
      state?: { status: string }
    }>
  > = {}

  for (let idx = 0; idx < count; idx++) {
    const id = `msg_${String(idx).padStart(5, "0")}`
    const role = idx % 2 === 0 ? "user" : "assistant"
    messages.push({ id, role })
    parts[id] = [
      {
        type: "text",
        text:
          role === "user"
            ? `Measure transcript behavior ${idx} project workspace line wraps across terminals.\nLongToken_${"x".repeat(96)}`
            : `Assistant response ${idx}\n\n\u001b[32mANSI green ${idx}\u001b[0m\n\n\`\`\`diff\n+ added line ${idx}\n- removed line ${idx}\n\`\`\`\n\n| column | value |\n| --- | --- |\n| wide | wide text sample ${idx} |`,
      },
    ]
    if (role === "assistant" && idx % 10 === 1) {
      parts[id]?.push({
        type: "tool",
        tool: "task",
        state: { status: idx % 20 === 1 ? "running" : "completed" },
      })
    }
  }

  return { messages, parts }
}

function value(name: string, argv = process.argv.slice(2)) {
  const idx = argv.indexOf(name)
  if (idx < 0) return
  const next = argv[idx + 1]
  if (!next || next.startsWith("--")) throw new Error(`Missing value for ${name}`)
  return next
}

function flag(name: string, argv = process.argv.slice(2)) {
  return argv.includes(name)
}

function command(argv = process.argv.slice(2)) {
  const idx = argv.indexOf("--")
  if (idx < 0) return
  const out = argv.slice(idx + 1)
  if (out.length === 0) throw new Error("Missing command after --")
  return out
}

async function main() {
  const repeat = Number(value("--repeat") ?? DEFAULT_REPEAT)
  const timeoutMs = Number(value("--timeout-ms") ?? DEFAULT_TIMEOUT_MS)
  const plan = createTuiBenchmarkPlan({
    command: flag("--run") ? command() : undefined,
    repeat,
    timeoutMs,
  })

  if (flag("--list")) {
    console.log(JSON.stringify({ version: TUI_PERFORMANCE_CRITERIA_VERSION, plan }, null, 2))
    return
  }

  const resultsPath = value("--results")
  const results = resultsPath
    ? (JSON.parse(await Bun.file(resultsPath).text()) as TuiBenchmarkResult[])
    : await runTuiBenchmarkPlan(plan)
  const verdict = evaluateTuiBenchmarkResults(results)
  const report = await createTuiBenchmarkReport({ results, verdict, command: flag("--run") ? command() : undefined })
  const output = value("--output")
  if (output) await writeTuiBenchmarkReport(output, report)
  console.log(JSON.stringify(report, null, 2))
  if (!verdict.ok) process.exitCode = 1
}

if (import.meta.main) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  })
}
