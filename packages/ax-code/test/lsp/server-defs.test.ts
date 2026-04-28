import { expect, test } from "bun:test"
import path from "path"

test("JDTLS cleanup is attached via process exit promise", async () => {
  const src = await Bun.file(path.join(import.meta.dir, "../../src/lsp/server-defs.ts")).text()

  expect(src).toMatch(/spawnJdtls[\s\S]*?void proc\.exited\.finally/)
  expect(src).not.toMatch(/spawnJdtls[\s\S]*?proc\.once\(\"exit\"/)
})

test("Oxlint LSP detection caches --lsp support check", async () => {
  const src = await Bun.file(path.join(import.meta.dir, "../../src/lsp/server-defs.ts")).text()

  expect(src).toContain("oxlintLspSupportCache")
  expect(src).toContain("oxlintSupportsLsp")
  expect(src).toContain('spawn(lintBin, ["--help"])')
  expect(src).not.toContain('spawn(lintBin, ["--help"],')
})
