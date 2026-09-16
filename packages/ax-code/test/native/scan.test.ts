import fs from "node:fs/promises"
import path from "node:path"
import { describe, expect, test } from "vitest"
import { runNativeScan } from "../../src/native/scan"
import { NativeAddon } from "../../src/native/addon"
import { tmpdir } from "../fixture/fixture"

test("caller cancellation reaches native work and cannot publish its late result", async () => {
  const controller = new AbortController()
  let resolve!: (value: string) => void
  let cancelled = false
  const work = runNativeScan(
    () => ({
      cancel() {
        cancelled = true
      },
    }),
    () =>
      new Promise<string>((done) => {
        resolve = done
      }),
    controller.signal,
  )
  const rejected = expect(work).rejects.toThrow("stop scan")
  controller.abort(new Error("stop scan"))
  await rejected
  expect(cancelled).toBe(true)
  resolve("late result")
  await new Promise((done) => setImmediate(done))
})

// Explicit native qualification must not silently succeed using mocks or old binaries.
describe.runIf(process.env.AX_TEST_SCAN_NATIVE === "1")("native async scan qualification", () => {
  test("walk/search parity, cancellation and recovery using the rebuilt addon", async () => {
    const native = NativeAddon.fs()!
    expect(native?.searchContentAsync).toBeTypeOf("function")
    expect(native?.walkFilesAsync).toBeTypeOf("function")
    await using tmp = await tmpdir({ git: true })
    await fs.writeFile(path.join(tmp.path, "a.ts"), 'const needle = "one"\nneedle\n')
    await fs.writeFile(path.join(tmp.path, ".hidden"), "needle\n")
    await fs.writeFile(path.join(tmp.path, "binary"), "first\x00needle\n")
    for (const options of [{}, { hidden: false }, { limit: 1 }, { glob: ["*.ts"] }]) {
      const json = JSON.stringify(options)
      const actual = await native.walkFilesAsync(tmp.path, json, new native.ScanCancellation())
      expect(actual.sort()).toEqual(native.walkFiles(tmp.path, json).sort())
    }
    for (const options of [{ limit: 1 }, { limit: 100 }, { contextLines: 1 }, { glob: "*.ts" }]) {
      const json = JSON.stringify(options)
      expect(await native.searchContentAsync(tmp.path, "needle", json, new native.ScanCancellation())).toBe(
        native.searchContent(tmp.path, "needle", json),
      )
    }
    const cancellation = new native.ScanCancellation()
    cancellation.cancel()
    await expect(native.searchContentAsync(tmp.path, "needle", "{}", cancellation)).rejects.toThrow("cancelled")
    await expect(native.walkFilesAsync(tmp.path, "{}", cancellation)).rejects.toThrow("cancelled")
    await expect(native.searchContentAsync(tmp.path, "[", "{}", new native.ScanCancellation())).rejects.toThrow()
    expect(await native.searchContentAsync(tmp.path, "absent", "{}", new native.ScanCancellation())).toBe("[]")
  })
})
