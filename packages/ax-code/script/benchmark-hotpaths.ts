/** Local, isolated hot-path benchmark. Run with tsx --tsconfig packages/ax-code/tsconfig.json. */
import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { mkdtemp, readFile, rm } from "node:fs/promises"
import { createRequire } from "node:module"
import os from "node:os"
import path from "node:path"
import { execFileSync } from "node:child_process"

const state = await mkdtemp(path.join(os.tmpdir(), "ax-hotpaths-"))
for (const key of Object.keys(process.env)) {
  if (key.startsWith("AX_CODE_") || key.startsWith("OPENCODE_")) delete process.env[key]
}
process.env.AX_CODE_TEST_HOME = state
process.env.AX_CODE_DISABLE_PROJECT_CONFIG = "true"
process.env.XDG_CONFIG_HOME = path.join(state, "config")
process.env.XDG_DATA_HOME = path.join(state, "data")
process.env.XDG_STATE_HOME = path.join(state, "state")
process.env.XDG_CACHE_HOME = path.join(state, "cache")
process.env.AX_CODE_NATIVE_INDEX = "1"
process.env.AX_CODE_NATIVE_DIFF = "1"
process.env.AX_CODE_PROFILE_NATIVE = "1"
const { NativeAddon } = await import("../src/native/addon")
const { NativeStore } = await import("../src/code-intelligence/native-store")
const { NativePerf } = await import("../src/perf/native")
const { diffPreview, diffPreviewSync } = await import("../src/tool/diff-preview")
const { CodeNodeID } = await import("../src/code-intelligence/id")
const { ProjectID } = await import("../src/project/schema")
const index = NativeAddon.index()
assert(index?.walkCallGraphAsync && index.IndexCancellation, "Rebuild index-core before benchmarking")
assert(NativeAddon.diff()?.diffPreviewAsync, "Build the diff addon before benchmarking")
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))
const samples = 7
function summary(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b)
  return {
    p50: sorted[Math.ceil(sorted.length * 0.5) - 1],
    p95: sorted[Math.ceil(sorted.length * 0.95) - 1],
    max: sorted.at(-1),
  }
}
async function measure<T>(fn: () => T | Promise<T>) {
  let last = performance.now(),
    gap = 0
  const timer = setInterval(() => {
    const now = performance.now()
    gap = Math.max(gap, now - last)
    last = now
  }, 1)
  try {
    await sleep(5)
    gap = 0
    last = performance.now()
    const rssBefore = process.memoryUsage().rss
    const start = performance.now()
    const value = await fn()
    const elapsedMs = performance.now() - start
    await sleep(5)
    return { value, elapsedMs, maxHeartbeatGapMs: gap, rssBefore, rssAfter: process.memoryUsage().rss }
  } finally {
    clearInterval(timer)
  }
}
const results: unknown[] = []
try {
  for (const count of [600, 6000]) {
    const project = ProjectID.make(`bench-${count}`)
    const file = path.join(state, "fixture.ts")
    const nodes = Array.from({ length: count }, (_, i) => ({
      id: `n${i}`,
      project_id: project,
      kind: "function",
      name: `fn${i}`,
      qualified_name: `fn${i}`,
      file,
      range_start_line: i,
      range_start_char: 0,
      range_end_line: i,
      range_end_char: 1,
    }))
    const meta = {
      id: `file-${count}`,
      project_id: project,
      path: file,
      sha: "fixture",
      size: count,
      lang: "typescript",
      completeness: "full",
    }
    await NativeStore.ingestFileAsync(project, file, nodes, [], meta)
    for (let start = 0; start < count; start += 200) {
      const edges = []
      for (let i = start; i < Math.min(count, start + 200); i++)
        for (let j = 1; j <= 40; j++) {
          edges.push({
            id: `e${i}-${j}`,
            project_id: project,
            kind: "calls",
            from_node: `n${(i * 7 + j) % count}`,
            to_node: `n${i}`,
            file,
            range_start_line: i,
            range_start_char: 0,
            range_end_line: i,
            range_end_char: 1,
          })
        }
      NativeStore.insertEdges(edges)
    }
    NativeStore.analyze()
    const options = { seeds: [CodeNodeID.make("n0")], callers: true, depth: 6, budget: 10000 }
    const sync = () => NativeStore.walkCallGraph(project, options)
    const worker = () => NativeStore.walkCallGraphAsync(project, options)
    const baseline = sync()
    assert(baseline)
    const cold = await measure(worker)
    assert.deepEqual(cold.value, baseline)
    NativePerf.reset()
    const rows: Array<{
      mode: string
      elapsedMs: number
      maxHeartbeatGapMs: number
      rssBefore: number
      rssAfter: number
    }> = []
    for (let sample = 0; sample < samples; sample++)
      for (const [mode, fn] of [
        ["sync", sync],
        ["worker", worker],
      ] as const) {
        const { value, ...timing } = await measure(fn)
        assert.deepEqual(value, baseline)
        rows.push({ mode, ...timing })
      }
    results.push({
      case: "graph",
      nodes: count,
      edges: count * 40,
      visited: baseline.nodes.length,
      parity: true,
      firstWorkerMs: cold.elapsedMs, // Warm filesystem/setup; not an OS cold-cache claim.
      summary: Object.fromEntries(
        ["sync", "worker"].map((mode) => {
          const selected = rows.filter((r) => r.mode === mode)
          return [
            mode,
            {
              elapsedMs: summary(selected.map((r) => r.elapsedMs)),
              heartbeatMs: summary(selected.map((r) => r.maxHeartbeatGapMs)),
            },
          ]
        }),
      ),
      rows,
      profile: NativePerf.snapshot().operations,
    })
    NativeStore.clearProject(project)
  }
  NativePerf.reset()
  const project = ProjectID.make("ingest-bench"),
    file = path.join(state, "ingest.ts")
  const nodes = Array.from({ length: 2000 }, (_, i) => ({
    id: `i${i}`,
    project_id: project,
    kind: "function",
    name: `fn${i}`,
    qualified_name: `fn${i}`,
    file,
    range_start_line: i,
    range_start_char: 0,
    range_end_line: i,
    range_end_char: 1,
  }))
  const meta = {
    id: "ingest-file",
    project_id: project,
    path: file,
    sha: "fixture",
    size: 2000,
    lang: "typescript",
    completeness: "full",
  }
  const ingestRows = []
  for (let i = 0; i < samples + 1; i++) {
    const { value, ...timing } = await measure(() => NativeStore.ingestFileAsync(project, file, nodes, [], meta))
    assert.equal(NativeStore.nodesInFile(project, file).length, nodes.length)
    if (i > 0) ingestRows.push(timing)
  }
  results.push({
    case: "ingest",
    rows: ingestRows,
    elapsedMs: summary(ingestRows.map((r) => r.elapsedMs)),
    profile: NativePerf.snapshot().operations,
  })
  const before = Array.from({ length: 12000 }, (_, i) => `const value${i} = ${i}\n`).join("")
  const after = before.replace("const value6000 = 6000", "const value6000 = 9999")
  const expected = diffPreviewSync("fixture.ts", before, after)
  await diffPreview("fixture.ts", before, after)
  NativePerf.reset()
  const diffRows = []
  for (let i = 0; i < samples; i++) {
    const { value, ...timing } = await measure(() => diffPreview("fixture.ts", before, after))
    assert.deepEqual(value, expected)
    diffRows.push(timing)
  }
  results.push({
    case: "diff",
    parity: true,
    rows: diffRows,
    elapsedMs: summary(diffRows.map((r) => r.elapsedMs)),
    profile: NativePerf.snapshot().operations,
  })
  const req = createRequire(import.meta.url)
  const binaries = await Promise.all(
    Object.keys(req.cache)
      .filter((p) => p.endsWith(".node"))
      .map(async (file) => ({
        file,
        sha256: createHash("sha256")
          .update(await readFile(file))
          .digest("hex"),
      })),
  )
  console.log(
    JSON.stringify(
      {
        runtime: process.version,
        platform: process.platform,
        arch: process.arch,
        head: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
        samples,
        binaries,
        peakRssKiB: process.resourceUsage().maxRSS,
        notes:
          "Local synthetic workloads, sequential samples, parity asserted. Phase native is roundtrip, including libuv scheduling and marshalling, not Rust CPU. Heartbeat is a 1ms timer gap. RSS includes fixture setup and the entire process; it is not a per-operation peak. First worker sample is not OS cold cache. Total is wall time and nested phases must not be summed with legacy bridge rows.",
        results,
      },
      null,
      2,
    ),
  )
} finally {
  await NativeStore.close()
  await rm(state, { recursive: true, force: true })
}
