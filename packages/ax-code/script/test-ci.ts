import path from "path"
import fs from "fs/promises"
import { check, list, pick, root } from "./test-group"

type Result = {
  code: number
  file: string
  ignored: number
  stats: {
    tests: number
    failures: number
    skipped: number
    time: number
  }
}

const harmlessEffectInterrupt = "All fibers interrupted without error"

function arg(name: string) {
  const idx = process.argv.indexOf(name)
  if (idx === -1) return
  return process.argv[idx + 1]
}

function num(name: string, fallback = 0) {
  const value = arg(name)
  if (!value) return fallback
  const parsed = Number.parseInt(value, 10)
  if (Number.isNaN(parsed) || parsed < 0) throw new Error(`Invalid value for ${name}: ${value}`)
  return parsed
}

function attrs(text: string) {
  return Object.fromEntries(Array.from(text.matchAll(/(\w+)="([^"]*)"/g)).map((part) => [part[1], part[2]]))
}

async function parse(file: string) {
  if (!(await Bun.file(file).exists())) {
    return { tests: 0, failures: 0, skipped: 0, time: 0, ignored: 0 }
  }
  const text = await Bun.file(file).text()
  const rootTag = text.match(/<(testsuites|testsuite)\s+([^>]+)>/)
  const data = rootTag ? attrs(rootTag[2] ?? "") : {}
  const tests = Number.parseInt(data.tests ?? "") || text.match(/<testcase\b/g)?.length || 0
  const errorTags = Array.from(text.matchAll(/<error\b[^>]*(?:\/>|>[\s\S]*?<\/error>)/g), (match) => match[0] ?? "")
  const failureCount = Number.parseInt(data.failures ?? "") || (text.match(/<failure\b/g)?.length ?? 0)
  const errorCount = Number.parseInt(data.errors ?? "") || errorTags.length
  const failures = failureCount + errorCount
  const skipped =
    Number.parseInt(data.skipped ?? "") ||
    (text.match(/<skipped\b/g)?.length ?? 0)
  const time = Number.parseFloat(data.time ?? "") || 0
  const ignored =
    failureCount === 0 &&
    errorCount <= 1 &&
    text.includes(harmlessEffectInterrupt) &&
    errorTags.every((tag) => tag.includes(harmlessEffectInterrupt))
      ? errorCount || 1
      : 0
  return { tests, failures: Math.max(0, failures - ignored), skipped, time, ignored }
}

async function run(group: string, files: string[], dir: string, run: number) {
  const file = path.join(dir, `${group}-${run}.xml`)
  const setup = path.join(root, "test/setup/effect-interrupt.ts")
  const proc = Bun.spawn(
    [
      process.execPath,
      "test",
      "--timeout",
      "30000",
      "--preload",
      setup,
      "--reporter",
      "junit",
      "--reporter-outfile",
      file,
      ...files,
    ],
    {
      cwd: root,
      stdin: "inherit",
      stdout: "inherit",
      stderr: "inherit",
    },
  )
  const code = await proc.exited
  const stats = await parse(file)
  return {
    code: code !== 0 && stats.failures === 0 && stats.ignored > 0 ? 0 : code,
    file,
    ignored: stats.ignored,
    stats,
  } satisfies Result
}

function fmt(ms: number) {
  return `${ms.toFixed(2)}s`
}

async function summary(group: string, runs: Result[]) {
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
  const text = out.join("\n")
  console.log(text)
  const file = process.env["GITHUB_STEP_SUMMARY"]
  if (file) {
    await Bun.write(file, `${await Bun.file(file).text().catch(() => "")}${text}\n`)
  }
}

async function main() {
  const group = process.argv[2]
  if (!group) throw new Error("Missing test group")

  const all = await list()
  check(all)
  const files = pick(all, group)
  if (files.length === 0) {
    console.log(`No tests in group: ${group}`)
    return
  }

  const dir = path.join(root, arg("--dir") ?? ".tmp/test-report")
  await fs.mkdir(dir, { recursive: true })
  await Bun.write(path.join(dir, ".keep"), "")

  const reruns = num("--rerun-on-fail")
  const runs = [] as Result[]
  runs.push(await run(group, files, dir, 1))
  for (let i = 0; i < reruns; i++) {
    if (runs[runs.length - 1]?.code === 0) break
    runs.push(await run(group, files, dir, i + 2))
  }

  await summary(group, runs)
  if (runs.some((run) => run.code !== 0)) process.exit(1)
}

await main()
