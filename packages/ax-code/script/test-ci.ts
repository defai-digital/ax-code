import { spawn } from "child_process"
import { createRequire } from "module"
import path from "path"
import fs from "fs/promises"
import { existsSync } from "fs"
import type { Readable } from "node:stream"
import { check, list, pick, root } from "./test-group"
import { writeCoverageArtifacts } from "./test-coverage"

type Result = {
  code: number
  file: string
  ignored: number
  coverageDir?: string
  stats: {
    tests: number
    failures: number
    skipped: number
    time: number
  }
}

const harmlessEffectInterrupt = "All fibers interrupted without error"

// Resolve the vitest CLI from the installed package (its ./vitest.mjs bin is not
// exposed via "exports"). Spawned with the current node so CI runs Bun-free.
function vitestCli() {
  const require = createRequire(import.meta.url)
  return path.join(path.dirname(require.resolve("vitest/package.json")), "vitest.mjs")
}

function arg(name: string) {
  const idx = process.argv.indexOf(name)
  if (idx === -1) return
  return process.argv[idx + 1]
}

function flag(name: string) {
  return process.argv.includes(name)
}

export function resolveTestCIGroup(argv = process.argv.slice(2)) {
  const args = argv[0] === "--" ? argv.slice(1) : argv
  const group = args[0]
  if (!group || group.startsWith("-")) return "deterministic"
  return group
}

export function num(name: string, fallback = 0) {
  const value = arg(name)
  if (!value) return fallback
  const parsed = Number.parseInt(value, 10)
  if (Number.isNaN(parsed) || parsed < 0) throw new Error(`Invalid value for ${name}: ${value}`)
  return parsed
}

export function shardFiles(files: string[], size: number) {
  if (!Number.isSafeInteger(size) || size < 1) throw new Error(`Shard size must be a positive integer: ${size}`)
  const shards: string[][] = []
  for (let index = 0; index < files.length; index += size) shards.push(files.slice(index, index + size))
  return shards
}

function attrs(text: string) {
  return Object.fromEntries(Array.from(text.matchAll(/(\w+)="([^"]*)"/g)).map((part) => [part[1], part[2]]))
}

export async function parseJUnit(file: string, output = "") {
  if (!existsSync(file)) {
    return { tests: 0, failures: 0, skipped: 0, time: 0, ignored: 0 }
  }
  const text = await fs.readFile(file, "utf8")
  const combinedText = `${text}\n${output}`
  const rootTag = text.match(/<(testsuites|testsuite)\s+([^>]+)>/)
  const data = rootTag ? attrs(rootTag[2] ?? "") : {}
  const tests = Number.parseInt(data.tests ?? "") || text.match(/<testcase\b/g)?.length || 0
  const errorTags = Array.from(text.matchAll(/<error\b[^>]*(?:\/>|>[\s\S]*?<\/error>)/g), (match) => match[0] ?? "")
  const failureCount = Number.parseInt(data.failures ?? "") || (text.match(/<failure\b/g)?.length ?? 0)
  const errorCount = Number.parseInt(data.errors ?? "") || errorTags.length
  const failures = failureCount + errorCount
  const skipped = Number.parseInt(data.skipped ?? "") || (text.match(/<skipped\b/g)?.length ?? 0)
  const time = Number.parseFloat(data.time ?? "") || 0
  const ignored =
    failureCount === 0 &&
    errorCount <= 1 &&
    combinedText.includes(harmlessEffectInterrupt) &&
    errorTags.every((tag) => tag.includes(harmlessEffectInterrupt))
      ? errorCount || 1
      : 0
  return { tests, failures: Math.max(0, failures - ignored), skipped, time, ignored }
}

// Mirror a child stream to a writer while capturing its text.
function tee(stream: Readable | null, writer: NodeJS.WriteStream): Promise<string> {
  if (!stream) return Promise.resolve("")
  return new Promise((resolve) => {
    let text = ""
    stream.on("data", (chunk: Buffer) => {
      writer.write(chunk)
      text += chunk.toString()
    })
    const finish = () => resolve(text)
    stream.once("end", finish)
    stream.once("close", finish)
    stream.once("error", finish)
  })
}

async function run(group: string, files: string[], dir: string, run: number, shard?: number) {
  const file = path.join(dir, `${group}-${run}${shard ? `-shard-${shard}` : ""}.xml`)
  const coverageDir = flag("--coverage") ? path.join(root, arg("--coverage-dir") ?? ".tmp/coverage") : undefined
  // The 30s per-test timeout and setup/preload files come from vitest.config.ts.
  // The exact file set is passed through the config's `include` via AX_TEST_FILES
  // (vitest positional filters can't reliably target an exact set).
  const command = [vitestCli(), "run", "--reporter=junit", `--outputFile=${file}`]
  const maxWorkers = process.env.AX_TEST_MAX_WORKERS
  if (maxWorkers) {
    command.push(`--maxWorkers=${maxWorkers}`)
  }
  if (coverageDir) {
    command.push(
      "--coverage.enabled",
      "--coverage.provider=v8",
      "--coverage.reporter=text",
      "--coverage.reporter=lcov",
      `--coverage.reportsDirectory=${coverageDir}`,
    )
  }
  const proc = spawn(process.execPath, command, {
    cwd: root,
    stdio: ["inherit", "pipe", "pipe"],
    env: { ...process.env, AX_TEST_FILES: files.join(",") },
  })
  const [stdout, stderr, code] = await Promise.all([
    tee(proc.stdout, process.stdout),
    tee(proc.stderr, process.stderr),
    new Promise<number>((resolve) => {
      proc.on("exit", (value) => resolve(value ?? 1))
      proc.on("error", () => resolve(1))
    }),
  ])
  const stats = await parseJUnit(file, `${stdout}\n${stderr}`)
  return {
    code: code !== 0 && stats.failures === 0 && stats.ignored > 0 ? 0 : code,
    file,
    ignored: stats.ignored,
    coverageDir,
    stats,
  } satisfies Result
}

function fmt(ms: number) {
  return `${ms.toFixed(2)}s`
}

export function renderSummaryText(group: string, runs: Result[]) {
  const out = [] as string[]
  const first = runs[0]
  const retry = runs.slice(1)
  const flaky = first.code !== 0 && retry.some((run) => run.code === 0)

  out.push(`## ax-code ${group}`)
  out.push("")
  out.push(`- initial: ${first.code === 0 ? "passed" : "failed"}`)
  out.push(`- tests: ${first.stats.tests}`)
  out.push(`- failures: ${first.stats.failures}`)
  out.push(`- skipped: ${first.stats.skipped}`)
  out.push(`- runtime: ${fmt(first.stats.time)}`)
  if (retry.length) {
    out.push(`- reruns: ${retry.length}`)
    out.push(`- likely flaky: ${flaky ? "yes" : "no"}`)
  }
  if (runs.some((run) => run.ignored > 0)) {
    out.push(`- ignored harmless errors: ${runs.reduce((sum, run) => sum + run.ignored, 0)}`)
  }
  if (runs.some((run) => run.stats.skipped > 0)) {
    out.push(`- max skipped across runs: ${Math.max(...runs.map((run) => run.stats.skipped))}`)
  }
  out.push("")
  out.push("Artifacts:")
  for (const run of runs) {
    out.push(`- ${path.basename(run.file)} (${run.code === 0 ? "passed" : "failed"})`)
  }
  out.push("")
  return out.join("\n")
}

async function summary(group: string, runs: Result[]) {
  const text = renderSummaryText(group, runs)
  console.log(text)
  const file = process.env["GITHUB_STEP_SUMMARY"]
  if (file) {
    const existing = await fs.readFile(file, "utf8").catch(() => "")
    await fs.writeFile(file, `${existing}${text}\n`)
  }
}

async function main() {
  const group = resolveTestCIGroup()

  const all = await list()
  check(all)
  const files = pick(all, group)
  if (files.length === 0) {
    console.log(`No tests in group: ${group}`)
    return
  }

  const dir = path.join(root, arg("--dir") ?? ".tmp/test-report")
  await fs.mkdir(dir, { recursive: true })
  await fs.writeFile(path.join(dir, ".keep"), "")

  const shardSize = process.env.AX_TEST_SHARD_SIZE ? Number.parseInt(process.env.AX_TEST_SHARD_SIZE, 10) : files.length
  const shards = shardFiles(files, shardSize)
  const runPass = async (runNumber: number): Promise<Result> => {
    const results: Result[] = []
    for (const [index, shard] of shards.entries())
      results.push(await run(group, shard, dir, runNumber, shards.length > 1 ? index + 1 : undefined))
    return {
      code: results.some((result) => result.code !== 0) ? 1 : 0,
      file: path.join(dir, `${group}-${runNumber}${shards.length > 1 ? "-shards" : ""}.xml`),
      ignored: results.reduce((sum, result) => sum + result.ignored, 0),
      stats: results.reduce(
        (sum, result) => ({
          tests: sum.tests + result.stats.tests,
          failures: sum.failures + result.stats.failures,
          skipped: sum.skipped + result.stats.skipped,
          time: sum.time + result.stats.time,
        }),
        { tests: 0, failures: 0, skipped: 0, time: 0 },
      ),
    }
  }

  const reruns = num("--rerun-on-fail")
  const runs = [] as Result[]
  runs.push(await runPass(1))
  for (let i = 0; i < reruns; i++) {
    if (runs[runs.length - 1]?.code === 0) break
    runs.push(await runPass(i + 2))
  }

  await summary(group, runs)
  if (flag("--coverage")) {
    const coverageDir = runs[runs.length - 1]?.coverageDir
    const lcovFile = coverageDir ? path.join(coverageDir, "lcov.info") : undefined
    if (lcovFile && existsSync(lcovFile)) {
      await writeCoverageArtifacts({
        group,
        lcovFile,
        summaryFile: path.join(root, arg("--coverage-summary-out") ?? ".tmp/coverage-summary.json"),
        reportFile: path.join(root, arg("--coverage-report-out") ?? ".tmp/coverage-report.md"),
        baselineFile: arg("--coverage-baseline") ? path.join(root, arg("--coverage-baseline")!) : undefined,
      })
    }
  }
  if (runs.some((run) => run.code !== 0)) process.exit(1)
}

if (import.meta.url === `file://${process.argv[1]}` || import.meta.main) {
  await main()
}
