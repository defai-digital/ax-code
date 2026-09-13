#!/usr/bin/env tsx
/**
 * Deterministic ensemble eval runner (ADR-102). No model calls.
 *
 *   tsx script/ensemble-eval.ts run [--dir <fixtures>]
 *   tsx script/ensemble-eval.ts sweep [--dir <fixtures>] [--from 0.3] [--to 0.75] [--step 0.05]
 *
 * `run` scores every golden fixture against the current ensemble constants
 * and exits 1 when any case fails. `sweep` reports council-aggregate pass
 * counts across SIMILARITY_MERGE_THRESHOLD values; it is evidence for a
 * PRD/ADR-gated constant change, never auto-tuning.
 */
import path from "node:path"
import { EnsembleEval } from "../src/mode/ensemble-eval"

const args = process.argv.slice(2)
const command = args[0] ?? "run"

function optionValue(name: string): string | undefined {
  const index = args.indexOf(`--${name}`)
  return index >= 0 ? args[index + 1] : undefined
}

const fixtureDir = path.resolve(
  optionValue("dir") ?? path.join(import.meta.dirname, "..", "test", "mode", "fixtures", "ensemble-eval"),
)

const cases = EnsembleEval.loadCases(fixtureDir)
if (cases.length === 0) {
  console.error(`No golden cases found in ${fixtureDir}`)
  process.exit(2)
}

if (command === "run") {
  const results = EnsembleEval.evaluateSuite(cases)
  console.log(EnsembleEval.renderRunMarkdown(results))
  const failed = results.filter((r) => !r.pass).length
  process.exit(failed === 0 ? 0 : 1)
}

if (command === "sweep") {
  const from = Number(optionValue("from") ?? "0.3")
  const to = Number(optionValue("to") ?? "0.75")
  const step = Number(optionValue("step") ?? "0.05")
  if (!Number.isFinite(from) || !Number.isFinite(to) || !Number.isFinite(step) || step <= 0 || to < from) {
    console.error("Invalid sweep bounds: require --from <= --to and --step > 0")
    process.exit(2)
  }
  const thresholds: number[] = []
  for (let t = from; t <= to + Number.EPSILON; t += step) thresholds.push(Number(t.toFixed(4)))
  const { markdown, best } = EnsembleEval.renderSweepMarkdown(cases, thresholds)
  console.log(markdown)
  console.log(`\nBest sweep threshold: ${best.threshold.toFixed(2)} (${best.passed} council cases passed)`)
  process.exit(0)
}

console.error(`Unknown command: ${command} (expected "run" or "sweep")`)
process.exit(2)
