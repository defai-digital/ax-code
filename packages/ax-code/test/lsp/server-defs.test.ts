import { expect, test } from "vitest"
import path from "path"
import { LSPServer } from "../../src/lsp/server"

test("JDTLS cleanup is attached via process exit promise", async () => {
  const src = await Bun.file(path.join(import.meta.dirname, "../../src/lsp/server-defs.ts")).text()

  expect(src).toMatch(/spawnJdtls[\s\S]*?JdtlsDataDir\.cleanupStale\(\)/)
  expect(src).toMatch(/spawnJdtls[\s\S]*?JdtlsDataDir\.create\(\)/)
  expect(src).toMatch(/spawnJdtls[\s\S]*?JdtlsDataDir\.remove\(dataDir\)/)
  expect(src).toMatch(/spawnJdtls[\s\S]*?void proc\.exited[\s\S]*?\.finally/)
  expect(src).toMatch(/spawnJdtls[\s\S]*?\.catch\(\(err\) => \{[\s\S]*?jdtls process exited with error/)
  expect(src).not.toMatch(/spawnJdtls[\s\S]*?proc\.once\(\"exit\"/)
})

test("JDTLS startup prunes stale temp data directories", async () => {
  const src = await Bun.file(path.join(import.meta.dirname, "../../src/lsp/jdtls-data-dir.ts")).text()

  expect(src).toContain('const DATA_DIR_PREFIX = "ax-code-jdtls-data"')
  expect(src).toContain("const STALE_DATA_DIR_MS = 24 * 60 * 60 * 1000")
  expect(src).toContain("export async function cleanupStale()")
  expect(src).toContain("fs.mkdtemp(path.join(os.tmpdir(), DATA_DIR_PREFIX))")
  expect(src).toContain("entry.startsWith(DATA_DIR_PREFIX)")
  expect(src).toContain("stat.mtimeMs >= cutoff")
  expect(src).toContain("await remove(full)")
  expect(src).toMatch(/fs\s*\.\s*rm\(dataDir, \{ recursive: true, force: true \}\)/)
})

test("JDTLS stderr logging is attached during process launch", async () => {
  const src = await Bun.file(path.join(import.meta.dirname, "../../src/lsp/server-defs.ts")).text()

  expect(src).toMatch(/spawnJdtls[\s\S]*?onStderr: \(chunk: Buffer \| string\) =>/)
  expect(src).not.toMatch(/spawnJdtls[\s\S]*?proc\.stderr\.on\(\"data\"/)
})

test("Oxlint LSP detection caches --lsp support check", async () => {
  const defs = await Bun.file(path.join(import.meta.dirname, "../../src/lsp/server-defs.ts")).text()
  const src = await Bun.file(path.join(import.meta.dirname, "../../src/lsp/oxlint.ts")).text()

  expect(defs).toContain("OxlintSupport.supportsLsp(lintBin)")
  expect(src).toContain("lspSupportCache")
  expect(src).toContain("setSupportCache")
  expect(src).toContain("LSP_SUPPORT_CACHE_MAX")
  expect(src).toContain("supportsLsp")
  expect(src).toContain("const pending = Promise.resolve().then(() => checkSupportsLsp(lintBin))")
  expect(src).toContain("setSupportCache(lintBin, pending)")
  expect(src).toContain('spawn(lintBin, ["--help"], { timeout: 5_000 })')
})

test("Oxlint LSP detection retries after transient --help failures", async () => {
  const src = await Bun.file(path.join(import.meta.dirname, "../../src/lsp/oxlint.ts")).text()

  expect(src).toContain('log.warn("oxlint --help check failed"')
  expect(src).toContain("lspSupportCache.delete(lintBin)")
  expect(src).not.toContain("setSupportCache(lintBin, false)")
})

test("ZLS managed install uses the shared verified GitHub release installer", async () => {
  const src = await Bun.file(path.join(import.meta.dirname, "../../src/lsp/server-defs.ts")).text()

  expect(src).toMatch(/export const Zls[\s\S]*?installPinnedGitHubReleaseAsset\(\{[\s\S]*?id: "zls"/)
  expect(src).toMatch(/export const Zls[\s\S]*?repo: "zigtools\/zls"/)
  expect(src).not.toMatch(/export const Zls[\s\S]*?fetchGitHubReleaseByTag/)
  expect(src).not.toMatch(/export const Zls[\s\S]*?releaseAsset\(release\.assets/)
})

test("JavaScript-family server extensions stay aligned", () => {
  const runtime = [".ts", ".tsx", ".js", ".jsx", ".mjs"]
  const project = [...runtime, ".cjs", ".mts", ".cts"]
  const frameworks = [...project, ".vue", ".astro", ".svelte"]

  expect(LSPServer.Deno.extensions).toEqual(runtime)
  expect(LSPServer.Typescript.extensions).toEqual(project)
  expect(LSPServer.ESLint.extensions).toEqual([...project, ".vue"])
  expect(LSPServer.Oxlint.extensions).toEqual(frameworks)
  expect(LSPServer.Biome.extensions).toEqual([
    ...project,
    ".json",
    ".jsonc",
    ".vue",
    ".astro",
    ".svelte",
    ".css",
    ".graphql",
    ".gql",
    ".html",
  ])
})

test("Python server extensions stay aligned while ty keeps its extra root marker", async () => {
  const src = await Bun.file(path.join(import.meta.dirname, "../../src/lsp/server-defs.ts")).text()

  expect(LSPServer.Ty.extensions).toEqual([".py", ".pyi"])
  expect(LSPServer.Pyright.extensions).toEqual([".py", ".pyi"])
  expect(src).toContain("const PYTHON_ROOT_MARKERS = [")
  expect(src).toContain('"pyrightconfig.json"')
  expect(src).toContain("const TY_ROOT_MARKERS = [")
  expect(src).toContain('"ty.toml"')
  expect(src).toContain("root: NearestRoot(TY_ROOT_MARKERS)")
  expect(src).toContain("root: NearestRoot(PYTHON_ROOT_MARKERS)")
})
