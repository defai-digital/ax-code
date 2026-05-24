import { expect, test } from "bun:test"
import path from "path"

test("JDTLS cleanup is attached via process exit promise", async () => {
  const src = await Bun.file(path.join(import.meta.dir, "../../src/lsp/server-defs.ts")).text()

  expect(src).toMatch(/spawnJdtls[\s\S]*?cleanupStaleJdtlsDataDirs\(\)/)
  expect(src).toMatch(/spawnJdtls[\s\S]*?void proc\.exited\.finally/)
  expect(src).not.toMatch(/spawnJdtls[\s\S]*?proc\.once\(\"exit\"/)
})

test("JDTLS startup prunes stale temp data directories", async () => {
  const src = await Bun.file(path.join(import.meta.dir, "../../src/lsp/server-defs.ts")).text()

  expect(src).toContain('const JDTLS_DATA_DIR_PREFIX = "ax-code-jdtls-data"')
  expect(src).toContain("const JDTLS_STALE_DATA_DIR_MS = 24 * 60 * 60 * 1000")
  expect(src).toContain("async function cleanupStaleJdtlsDataDirs()")
  expect(src).toContain("entry.startsWith(JDTLS_DATA_DIR_PREFIX)")
  expect(src).toContain("stat.mtimeMs >= cutoff")
  expect(src).toMatch(/fs\s*\.\s*rm\(full, \{ recursive: true, force: true \}\)/)
})

test("JDTLS stderr logging is attached during process launch", async () => {
  const src = await Bun.file(path.join(import.meta.dir, "../../src/lsp/server-defs.ts")).text()

  expect(src).toMatch(/spawnJdtls[\s\S]*?onStderr: \(chunk: Buffer \| string\) =>/)
  expect(src).not.toMatch(/spawnJdtls[\s\S]*?proc\.stderr\.on\(\"data\"/)
})

test("Oxlint LSP detection caches --lsp support check", async () => {
  const src = await Bun.file(path.join(import.meta.dir, "../../src/lsp/server-defs.ts")).text()

  expect(src).toContain("oxlintLspSupportCache")
  expect(src).toContain("setOxlintSupportCache")
  expect(src).toContain("OXLINT_LSP_SUPPORT_CACHE_MAX")
  expect(src).toContain("oxlintSupportsLsp")
  expect(src).toContain("const pending = Promise.resolve().then(() => checkOxlintSupportsLsp(lintBin))")
  expect(src).toContain("setOxlintSupportCache(lintBin, pending)")
  expect(src).toContain('spawn(lintBin, ["--help"])')
  expect(src).not.toContain('spawn(lintBin, ["--help"],')
})

test("Oxlint LSP detection retries after transient --help failures", async () => {
  const src = await Bun.file(path.join(import.meta.dir, "../../src/lsp/server-defs.ts")).text()

  expect(src).toContain('log.warn("oxlint --help check failed"')
  expect(src).toContain("oxlintLspSupportCache.delete(lintBin)")
  expect(src).not.toContain("setOxlintSupportCache(lintBin, false)")
})
