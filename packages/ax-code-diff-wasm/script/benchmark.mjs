import assert from "node:assert/strict"
import { createRequire } from "node:module"
import { execFileSync } from "node:child_process"
import { readFile, stat } from "node:fs/promises"
import { gzipSync } from "node:zlib"
import os from "node:os"
import { createDuplicateComparator } from "../dist/node.js"
import { checkedText, decodePreview, encodeRows, decodeGroups } from "../src/protocol.ts"
import { compareDuplicateGroups } from "@ax-code/ax-code-reason/duplicate-groups"

const require = createRequire(import.meta.url)
const native = require("@ax-code/diff")
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const summary = (values) => {
  const sorted = [...values].sort((a, b) => a - b)
  return { p50: sorted[Math.ceil(sorted.length * 0.5) - 1], p95: sorted[Math.ceil(sorted.length * 0.95) - 1] }
}
const wasm = createDuplicateComparator()
const results = []
try {
  for (const count of [128, 512, 2000])
    for (const workload of ["distinct", "paired"]) {
      const rows = Array.from({ length: count }, (_, i) =>
        Array.from({ length: 8 }, (_, j) => `token-${workload === "paired" ? Math.floor(i / 2) : i}-${j}`),
      )
      const threshold = 0.8
      const expected = decodeGroups(
        await native.duplicateGroupsAsync(encodeRows(rows, threshold), threshold, new native.DiffCancellation()),
        count,
      )
      const modes = {
        jsFallback: () =>
          compareDuplicateGroups(
            rows.map((row) => new Set(row)),
            threshold,
          ),
        nativeWorker: async () =>
          decodeGroups(
            await native.duplicateGroupsAsync(encodeRows(rows, threshold), threshold, new native.DiffCancellation()),
            count,
          ),
        wasmWorker: () => wasm.compare(rows, threshold),
      }
      for (const run of Object.values(modes)) assert.deepEqual(await run(), expected)
      const samples = []
      for (let i = 0; i < 7; i++)
        for (const [mode, run] of Object.entries(modes)) {
          let last = performance.now(),
            gap = 0
          const timer = setInterval(() => {
            const now = performance.now()
            gap = Math.max(gap, now - last)
            last = now
          }, 1)
          await sleep(5)
          gap = 0
          last = performance.now()
          const rssBefore = process.memoryUsage().rss,
            start = performance.now()
          try {
            const result = await run(),
              elapsedMs = performance.now() - start
            await sleep(5)
            assert.deepEqual(result, expected)
            samples.push({ mode, elapsedMs, heartbeatGapMs: gap, rssBefore, rssAfter: process.memoryUsage().rss })
          } finally {
            clearInterval(timer)
          }
        }
      results.push({
        count,
        workload,
        parity: true,
        samples,
        summary: Object.fromEntries(
          Object.keys(modes).map((mode) => {
            const selected = samples.filter((row) => row.mode === mode)
            return [
              mode,
              {
                elapsedMs: summary(selected.map((row) => row.elapsedMs)),
                heartbeatGapMs: summary(selected.map((row) => row.heartbeatGapMs)),
              },
            ]
          }),
        ),
      })
    }
  for (const count of [1000, 10000]) {
    const before = Array.from({ length: count }, (_, i) => `line ${i}\r\n`).join("")
    const after = before.replace("line 5\r\n", "changed 😀\r\n").replace(`line ${count - 5}\r\n`, "changed tail\r\n")
    const expected = decodePreview(await native.diffPreviewAsync(before, after, false, new native.DiffCancellation()))
    const modes = {
      nativePreview: async () =>
        decodePreview(
          await native.diffPreviewAsync(checkedText(before), checkedText(after), false, new native.DiffCancellation()),
        ),
      wasmPreview: () => wasm.diff(before, after),
      wasmApplyHunks: () => wasm.applyHunks(before, expected.hunks),
    }
    const summaryByMode = {}
    for (const [mode, run] of Object.entries(modes)) {
      assert.deepEqual(await run(), mode === "wasmApplyHunks" ? after : expected)
      const times = []
      for (let i = 0; i < 7; i++) {
        const start = performance.now()
        const result = await run()
        times.push(performance.now() - start)
        assert.deepEqual(result, mode === "wasmApplyHunks" ? after : expected)
      }
      summaryByMode[mode] = summary(times)
    }
    results.push({ count, workload: "two-separated-edits-CRLF", parity: true, elapsedMs: summaryByMode })
  }
} finally {
  await wasm.close()
}

const cold = []
const moduleUrl = new URL("../dist/node.js", import.meta.url).href
for (let i = 0; i < 5; i++) {
  const start = performance.now()
  const output = execFileSync(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      `
    const start = performance.now();
    const {createDuplicateComparator} = await import(${JSON.stringify(moduleUrl)});
    const comparator = createDuplicateComparator();
    await comparator.compare([['a'],['a']], 1);
    console.log(performance.now()-start);
    await comparator.close();
  `,
    ],
    { encoding: "utf8" },
  )
  cold.push({ firstUseIncludingImportMs: Number(output.trim()), processIncludingShutdownMs: performance.now() - start })
}
const bytes = await readFile(new URL("../wasm/ax_code_diff_wasm_bg.wasm", import.meta.url))
const module = await WebAssembly.compile(bytes)
const binding = await import(new URL("../wasm/ax_code_diff_wasm.js", import.meta.url).href)
const instance = await binding.default({ module_or_path: bytes })
const memory = []
const repeated = JSON.stringify(Array.from({ length: 2000 }, (_, i) => [`t${i}`, `t${i + 1}`]))
for (let i = 0; i < 30; i++) {
  binding.duplicate_groups(repeated, 0.8)
  memory.push(instance.memory.buffer.byteLength)
}
console.log(
  JSON.stringify(
    {
      runtime: process.version,
      platform: process.platform,
      arch: process.arch,
      cpu: os.cpus()[0]?.model,
      head: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
      uncommittedImplementation: Boolean(execFileSync("git", ["status", "--porcelain"], { encoding: "utf8" }).trim()),
      notes:
        "Synthetic inputs; 7 warm samples per case after one warmup, modes interleaved. JS is current reason fallback; native includes the same admission/result validation as the Wasm adapter. Native/JS production dispatch policy is not benchmarked. RSS is whole-process including workers; not per-backend peak. Cold Wasm uses 5 fresh Node processes. No full tool/user latency or cross-platform speedup claim. Linear memory probe is a separate inline instance, not worker peak memory.",
      results,
      coldWasm: cold,
      artifact: {
        wasmBytes: bytes.length,
        wasmGzipBytes: gzipSync(bytes).length,
        nativeAddonBytes: (await stat(new URL("../../ax-code-diff-native/ax-code-diff.node", import.meta.url))).size,
        comparisonNote:
          "Native addon contains all diff kernels; Wasm contains duplicate, preview, patch and hunk kernels; native also includes edit matching. Sizes are not equivalent feature sets.",
      },
      wasmImports: WebAssembly.Module.imports(module),
      repeatedInlineLinearMemoryBytes: memory,
    },
    null,
    2,
  ),
)
