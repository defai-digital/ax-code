import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import {
  benchmarkChild,
  benchmarkOptions,
  benchmarkProvenance,
  distribution,
  writeBenchmarkReport,
} from "./benchmark-support.js"
import { defaultExperimentDirectory, tuiRoot } from "./build-text-width-experiment.js"
import {
  encodeTextWidthBatch,
  loadTextWidthKernel,
  verifyTextWidthExperiment,
  widthMethods,
  type TextWidthKernel,
} from "./text-width-kernel.js"
import { textWidthCorpora, textWidthGolden } from "../test/fixtures/text-width.js"

export async function textWidthBenchmarkSample(
  backend: TextWidthKernel["backend"],
  directory: string,
  iterations: number,
  warmup: number,
) {
  const coldStart = performance.now()
  const memoryBefore = process.memoryUsage()
  const kernel = await loadTextWidthKernel(backend, directory)
  const loadAndVerifyMs = performance.now() - coldStart
  try {
    for (const [index, method] of widthMethods.entries()) {
      assert.deepEqual(
        [
          ...kernel.measure(
            textWidthGolden.map((row) => row.text),
            method,
          ),
        ],
        textWidthGolden.map((row) => row.widths[index]),
        `Golden width mismatch: ${backend}/${method}`,
      )
    }
    const results = []
    for (const { name, texts } of textWidthCorpora()) {
      const batch = encodeTextWidthBatch(texts)
      const expected = kernel.measure(texts)
      const checksum = createHash("sha256").update(expected).digest("hex")
      const modes = []
      for (const mode of ["resident-kernel", "encode-copy-run-read"] as const) {
        kernel.write(batch)
        const operation =
          mode === "resident-kernel"
            ? () => {
                kernel.run()
              }
            : () => {
                kernel.measure(texts)
              }
        for (let warm = 0; warm < warmup; warm++) operation()
        // Time several calls per observation to reduce timer noise for tiny batches.
        // Both arms retain validation and result ownership costs in the full mode.
        const operationsPerSample = 20
        const samplesMs = []
        for (let sample = 0; sample < iterations; sample++) {
          const start = performance.now()
          for (let operationIndex = 0; operationIndex < operationsPerSample; operationIndex++) operation()
          samplesMs.push((performance.now() - start) / operationsPerSample)
        }
        assert.deepEqual(kernel.read(), expected, "Final measured kernel result changed")
        modes.push({ mode, operationsPerSample, samplesMs, msPerBatch: distribution(samplesMs) })
      }
      results.push({ workload: name, items: texts.length, utf8Bytes: batch.bytes.length, checksum, modes })
    }
    return {
      backend,
      node: process.version,
      ffiEnabled: process.execArgv.includes("--experimental-ffi"),
      iterations,
      warmup,
      loadAndVerifyMs,
      wasmMemoryBytes: kernel.memoryBytes,
      memoryBefore,
      memoryAfter: process.memoryUsage(),
      results,
    }
  } finally {
    kernel.close()
  }
}

type Sample = Awaited<ReturnType<typeof textWidthBenchmarkSample>>

async function main() {
  const options = benchmarkOptions(
    process.argv.slice(2),
    {
      output: join(tuiRoot, ".internal/benchmarks/text-width.json"),
      iterations: 40,
      warmup: 100,
    },
    "kernel",
  )
  assert.ok(!options.profile, "Use application benchmark --profile for CPU diagnostics")
  const directory = options.directory || defaultExperimentDirectory
  if (options.child) {
    console.log(
      JSON.stringify(
        await textWidthBenchmarkSample(
          options.backend as TextWidthKernel["backend"],
          directory,
          options.iterations,
          options.warmup,
        ),
      ),
    )
    return
  }
  const { manifest } = verifyTextWidthExperiment(directory)
  const pairs: { pair: number; order: readonly string[]; runs: Sample[] }[] = []
  for (let pair = 0; pair < options.samples; pair++) {
    const order = pair % 2 ? (["wasm", "native"] as const) : (["native", "wasm"] as const)
    const runs: Sample[] = []
    for (const backend of order) {
      runs.push(
        benchmarkChild<Sample>(
          fileURLToPath(import.meta.url),
          [
            `--backend=${backend}`,
            `--directory=${directory}`,
            `--iterations=${options.iterations}`,
            `--warmup=${options.warmup}`,
          ],
          backend === "native",
        ),
      )
    }
    assert.deepEqual(
      runs[0].results.map((row) => [row.workload, row.checksum]),
      runs[1].results.map((row) => [row.workload, row.checksum]),
      "Native/WASM output mismatch",
    )
    pairs.push({ pair, order, runs })
    process.stderr.write(`Completed native/WASM pair ${pair + 1}/${options.samples}\n`)
  }
  const summaries = textWidthCorpora().flatMap(({ name }) =>
    ["resident-kernel", "encode-copy-run-read"].map((mode) => {
      const medians = (backend: string) =>
        pairs.map(
          (pair) =>
            pair.runs
              .find((run) => run.backend === backend)!
              .results.find((row) => row.workload === name)!
              .modes.find((row) => row.mode === mode)!.msPerBatch.median,
        )
      const native = medians("native")
      const wasm = medians("wasm")
      const nativeMedianMs = distribution(native).median
      const wasmMedianMs = distribution(wasm).median
      assert.ok(nativeMedianMs > 0 && wasmMedianMs > 0)
      return {
        workload: name,
        mode,
        nativeMedianMs,
        wasmMedianMs,
        wasmOverNative: wasmMedianMs / nativeMedianMs,
        pairedRatios: native.map((value, index) => wasm[index] / value),
      }
    }),
  )
  const report = {
    schemaVersion: 1,
    kind: "ax-tui-text-width-experiment",
    ...benchmarkProvenance([
      "script/benchmark-text-width.ts",
      "script/benchmark-support.ts",
      "script/text-width-kernel.ts",
      "script/build-text-width-experiment.ts",
      "test/fixtures/text-width.ts",
    ]),
    build: manifest,
    options,
    pairs,
    summaries,
    limits: [
      "Width kernel only, not a WASM renderer or full application comparison",
      "Single host and runtime; no statistical significance claim",
      "resident-kernel excludes encoding/copies/result reads; full mode includes them",
      "loadAndVerifyMs includes source/artifact hashing, module loading and instantiation; it is not isolated compiler time",
      "Memory samples include process caches; WASM linear memory is separately reported",
      "All timings use the same bounded ABI and production Unicode implementation; no production backend is enabled",
    ],
  }
  writeBenchmarkReport(options.output, report)
  console.log(JSON.stringify({ output: options.output, summaries }, null, 2))
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main()
