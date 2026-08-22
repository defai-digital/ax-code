import { createHash } from "node:crypto"
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { expect, test } from "vitest"
import {
  loadExternalFixtures,
  loadSyntheticFixtures,
  syntheticFixturesDir,
  verifyFixtureHashes,
  verifyPinnedFiles,
} from "../src/fixtures"

test("synthetic fixtures match the checked-in manifest", async () => {
  // loadSyntheticFixtures verifies sha256 for every manifest entry and
  // throws on any drift — reaching the assertions below means the tree is
  // byte-identical to what was recorded.
  const fixtures = await loadSyntheticFixtures()
  expect(fixtures.map((fixture) => fixture.id)).toEqual(["js-ts-monorepo", "python-project", "rust-workspace"])
  expect(Object.fromEntries(fixtures.map((fixture) => [fixture.id, Object.keys(fixture.files).length]))).toEqual({
    "js-ts-monorepo": 31,
    "python-project": 26,
    "rust-workspace": 8,
  })
})

test("query points land on their declared symbol", async () => {
  const fixtures = await loadSyntheticFixtures()
  for (const fixture of fixtures) {
    expect(fixture.queries.hover.length).toBeGreaterThan(0)
    expect(fixture.queries.definition.length).toBeGreaterThan(0)
    expect(fixture.queries.references.length).toBeGreaterThan(0)
    // The diagnostic-latency scenario toggles this line; it must introduce a
    // real diagnostic (a bare comment lets servers skip republication).
    expect(fixture.diagnosticEditLine.length).toBeGreaterThan(0)
    for (const queries of Object.values(fixture.queries)) {
      for (const query of queries) {
        const content = await readFile(path.join(syntheticFixturesDir(), fixture.id, query.file), "utf8")
        const line = content.split("\n")[query.line]
        expect(line?.slice(query.character, query.character + query.symbol.length)).toBe(query.symbol)
      }
    }
  }
})

test("drift detection rejects a tampered manifest entry", async () => {
  const [fixture] = await loadSyntheticFixtures()
  const first = Object.keys(fixture!.files)[0]!
  const tampered = { ...fixture!, files: { ...fixture!.files, [first]: "0".repeat(64) } }
  await expect(verifyFixtureHashes(tampered)).rejects.toThrow(/determinism check/)
})

// External fixtures are validated without cloning: the manifest schema
// (40-hex SHAs, query-point shape) is enforced by loadExternalFixtures, and
// the pinned-file hash check is exercised against a fabricated temp tree.
test("external manifest is fully pinned and self-consistent", async () => {
  const fixtures = await loadExternalFixtures()
  expect(fixtures.map((fixture) => fixture.id)).toEqual(["ts-zod", "py-pydantic", "rust-ripgrep"])
  for (const fixture of fixtures) {
    expect(fixture.sha).toMatch(/^[0-9a-f]{40}$/)
    expect(fixture.queries.hover.length).toBeGreaterThan(0)
    expect(fixture.queries.definition.length).toBeGreaterThan(0)
    expect(fixture.queries.references.length).toBeGreaterThan(0)
    expect(fixture.diagnosticFile.length).toBeGreaterThan(0)
    expect(fixture.diagnosticEditLine.length).toBeGreaterThan(0)
    // Every file a query point or the diagnostic edit depends on must be
    // hash-pinned.
    const pinned = new Set(Object.keys(fixture.verifyFiles))
    for (const queries of Object.values(fixture.queries)) {
      for (const query of queries) expect(pinned.has(query.file)).toBe(true)
    }
    expect(pinned.has(fixture.diagnosticFile)).toBe(true)
  }
})

test("verifyPinnedFiles accepts a matching tree and rejects drift", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "ax-code-perf-verify-"))
  try {
    await writeFile(path.join(dir, "a.ts"), "export const a = 1\n", "utf8")
    const hash = createHash("sha256").update("export const a = 1\n").digest("hex")
    await expect(verifyPinnedFiles(dir, { "a.ts": hash }, "fake")).resolves.toBeUndefined()
    await expect(verifyPinnedFiles(dir, { "a.ts": "0".repeat(64) }, "fake")).rejects.toThrow(/pinned-file check/)
    await expect(verifyPinnedFiles(dir, { "missing.ts": hash }, "fake")).rejects.toThrow(/pinned-file check/)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
