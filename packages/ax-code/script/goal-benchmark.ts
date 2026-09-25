import fs from "node:fs/promises"
import path from "node:path"
import { createHash } from "node:crypto"
import { spawnSync } from "node:child_process"
import { createRequire } from "node:module"
import { fileURLToPath } from "node:url"
import z from "zod"
import { parseJsonStrict } from "../src/util/json-value"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const fixture = "test/benchmark/goal-mode.bench.ts"
const require = createRequire(import.meta.url)
const hash = (value: string | Buffer) => createHash("sha256").update(value).digest("hex")
const git = (...args: string[]) => {
  const result = spawnSync("git", args, { cwd: root, encoding: "utf8" })
  if (result.status !== 0) throw new Error(result.stderr)
  return result.stdout.trim()
}
const Observation = z
  .object({
    scenario: z.string(),
    category: z.enum(["reliability", "preserved", "capability"]),
    repetition: z.number().int().nonnegative(),
    passed: z.boolean(),
    elapsedMs: z.number().finite().nonnegative(),
    detail: z.string(),
    modelCalls: z.number().int().nonnegative().optional(),
    goalTurns: z.number().int().nonnegative().optional(),
    horizonReached: z.boolean().optional(),
  })
  .strict()
const Capture = z
  .object({
    version: z.literal(1),
    repetitions: z.number().int().min(1).max(20),
    scenarios: z.array(z.string()).min(1),
    observations: z.array(Observation),
    revision: z.string(),
    runtimeDiffHash: z.string(),
    fixtureHash: z.string(),
    node: z.string(),
    model: z.literal("scripted-no-network"),
    runnerExitCode: z.number().int(),
  })
  .strict()
function validate(value: unknown) {
  const capture = Capture.parse(value)
  if (capture.runnerExitCode !== 0) throw new Error("Incomplete capture: benchmark runner failed")
  const keys = new Set(capture.observations.map((item) => `${item.scenario}:${item.repetition}`))
  if (keys.size !== capture.observations.length || keys.size !== capture.scenarios.length * capture.repetitions)
    throw new Error("Incomplete or duplicate benchmark observations")
  for (const scenario of capture.scenarios)
    for (let i = 0; i < capture.repetitions; i++)
      if (!keys.has(`${scenario}:${i}`)) throw new Error("Missing benchmark pair")
  return capture
}
const median = (values: number[]) => {
  if (!values.length) return null
  const sorted = [...values].sort((a, b) => a - b)
  const i = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[i] : (sorted[i - 1] + sorted[i]) / 2
}
const [action, file, arg] = process.argv.slice(2)
if (action === "run" && file) {
  const output = path.resolve(file)
  await fs.mkdir(path.dirname(output), { recursive: true })
  const handle = await fs.open(output, "wx")
  await handle.close()
  const repetitions = Number(arg ?? 5)
  if (!Number.isSafeInteger(repetitions) || repetitions < 1 || repetitions > 20)
    throw new Error("Repetitions must be 1..20")
  const fixtureHash = hash(await fs.readFile(path.join(root, fixture)))
  const revision = git("rev-parse", "HEAD")
  const runtimeDiffHash = hash(git("diff", "HEAD", "--", "src", "../ax-code-intel/src", "../ax-code-reason/src"))
  const cli = path.join(path.dirname(require.resolve("vitest/package.json")), "vitest.mjs")
  const child = spawnSync(process.execPath, [cli, "run", "--retry", "0", "--maxWorkers", "1"], {
    cwd: root,
    stdio: "inherit",
    timeout: 240000,
    env: {
      ...process.env,
      AX_TEST_FILES: fixture,
      GOAL_BENCHMARK_OUTPUT: output,
      GOAL_BENCHMARK_REPETITIONS: String(repetitions),
    },
  })
  const raw = z
    .object({
      version: z.literal(1),
      repetitions: z.number(),
      scenarios: z.array(z.string()),
      observations: z.array(Observation),
    })
    .parse(parseJsonStrict(await fs.readFile(output, "utf8")))
  const sourceChanged =
    revision !== git("rev-parse", "HEAD") ||
    runtimeDiffHash !== hash(git("diff", "HEAD", "--", "src", "../ax-code-intel/src", "../ax-code-reason/src")) ||
    fixtureHash !== hash(await fs.readFile(path.join(root, fixture)))
  const capture = {
    ...raw,
    revision,
    runtimeDiffHash,
    fixtureHash,
    node: process.version,
    model: "scripted-no-network",
    runnerExitCode: sourceChanged ? 1 : (child.status ?? 1),
  }
  await fs.writeFile(output, JSON.stringify(capture, null, 2) + "\n")
  validate(capture)
  console.log(`Captured ${raw.observations.length} observations; behavior failures remain in the report denominator.`)
} else if (action === "compare" && file && arg) {
  const baseline = validate(parseJsonStrict(await fs.readFile(file, "utf8")))
  const candidate = validate(parseJsonStrict(await fs.readFile(arg, "utf8")))
  if (
    baseline.fixtureHash !== candidate.fixtureHash ||
    baseline.repetitions !== candidate.repetitions ||
    baseline.node !== candidate.node ||
    JSON.stringify(baseline.scenarios) !== JSON.stringify(candidate.scenarios)
  )
    throw new Error("Comparison requires identical fixture, repetition count, scenarios and Node version")
  const emptyDiff = hash("")
  if (baseline.runtimeDiffHash !== emptyDiff || candidate.runtimeDiffHash !== emptyDiff)
    throw new Error("Runtime source differs from the declared revision")
  const rows = baseline.scenarios.map((scenario) => {
    const before = baseline.observations.filter((item) => item.scenario === scenario)
    const after = candidate.observations.filter((item) => item.scenario === scenario)
    const summarize = (items: typeof before) => ({
      passed: items.filter((item) => item.passed).length,
      total: items.length,
      elapsedMedianMs: median(items.map((item) => item.elapsedMs)),
      modelCalls: items.flatMap((item) => (item.modelCalls === undefined ? [] : [item.modelCalls])),
      goalTurns: items.flatMap((item) => (item.goalTurns === undefined ? [] : [item.goalTurns])),
      failures: [...new Set(items.filter((item) => !item.passed).map((item) => item.detail))],
    })
    return { scenario, category: before[0].category, baseline: summarize(before), candidate: summarize(after) }
  })
  console.log(
    JSON.stringify(
      {
        baseline: baseline.revision,
        candidate: candidate.revision,
        fixtureHash: baseline.fixtureHash,
        rows,
        limitations: [
          "Scripted provider observations test runtime behavior, not model capability or live task success.",
          "Timing measures scenario operations in one local worker; setup/import time is excluded. No provider cost or throughput claim.",
          "The prose-loop observer stops at 12 calls; baseline latency is censored at that horizon.",
          "Cases target the reviewed changes; capability additions are reported separately from existing behavior.",
        ],
      },
      null,
      2,
    ),
  )
} else
  throw new Error(
    "Usage: tsx script/goal-benchmark.ts run OUTPUT.json [REPETITIONS] | compare BASELINE.json CANDIDATE.json",
  )
