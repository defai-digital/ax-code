import fs from "fs/promises"
import os from "os"
import path from "path"
import { parse } from "jsonc-parser"
import type { Bench } from "../src/cli/cmd/debug/perf"

type Threshold = {
  elapsedMs?: number
  totalMs?: number
  phases: Record<string, number>
}

type Regression = {
  elapsedPct?: number
  totalPct?: number
  phases: Record<string, number>
}

type Config = {
  bench?: {
    limit?: number
    repeat?: number
    warmup?: number
    concurrency?: number
    probe?: boolean
    nativeProfile?: boolean
  }
  gate?: {
    elapsedMs?: number
    totalMs?: number
    phases?: Record<string, number>
  }
  baseline?: {
    file?: string
    summary?: string
    elapsedPct?: number
    totalPct?: number
    phases?: Record<string, number>
  }
  summary?: string
  out?: string
}

type Opts = {
  limit?: number
  repeat: number
  warmup: number
  concurrency: number
  probe: boolean
  nativeProfile: boolean
  out: string
  summary: string
  gate: Threshold
  baseline: {
    file?: string
    summary?: string
    out?: string
    outSummary?: string
    regression: Regression
  }
}

export type Check = {
  failures: string[]
  notes: string[]
}

type Phase = {
  name: string
  currMs: number
  prevMs: number
  diffMs: number
  diffPct?: number
}

type PhaseSummary = {
  regressions: Phase[]
  improvements: Phase[]
  stable: number
  missing: string[]
}

type Compare = Check & {
  phases?: PhaseSummary
  compat?: Check
}

export type Verdict = {
  ok: boolean
  directory: string
  files: number
  out: string
  summary: string
  baseline: {
    file?: string
    summary?: string
    out?: string
    outSummary?: string
    compat?: Check & { ok: boolean }
  }
  meta: Meta
  requested: Bench["requested"]
  metrics: {
    elapsedMs: number
    totalMs: number
    phases: Record<string, number>
  }
  gate: Check & { ok: boolean }
  compare?: Compare & { ok: boolean }
}

export type Meta = {
  createdAt: string
  config?: string
  argv: string[]
  runtime: {
    bun?: string
    platform: string
    arch: string
  }
  host: {
    hostname: string
  }
  git: {
    branch?: string
    commit?: string
  }
  ci: {
    githubWorkflow?: string
    githubRunId?: string
    githubSha?: string
    githubRef?: string
  }
}

type Part = {
  on: boolean
  value?: string
}

function parts(name: string) {
  const out: Part[] = []
  for (let idx = 0; idx < process.argv.length; idx++) {
    const item = process.argv[idx]
    if (item === name) {
      const next = process.argv[idx + 1]
      out.push({
        on: true,
        value: !next || next.startsWith("--") ? undefined : next,
      })
      continue
    }
    if (item.startsWith(`${name}=`)) {
      out.push({
        on: true,
        value: item.slice(name.length + 1),
      })
    }
  }
  return out
}

function text(name: string) {
  const item = parts(name).at(-1)
  if (!item) return
  if (item.value === undefined) throw new Error(`Missing value for ${name}`)
  return item.value
}

function arg(name: string) {
  return text(name)
}

function args(name: string) {
  return parts(name).flatMap((item) => {
    if (item.value === undefined) throw new Error(`Missing value for ${name}`)
    return [item.value]
  })
}

function num(name: string) {
  const value = arg(name)
  if (value === undefined) return
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed < 0) throw new Error(`Invalid value for ${name}: ${value}`)
  return parsed
}

function bool(name: string) {
  const off = `--no-${name.slice(2)}`
  const out: boolean[] = []

  for (const item of process.argv) {
    if (item === off) out.push(false)
  }
  for (const item of parts(name)) {
    if (item.value === undefined) {
      out.push(true)
      continue
    }
    if (item.value === "true") {
      out.push(true)
      continue
    }
    if (item.value === "false") {
      out.push(false)
      continue
    }
    throw new Error(`Invalid value for ${name}: ${item.value}`)
  }

  return out.at(-1)
}

function parsePhase(value: string) {
  const idx = value.lastIndexOf("=")
  if (idx <= 0 || idx === value.length - 1) {
    throw new Error(`Invalid phase threshold value: ${value}`)
  }
  const name = value.slice(0, idx)
  const parsed = Number(value.slice(idx + 1))
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`Invalid phase threshold for ${name}: ${value.slice(idx + 1)}`)
  }
  return { name, ms: parsed }
}

function obj(value: unknown, key: string) {
  if (value === undefined) return undefined
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${key} must be an object`)
  }
  return value as Record<string, unknown>
}

function map(value: unknown, key: string) {
  const item = obj(value, key)
  if (!item) return {}
  return Object.fromEntries(
    Object.entries(item).map(([name, item]) => {
      if (typeof item !== "number" || !Number.isFinite(item) || item < 0) {
        throw new Error(`${key}.${name} must be a non-negative number`)
      }
      return [name, item]
    }),
  )
}

function pick<T>(...vals: Array<T | undefined>) {
  return vals.find((item) => item !== undefined)
}

function sidecar(file: string) {
  return file.endsWith(".json") ? file.slice(0, -".json".length) + "-summary.json" : `${file}.summary.json`
}

function pct(name: string) {
  return num(name)
}

export function threshold(): Threshold {
  return {
    elapsedMs: num("--max-elapsed-median-ms"),
    totalMs: num("--max-total-median-ms"),
    phases: Object.fromEntries(
      args("--max-phase-median-ms").map((item) => {
        const next = parsePhase(item)
        return [next.name, next.ms]
      }),
    ),
  }
}

export function regression(): Regression {
  return {
    elapsedPct: pct("--max-elapsed-regression-pct"),
    totalPct: pct("--max-total-regression-pct"),
    phases: Object.fromEntries(
      args("--max-phase-regression-pct").map((item) => {
        const next = parsePhase(item)
        return [next.name, next.ms]
      }),
    ),
  }
}

export async function load(file: string) {
  const text = await Bun.file(file).text()
  const data = parse(text)
  const root = obj(data, "config")
  if (!root) return {} satisfies Config

  const bench = obj(root.bench, "bench")
  const gate = obj(root.gate, "gate")
  const base = obj(root.baseline, "baseline")

  const cfg: Config = {}
  if (bench) {
    cfg.bench = {
      limit: typeof bench.limit === "number" ? bench.limit : undefined,
      repeat: typeof bench.repeat === "number" ? bench.repeat : undefined,
      warmup: typeof bench.warmup === "number" ? bench.warmup : undefined,
      concurrency: typeof bench.concurrency === "number" ? bench.concurrency : undefined,
      probe: typeof bench.probe === "boolean" ? bench.probe : undefined,
      nativeProfile: typeof bench.nativeProfile === "boolean" ? bench.nativeProfile : undefined,
    }
  }
  if (gate) {
    cfg.gate = {
      elapsedMs: typeof gate.elapsedMs === "number" ? gate.elapsedMs : undefined,
      totalMs: typeof gate.totalMs === "number" ? gate.totalMs : undefined,
      phases: map(gate.phases, "gate.phases"),
    }
  }
  if (base) {
    cfg.baseline = {
      file: typeof base.file === "string" ? base.file : undefined,
      summary: typeof base.summary === "string" ? base.summary : undefined,
      elapsedPct: typeof base.elapsedPct === "number" ? base.elapsedPct : undefined,
      totalPct: typeof base.totalPct === "number" ? base.totalPct : undefined,
      phases: map(base.phases, "baseline.phases"),
    }
  }
  if (typeof root.summary === "string") cfg.summary = root.summary
  if (typeof root.out === "string") cfg.out = root.out
  return cfg
}

export async function read(cwd: string): Promise<{ file: string | undefined; cfg: Config }> {
  const input = arg("--config")
  const file = input ? path.resolve(cwd, input) : path.resolve(cwd, "perf-index.jsonc")
  const exists = await Bun.file(file).exists()
  if (!exists) {
    if (input) throw new Error(`Config not found: ${file}`)
    return { file: undefined, cfg: {} satisfies Config }
  }
  return {
    file,
    cfg: await load(file),
  }
}

export function resolve(cwd: string, file: string | undefined, cfg: Config): Opts {
  const here = file ? path.dirname(file) : cwd
  const gate = threshold()
  const base = regression()
  const baseArg = arg("--baseline")
  const baseFile = baseArg
    ? path.resolve(cwd, baseArg)
    : cfg.baseline?.file
      ? path.resolve(cwd, path.resolve(here, cfg.baseline.file))
      : undefined
  const baseSumArg = arg("--baseline-summary")
  const baseSummary = baseSumArg
    ? path.resolve(cwd, baseSumArg)
    : cfg.baseline?.summary
      ? path.resolve(cwd, path.resolve(here, cfg.baseline.summary))
      : baseFile
        ? sidecar(baseFile)
        : undefined
  const out = arg("--out") ?? (cfg.out ? path.resolve(here, cfg.out) : ".tmp/perf-index.json")
  const sum = arg("--summary-out") ?? (cfg.summary ? path.resolve(here, cfg.summary) : ".tmp/perf-index-summary.json")
  const write = arg("--write-baseline")
  const writeSum = arg("--write-baseline-summary") ?? (write ? sidecar(write) : undefined)

  return {
    limit: pick(num("--limit"), cfg.bench?.limit),
    repeat: pick(num("--repeat"), cfg.bench?.repeat) ?? 3,
    warmup: pick(num("--warmup"), cfg.bench?.warmup) ?? 1,
    concurrency: pick(num("--concurrency"), cfg.bench?.concurrency) ?? 4,
    probe: pick(bool("--probe"), cfg.bench?.probe) ?? false,
    nativeProfile: pick(bool("--native-profile"), cfg.bench?.nativeProfile) ?? false,
    out: path.resolve(cwd, out),
    summary: path.resolve(cwd, sum),
    gate: {
      elapsedMs: pick(gate.elapsedMs, cfg.gate?.elapsedMs),
      totalMs: pick(gate.totalMs, cfg.gate?.totalMs),
      phases: {
        ...(cfg.gate?.phases ?? {}),
        ...gate.phases,
      },
    },
    baseline: {
      file: baseFile,
      summary: baseSummary,
      out: write ? path.resolve(cwd, write) : undefined,
      outSummary: writeSum ? path.resolve(cwd, writeSum) : undefined,
      regression: {
        elapsedPct: pick(base.elapsedPct, cfg.baseline?.elapsedPct),
        totalPct: pick(base.totalPct, cfg.baseline?.totalPct),
        phases: {
          ...(cfg.baseline?.phases ?? {}),
          ...base.phases,
        },
      },
    },
  }
}

async function git(cwd: string, args: string[]) {
  try {
    const proc = Bun.spawn(["git", ...args], {
      cwd,
      stdin: "ignore",
      stdout: "pipe",
      stderr: "ignore",
    })
    const [code, text] = await Promise.all([proc.exited, new Response(proc.stdout).text()])
    if (code !== 0) return
    const out = text.trim()
    return out.length > 0 ? out : undefined
  } catch {
    return
  }
}

export async function meta(cwd: string, file?: string): Promise<Meta> {
  const [branch, commit] = await Promise.all([
    git(cwd, ["rev-parse", "--abbrev-ref", "HEAD"]),
    git(cwd, ["rev-parse", "HEAD"]),
  ])
  return {
    createdAt: new Date().toISOString(),
    config: file,
    argv: process.argv.slice(2),
    runtime: {
      bun: process.versions.bun,
      platform: process.platform,
      arch: process.arch,
    },
    host: {
      hostname: os.hostname(),
    },
    git: {
      branch,
      commit,
    },
    ci: {
      githubWorkflow: process.env["GITHUB_WORKFLOW"],
      githubRunId: process.env["GITHUB_RUN_ID"],
      githubSha: process.env["GITHUB_SHA"],
      githubRef: process.env["GITHUB_REF"],
    },
  }
}

export async function loadVerdict(file: string) {
  return JSON.parse(await Bun.file(file).text()) as Verdict
}

export async function baselineSummary(file: string | undefined, required = false) {
  if (!file) {
    return {
      file: undefined,
      verdict: undefined,
    }
  }
  const exists = await Bun.file(file).exists()
  if (!exists) {
    if (required) throw new Error(`Baseline summary not found: ${file}`)
    return {
      file,
      verdict: undefined,
    }
  }
  return {
    file,
    verdict: await loadVerdict(file),
  }
}

export function guard(curr: { directory: string; meta: Meta }, prev?: Verdict) {
  const failures: string[] = []
  const notes: string[] = []

  if (!prev) {
    notes.push("- baseline summary unavailable")
    return {
      failures,
      notes,
    }
  }

  notes.push(`- baseline created at: ${prev.meta.createdAt}`)

  if (prev.directory !== curr.directory) {
    failures.push(`baseline directory ${prev.directory} does not match current directory ${curr.directory}`)
  }
  if (prev.meta.config && curr.meta.config && prev.meta.config !== curr.meta.config) {
    failures.push(`baseline config ${prev.meta.config} does not match current config ${curr.meta.config}`)
  }
  if (prev.meta.runtime.platform !== curr.meta.runtime.platform || prev.meta.runtime.arch !== curr.meta.runtime.arch) {
    failures.push(
      `baseline runtime ${prev.meta.runtime.platform}/${prev.meta.runtime.arch} does not match current runtime ${curr.meta.runtime.platform}/${curr.meta.runtime.arch}`,
    )
  }
  if (prev.meta.runtime.bun && curr.meta.runtime.bun && prev.meta.runtime.bun !== curr.meta.runtime.bun) {
    notes.push(`- bun version differs: ${curr.meta.runtime.bun} vs ${prev.meta.runtime.bun}`)
  }
  if (prev.meta.git.branch && curr.meta.git.branch && prev.meta.git.branch !== curr.meta.git.branch) {
    notes.push(`- git branch differs: ${curr.meta.git.branch} vs ${prev.meta.git.branch}`)
  }

  return {
    failures,
    notes,
  }
}

function row(label: string, value: number, max?: number) {
  if (max === undefined) return `- ${label}: ${value.toFixed(2)}ms`
  return `- ${label}: ${value.toFixed(2)}ms (limit ${max.toFixed(2)}ms)`
}

export function evaluate(report: Bench, input: Threshold) {
  const failures: string[] = []
  const notes: string[] = []

  notes.push(row("elapsed median", report.summary.elapsedMs.median, input.elapsedMs))
  notes.push(row("builder total median", report.summary.totalMs.median, input.totalMs))

  if (input.elapsedMs !== undefined && report.summary.elapsedMs.median > input.elapsedMs) {
    failures.push(
      `elapsed median ${report.summary.elapsedMs.median.toFixed(2)}ms exceeds ${input.elapsedMs.toFixed(2)}ms`,
    )
  }
  if (input.totalMs !== undefined && report.summary.totalMs.median > input.totalMs) {
    failures.push(
      `builder total median ${report.summary.totalMs.median.toFixed(2)}ms exceeds ${input.totalMs.toFixed(2)}ms`,
    )
  }

  for (const [name, max] of Object.entries(input.phases)) {
    const value = report.summary.phases[name]
    if (!value) {
      failures.push(`phase ${name} not found in benchmark summary`)
      continue
    }
    notes.push(row(`${name} median`, value.median, max))
    if (value.median > max) {
      failures.push(`phase ${name} median ${value.median.toFixed(2)}ms exceeds ${max.toFixed(2)}ms`)
    }
  }

  return {
    failures,
    notes,
  }
}

export function compare(curr: Bench, prev: Bench, input: Regression) {
  const failures: string[] = []
  const notes: string[] = []
  const seen = new Set([...Object.keys(curr.summary.phases), ...Object.keys(prev.summary.phases)])
  const rows: Phase[] = []
  const miss: string[] = []

  const line = (label: string, now: number, old: number, max?: number) => {
    const diff = old === 0 ? 0 : ((now - old) / old) * 100
    if (max === undefined) return `- ${label}: ${now.toFixed(2)}ms vs ${old.toFixed(2)}ms (${diff.toFixed(1)}%)`
    return `- ${label}: ${now.toFixed(2)}ms vs ${old.toFixed(2)}ms (${diff.toFixed(1)}%, limit ${max.toFixed(1)}%)`
  }

  notes.push(line("elapsed median", curr.summary.elapsedMs.median, prev.summary.elapsedMs.median, input.elapsedPct))
  notes.push(line("builder total median", curr.summary.totalMs.median, prev.summary.totalMs.median, input.totalPct))

  if (
    input.elapsedPct !== undefined &&
    prev.summary.elapsedMs.median > 0 &&
    ((curr.summary.elapsedMs.median - prev.summary.elapsedMs.median) / prev.summary.elapsedMs.median) * 100 >
      input.elapsedPct
  ) {
    failures.push(
      `elapsed median regression ${curr.summary.elapsedMs.median.toFixed(2)}ms vs ${prev.summary.elapsedMs.median.toFixed(2)}ms exceeds ${input.elapsedPct.toFixed(1)}%`,
    )
  }
  if (
    input.totalPct !== undefined &&
    prev.summary.totalMs.median > 0 &&
    ((curr.summary.totalMs.median - prev.summary.totalMs.median) / prev.summary.totalMs.median) * 100 > input.totalPct
  ) {
    failures.push(
      `builder total regression ${curr.summary.totalMs.median.toFixed(2)}ms vs ${prev.summary.totalMs.median.toFixed(2)}ms exceeds ${input.totalPct.toFixed(1)}%`,
    )
  }

  for (const [name, max] of Object.entries(input.phases)) {
    const now = curr.summary.phases[name]
    const old = prev.summary.phases[name]
    if (!now || !old) {
      failures.push(`phase ${name} missing in baseline comparison`)
      continue
    }
    notes.push(line(`${name} median`, now.median, old.median, max))
    if (old.median <= 0) continue
    const diff = ((now.median - old.median) / old.median) * 100
    if (diff > max) {
      failures.push(`phase ${name} regression ${diff.toFixed(1)}% exceeds ${max.toFixed(1)}%`)
    }
  }

  for (const name of seen) {
    const now = curr.summary.phases[name]
    const old = prev.summary.phases[name]
    if (!now || !old) {
      miss.push(name)
      continue
    }
    rows.push({
      name,
      currMs: now.median,
      prevMs: old.median,
      diffMs: now.median - old.median,
      diffPct: old.median > 0 ? ((now.median - old.median) / old.median) * 100 : undefined,
    })
  }

  return {
    failures,
    notes,
    phases: {
      regressions: rows.filter((item) => item.diffMs > 0).sort((a, b) => b.diffMs - a.diffMs),
      improvements: rows.filter((item) => item.diffMs < 0).sort((a, b) => a.diffMs - b.diffMs),
      stable: rows.filter((item) => item.diffMs === 0).length,
      missing: miss.sort(),
    },
  }
}

export function render(report: Bench, check: Check, file: string, sum?: string, base?: string) {
  const out: string[] = []
  out.push("## ax-code perf index")
  out.push("")
  out.push(`- directory: ${report.directory}`)
  out.push(`- files: ${report.files}`)
  out.push(`- repeat: ${report.requested.repeat}`)
  out.push(`- warmup: ${report.requested.warmup}`)
  out.push(`- native profile: ${report.requested.nativeProfile ? "on" : "off"}`)
  out.push(`- status: ${check.failures.length === 0 ? "passed" : "failed"}`)
  out.push("")
  out.push("Summary:")
  out.push(...check.notes)
  out.push("")
  out.push("Top phases:")
  for (const [name, value] of Object.entries(report.summary.phases).slice(0, 5)) {
    out.push(`- ${name}: median ${value.median.toFixed(2)}ms`)
  }
  out.push("")
  out.push(`Artifact: ${file}`)
  if (sum) out.push(`Summary: ${sum}`)
  if (base) out.push(`Baseline out: ${base}`)
  if (check.failures.length > 0) {
    out.push("")
    out.push("Failures:")
    out.push(...check.failures.map((item) => `- ${item}`))
  }
  out.push("")
  return out.join("\n")
}

function line(item: Phase) {
  const pct = item.diffPct === undefined ? "n/a" : `${item.diffPct >= 0 ? "+" : ""}${item.diffPct.toFixed(1)}%`
  const ms = `${item.diffMs >= 0 ? "+" : ""}${item.diffMs.toFixed(2)}ms`
  return `- ${item.name}: ${item.currMs.toFixed(2)}ms vs ${item.prevMs.toFixed(2)}ms (${ms}, ${pct})`
}

export function renderCompare(
  report: Bench,
  check: Check & { phases?: PhaseSummary; compat?: Check },
  file: string,
  base: string,
) {
  const out: string[] = []
  out.push("## ax-code perf index baseline")
  out.push("")
  out.push(`- directory: ${report.directory}`)
  out.push(`- files: ${report.files}`)
  out.push(`- status: ${check.failures.length === 0 ? "passed" : "failed"}`)
  out.push("")
  out.push("Artifacts:")
  out.push(`- current: ${file}`)
  out.push(`- baseline: ${base}`)
  out.push("")
  if ("compat" in check && check.compat) {
    out.push("Compatibility:")
    out.push(...check.compat.notes)
    if (check.compat.failures.length > 0) {
      out.push("")
      out.push("Compatibility Failures:")
      out.push(...check.compat.failures.map((item) => `- ${item}`))
    }
    out.push("")
  }
  out.push("Comparison:")
  out.push(...check.notes)
  if (check.phases) {
    out.push("")
    out.push(`- stable phases: ${check.phases.stable}`)
    if (check.phases.missing.length > 0) out.push(`- missing phases: ${check.phases.missing.join(", ")}`)
    if (check.phases.regressions.length > 0) {
      out.push("")
      out.push("Top regressions:")
      out.push(...check.phases.regressions.slice(0, 5).map(line))
    }
    if (check.phases.improvements.length > 0) {
      out.push("")
      out.push("Top improvements:")
      out.push(...check.phases.improvements.slice(0, 5).map(line))
    }
  }
  if (check.failures.length > 0) {
    out.push("")
    out.push("Failures:")
    out.push(...check.failures.map((item) => `- ${item}`))
  }
  out.push("")
  return out.join("\n")
}

export function verdict(
  report: Bench,
  out: string,
  sum: string,
  gate: Check,
  diff?: Compare,
  base?: string,
  baseSum?: string,
  write?: string,
  writeSum?: string,
  info?: Meta,
): Verdict {
  const compat = diff?.compat
  return {
    ok:
      gate.failures.length === 0 &&
      (diff ? diff.failures.length === 0 && (compat ? compat.failures.length === 0 : true) : true),
    directory: report.directory,
    files: report.files,
    out,
    summary: sum,
    baseline: {
      file: base,
      summary: baseSum,
      out: write,
      outSummary: writeSum,
      compat: compat
        ? {
            ok: compat.failures.length === 0,
            failures: compat.failures,
            notes: compat.notes,
          }
        : undefined,
    },
    meta: info ?? {
      createdAt: new Date(0).toISOString(),
      argv: [],
      runtime: {
        bun: undefined,
        platform: process.platform,
        arch: process.arch,
      },
      host: {
        hostname: "",
      },
      git: {},
      ci: {},
    },
    requested: report.requested,
    metrics: {
      elapsedMs: report.summary.elapsedMs.median,
      totalMs: report.summary.totalMs.median,
      phases: Object.fromEntries(Object.entries(report.summary.phases).map(([name, item]) => [name, item.median])),
    },
    gate: {
      ok: gate.failures.length === 0,
      failures: gate.failures,
      notes: gate.notes,
    },
    compare: diff
      ? {
          ok: diff.failures.length === 0 && (compat ? compat.failures.length === 0 : true),
          failures: diff.failures,
          notes: diff.notes,
          phases: diff.phases,
          compat,
        }
      : undefined,
  }
}

async function run(cwd: string, opts: Opts) {
  const cmd = [process.execPath, "run", "./src/index.ts", "debug", "perf", "index", "--json"]
  if (opts.limit !== undefined) cmd.push("--limit", String(opts.limit))
  cmd.push("--repeat", String(opts.repeat))
  cmd.push("--warmup", String(opts.warmup))
  cmd.push("--concurrency", String(opts.concurrency))
  if (opts.probe) cmd.push("--probe")
  if (opts.nativeProfile) cmd.push("--native-profile")

  const proc = Bun.spawn(cmd, {
    cwd,
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  })
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ])
  if (code !== 0) {
    throw new Error(stderr || stdout || `perf benchmark failed with exit code ${code}`)
  }
  return JSON.parse(stdout) as Bench
}

async function main() {
  const cwd = path.resolve(arg("--cwd") ?? process.cwd())
  const { file, cfg } = await read(cwd)
  const opts = resolve(cwd, file, cfg)
  const info = await meta(cwd, file)
  const report = await run(cwd, opts)
  const gate = evaluate(report, opts.gate)

  await fs.mkdir(path.dirname(opts.out), { recursive: true })
  await Bun.write(opts.out, JSON.stringify(report, null, 2) + "\n")
  if (opts.baseline.out) {
    await fs.mkdir(path.dirname(opts.baseline.out), { recursive: true })
    await Bun.write(opts.baseline.out, JSON.stringify(report, null, 2) + "\n")
  }

  const out = [render(report, gate, opts.out, opts.summary, opts.baseline.out)]
  const failures = [...gate.failures]
  let diff: Compare | undefined

  const base = opts.baseline.file
  const baseSummary = await baselineSummary(
    opts.baseline.summary,
    parts("--baseline-summary").length > 0 || !!cfg.baseline?.summary,
  )
  const hasBase =
    base &&
    (opts.baseline.regression.elapsedPct !== undefined ||
      opts.baseline.regression.totalPct !== undefined ||
      Object.keys(opts.baseline.regression.phases).length > 0)

  if (hasBase) {
    if (!(await Bun.file(base).exists())) {
      throw new Error(`Baseline not found: ${base}`)
    }
    const prev = JSON.parse(await Bun.file(base).text()) as Bench
    diff = compare(report, prev, opts.baseline.regression)
    diff.compat = guard({ directory: report.directory, meta: info }, baseSummary.verdict)
    out.push(renderCompare(report, diff, opts.out, base))
    failures.push(...diff.failures)
    if (diff.compat) failures.push(...diff.compat.failures)
  }

  await fs.mkdir(path.dirname(opts.summary), { recursive: true })
  const result = verdict(
    report,
    opts.out,
    opts.summary,
    gate,
    diff,
    opts.baseline.file,
    baseSummary.file,
    opts.baseline.out,
    opts.baseline.outSummary,
    info,
  )
  await Bun.write(opts.summary, JSON.stringify(result, null, 2) + "\n")
  if (opts.baseline.outSummary && opts.baseline.out) {
    await fs.mkdir(path.dirname(opts.baseline.outSummary), { recursive: true })
    await Bun.write(
      opts.baseline.outSummary,
      JSON.stringify(
        verdict(
          report,
          opts.baseline.out,
          opts.baseline.outSummary,
          gate,
          diff,
          opts.baseline.file,
          baseSummary.file,
          opts.baseline.out,
          opts.baseline.outSummary,
          info,
        ),
        null,
        2,
      ) + "\n",
    )
  }

  const text = out.join("\n")
  console.log(text)

  const fileOut = process.env["GITHUB_STEP_SUMMARY"]
  if (fileOut) {
    await Bun.write(
      fileOut,
      `${await Bun.file(fileOut)
        .text()
        .catch(() => "")}${text}\n`,
    )
  }

  if (failures.length > 0) process.exit(1)
}

if (import.meta.main) {
  await main()
}
