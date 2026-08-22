// Baseline recording, formatting, and comparison for the perf harness.
//
// Recorded runs land in perf/baseline/ as JSON; only *.reference.json files
// are committed (see perf/baseline/.gitignore). Comparison is human-eye by
// default — the harness only exits non-zero on regression when explicitly
// invoked with --fail-on-regression.
import { mkdir, readFile, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import z from "zod"
import type { ScenarioResult } from "./metrics"
import { round } from "./metrics"

export const ScenarioResultSchema = z.object({
  scenario: z.string(),
  language: z.enum(["ts", "py", "rust"]),
  serverId: z.string(),
  samples: z.number(),
  p50: z.number(),
  p95: z.number(),
  peakRssKb: z.number().optional(),
  hitRate: z.number().optional(),
  rpcCount: z.number().optional(),
  totalMs: z.number(),
})

export const BaselineFile = z.object({
  version: z.literal(1),
  meta: z.object({
    recordedAt: z.string(),
    scenario: z.string(),
    external: z.boolean(),
    host: z.string(),
    platform: z.string(),
    arch: z.string(),
    node: z.string(),
  }),
  results: z.array(ScenarioResultSchema),
})
export type BaselineFile = z.infer<typeof BaselineFile>
export type BaselineMeta = BaselineFile["meta"]

export function collectMeta(scenario: string, external: boolean): BaselineMeta {
  return {
    recordedAt: new Date().toISOString(),
    scenario,
    external,
    host: os.hostname(),
    platform: process.platform,
    arch: process.arch,
    node: process.version,
  }
}

export function buildBaseline(results: ScenarioResult[], meta: BaselineMeta): BaselineFile {
  return { version: 1, meta, results }
}

export function baselineFileName(meta: BaselineMeta): string {
  const date = meta.recordedAt.slice(0, 10).replaceAll("-", "")
  const host = meta.host.replaceAll(/[^a-zA-Z0-9.-]/g, "_")
  return `baseline-${date}-${host}-node${meta.node.replace(/^v?(\d+).*$/, "$1")}.json`
}

export async function writeBaseline(dir: string, baseline: BaselineFile): Promise<string> {
  await mkdir(dir, { recursive: true })
  const file = path.join(dir, baselineFileName(baseline.meta))
  await writeFile(file, JSON.stringify(baseline, null, 2) + "\n", "utf8")
  return file
}

// Parse a recorded baseline. Validates the payload instead of trusting raw
// JSON — a hand-edited or truncated baseline should fail with a useful
// error, not a downstream type confusion.
export function parseBaseline(raw: string): BaselineFile {
  return BaselineFile.parse(JSON.parse(raw))
}

export async function readBaseline(file: string): Promise<BaselineFile> {
  return parseBaseline(await readFile(file, "utf8"))
}

const cell = (value: number | undefined, suffix = "") => (value === undefined ? "—" : `${value}${suffix}`)

export function formatMarkdownTable(results: ScenarioResult[]): string {
  const lines = [
    "| scenario | language | server | samples | p50 (ms) | p95 (ms) | peak RSS (MB) | hit rate | RPCs | total (ms) |",
    "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |",
  ]
  for (const r of results) {
    lines.push(
      `| ${r.scenario} | ${r.language} | ${r.serverId} | ${r.samples} | ${round(r.p50)} | ${round(r.p95)} | ` +
        `${cell(r.peakRssKb === undefined ? undefined : round(r.peakRssKb / 1024))} | ${cell(r.hitRate)} | ${cell(r.rpcCount)} | ${round(r.totalMs)} |`,
    )
  }
  return lines.join("\n")
}

export type ComparisonRow = {
  scenario: string
  language: string
  serverId: string
  metric: "p50" | "p95" | "peakRssKb" | "hitRate" | "rpcCount" | "totalMs"
  reference: number
  current: number
  deltaPct: number
  regression: boolean
}

// Metrics where "up" is bad. hitRate is the only one where down is bad.
const HIGHER_IS_WORSE = new Set(["p50", "p95", "peakRssKb", "rpcCount", "totalMs"])

export function compareResults(
  current: ScenarioResult[],
  reference: ScenarioResult[],
  thresholdPct = 20,
): ComparisonRow[] {
  const rows: ComparisonRow[] = []
  const refByKey = new Map(reference.map((r) => [`${r.scenario}|${r.language}|${r.serverId}`, r]))
  for (const cur of current) {
    const ref = refByKey.get(`${cur.scenario}|${cur.language}|${cur.serverId}`)
    if (!ref) continue
    const metrics = ["p50", "p95", "peakRssKb", "hitRate", "rpcCount", "totalMs"] as const
    for (const metric of metrics) {
      const refValue = ref[metric]
      const curValue = cur[metric]
      if (refValue === undefined || curValue === undefined) continue
      if (refValue === 0 && curValue === 0) continue
      const deltaPct = refValue === 0 ? 100 : round(((curValue - refValue) / refValue) * 100)
      const regression = HIGHER_IS_WORSE.has(metric) ? deltaPct > thresholdPct : deltaPct < -thresholdPct
      rows.push({
        scenario: cur.scenario,
        language: cur.language,
        serverId: cur.serverId,
        metric,
        reference: refValue,
        current: curValue,
        deltaPct,
        regression,
      })
    }
  }
  return rows
}

export function formatComparisonMarkdown(rows: ComparisonRow[]): string {
  if (rows.length === 0) return "no overlapping scenario results to compare"
  const lines = [
    "| scenario | language | server | metric | reference | current | delta | |",
    "| --- | --- | --- | --- | --- | --- | --- | --- |",
  ]
  for (const row of rows) {
    const flag = row.regression ? "REGRESSION" : ""
    lines.push(
      `| ${row.scenario} | ${row.language} | ${row.serverId} | ${row.metric} | ${row.reference} | ${row.current} | ${row.deltaPct}% | ${flag} |`,
    )
  }
  return lines.join("\n")
}
