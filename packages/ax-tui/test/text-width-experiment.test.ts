import { spawnSync } from "node:child_process"
import { existsSync, cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { expect, test } from "vitest"
import { defaultExperimentDirectory } from "../script/build-text-width-experiment.js"
import { verifyTextWidthExperiment } from "../script/text-width-kernel.js"

const built = existsSync(join(defaultExperimentDirectory, "manifest.json"))

test("required text width qualification has compiled artifacts", () => {
  if (process.env.AX_CODE_TUI_REQUIRE_TEXT_WIDTH_EXPERIMENT === "1") expect(built).toBe(true)
})

test.skipIf(!built)("native and WASM share Unicode results, reject invalid batches, and own returned data", () => {
  const child = spawnSync(
    process.execPath,
    [
      "--experimental-ffi",
      "--disable-warning=ExperimentalWarning",
      "--import",
      "tsx",
      fileURLToPath(new URL("fixtures/text-width-driver.ts", import.meta.url)),
    ],
    {
      encoding: "utf8",
      timeout: 30_000,
    },
  )
  expect(child.error, child.stderr).toBeUndefined()
  expect(child.status, child.stdout + child.stderr).toBe(0)
  expect(JSON.parse(child.stdout).status).toBe("AX_TEXT_WIDTH_PARITY_COMPLETE")
})

test.skipIf(!built)("WASM width evaluation runs without native FFI enabled", () => {
  const script = new URL("../script/text-width-kernel.ts", import.meta.url).href
  const child = spawnSync(
    process.execPath,
    [
      "--import",
      "tsx",
      "--input-type=module",
      "-e",
      `
    import assert from "node:assert/strict"
    import { loadTextWidthKernel } from ${JSON.stringify(script)}
    assert.ok(!process.execArgv.includes("--experimental-ffi"))
    const kernel = await loadTextWidthKernel("wasm")
    try { assert.deepEqual([...kernel.measure(["中文", "👩‍🚀"])], [4, 2]) }
    finally { kernel.close() }
    console.log("AX_WASM_WITHOUT_FFI_COMPLETE")
  `,
    ],
    { encoding: "utf8", timeout: 15_000, env: { ...process.env, NODE_OPTIONS: "" } },
  )
  expect(child.status, child.stdout + child.stderr).toBe(0)
  expect(child.stdout).toContain("AX_WASM_WITHOUT_FFI_COMPLETE")
  expect(child.stderr).not.toContain("FFI is an experimental")
})

test.skipIf(!built)("experiment verification rejects stale source and corrupted artifacts", () => {
  const directory = mkdtempSync(join(tmpdir(), "ax-tui-width-provenance-"))
  try {
    const { manifest } = verifyTextWidthExperiment()
    cpSync(join(defaultExperimentDirectory, "manifest.json"), join(directory, "manifest.json"))
    for (const file of Object.keys(manifest.artifacts)) {
      cpSync(join(defaultExperimentDirectory, file), join(directory, file), { recursive: true })
    }
    verifyTextWidthExperiment(directory)
    const wasm = join(directory, "bin/ax-tui-text-width.wasm")
    const bytes = readFileSync(wasm)
    bytes[bytes.length - 1] ^= 1
    writeFileSync(wasm, bytes)
    expect(() => verifyTextWidthExperiment(directory)).toThrow("Artifact hash mismatch")
    writeFileSync(join(directory, "manifest.json"), JSON.stringify({ ...manifest, nativeSourceSha256: "stale" }))
    expect(() => verifyTextWidthExperiment(directory)).toThrow("stale")
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})

test.skipIf(!built)("paired width benchmark alternates fresh processes and records matching results", () => {
  const directory = mkdtempSync(join(tmpdir(), "ax-tui-width-report-"))
  try {
    const output = join(directory, "width.json")
    const child = spawnSync(
      process.execPath,
      [
        "--import",
        "tsx",
        fileURLToPath(new URL("../script/benchmark-text-width.ts", import.meta.url)),
        `--output=${output}`,
        "--samples=2",
        "--iterations=1",
        "--warmup=1",
      ],
      {
        encoding: "utf8",
        timeout: 30_000,
        maxBuffer: 2 * 1024 * 1024,
      },
    )
    expect(child.error, child.stderr).toBeUndefined()
    expect(child.status, child.stdout + child.stderr).toBe(0)
    const report = JSON.parse(readFileSync(output, "utf8"))
    expect(report.pairs.map((pair: { order: string[] }) => pair.order)).toEqual([
      ["native", "wasm"],
      ["wasm", "native"],
    ])
    expect(report.summaries.length).toBe(10)
    for (const pair of report.pairs) {
      expect(pair.runs[0].results.map((row: { checksum: string }) => row.checksum)).toEqual(
        pair.runs[1].results.map((row: { checksum: string }) => row.checksum),
      )
      for (const run of pair.runs) expect(run.ffiEnabled).toBe(run.backend === "native")
    }
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})
