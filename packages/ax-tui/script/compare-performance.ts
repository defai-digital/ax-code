import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { createHash } from "node:crypto"
import { readFileSync, writeFileSync } from "node:fs"
import { cpus, release } from "node:os"
import { resolve } from "node:path"
import { fileURLToPath } from "node:url"

const root = fileURLToPath(new URL("../", import.meta.url))
interface Sample {
  packageName: string
  version: string
  node: string
  results: {
    workload: string
    msPerOperation: number
    iterations: number
    frames: number
  }[]
}
const median = (values: number[]) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)]
const sha256 = (file: string) => createHash("sha256").update(readFileSync(file)).digest("hex")

// Reference root must be an isolated npm installation containing an exact
// @opentui/core dependency. Nothing here installs or modifies either package.
export function comparePerformance(reference: string, output: string) {
  reference = resolve(reference)
  const installed = JSON.parse(readFileSync(resolve(reference, "node_modules/@opentui/core/package.json"), "utf8"))
  const manifest = JSON.parse(readFileSync(resolve(reference, "package.json"), "utf8"))
  assert.equal(manifest.dependencies?.["@opentui/core"], installed.version, "Reference version must be pinned exactly")
  const runs: { pair: number, order: string[], samples: Sample[] }[] = []
  const candidates = [{ directory: root, name: "@defai-digital/ax-tui" }, { directory: reference, name: "@opentui/core" }]
  const env = Object.fromEntries(Object.entries(process.env).filter(([key, value]) => value !== undefined &&
    !/^(AX_CODE_TUI_|OPENTUI_|OTUI_|TERM|COLORTERM|SSH_|TMUX|STY|NO_COLOR|FORCE_COLOR|NODE_OPTIONS)/.test(key)))
  Object.assign(env, { TERM: "xterm-256color", COLORTERM: "truecolor", AX_CODE_TUI_NATIVE_OFFLINE: "1" })
  for (let pair = 0; pair < 7; pair++) {
    const order = pair % 2 ? [...candidates].reverse() : candidates
    const samples: Sample[] = []
    for (const candidate of order) {
      const child = spawnSync(process.execPath, ["--experimental-ffi", "--disable-warning=ExperimentalWarning",
        "--experimental-import-meta-resolve",
        fileURLToPath(new URL("benchmark-runtime.ts", import.meta.url)), candidate.directory, candidate.name], {
        cwd: root, encoding: "utf8", timeout: 60000, maxBuffer: 4 * 1024 * 1024,
        env,
      })
      assert.ifError(child.error)
      assert.equal(child.status, 0, `${candidate.name}: ${child.stdout}\n${child.stderr}`)
      const sample = JSON.parse(child.stdout) as Sample
      assert.equal(sample.packageName, candidate.name)
      assert.equal(sample.node, process.version)
      if (candidate.name === "@opentui/core") assert.equal(sample.version, installed.version)
      samples.push(sample)
    }
    runs.push({ pair, order: order.map(candidate => candidate.name), samples })
    process.stderr.write(`Completed benchmark pair ${pair + 1}/7\n`)
  }
  const workloads = runs[0].samples[0].results.map(result => result.workload)
  const summaries = workloads.map(workload => {
    const values = candidates.map(candidate => runs.map(run => {
      const sample = run.samples.find(sample => sample.packageName === candidate.name)!
      const result = sample.results.find(row => row.workload === workload)!
      assert.ok(Number.isFinite(result.msPerOperation) && result.msPerOperation > 0)
      return result.msPerOperation
    }))
    const axMedianMs = median(values[0])
    const referenceMedianMs = median(values[1])
    return { workload, axSamplesMs: values[0], referenceSamplesMs: values[1], axMedianMs, referenceMedianMs,
      axOverReference: axMedianMs / referenceMedianMs,
      pairedRatios: values[0].map((value, index) => value / values[1][index]) }
  })
  const head = spawnSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" })
  const diff = spawnSync("git", ["diff", "--binary", "HEAD"], {
    cwd: root, encoding: "utf8", maxBuffer: 64 * 1024 * 1024,
  })
  assert.equal(head.status, 0)
  assert.equal(diff.status, 0)
  const report = { schemaVersion: 1, capturedAt: new Date().toISOString(), node: process.version,
    platform: process.platform, arch: process.arch, osRelease: release(), cpu: cpus()[0]?.model,
    axHead: head.stdout.trim(), axTrackedDiffSha256: createHash("sha256").update(diff.stdout).digest("hex"),
    harnessSha256: sha256(fileURLToPath(new URL("benchmark-runtime.ts", import.meta.url))),
    runnerSha256: sha256(fileURLToPath(import.meta.url)),
    axNativeManifestSha256: sha256(resolve(root, "vendor/manifest.json")),
    referenceVersion: installed.version, referenceLockSha256: sha256(resolve(reference, "package-lock.json")),
    geometry: [120, 40], pairs: 7, terminalEnvironment: { TERM: env.TERM, COLORTERM: env.COLORTERM }, summaries, runs,
    limits: ["Single host and Node runtime",
      "In-memory renderer; excludes terminal transport, startup and image decoding",
      "No whole-application FPS claim",
      "Median ratios describe these workloads only; no statistical significance claim"] }
  writeFileSync(output, JSON.stringify(report, null, 2) + "\n")
  return report
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  assert.ok(process.argv[2] && process.argv[3],
    "Usage: node script/compare-performance.ts <isolated-reference-root> <output.json>")
  const report = comparePerformance(process.argv[2], process.argv[3])
  console.log(JSON.stringify(report.summaries, null, 2))
}
