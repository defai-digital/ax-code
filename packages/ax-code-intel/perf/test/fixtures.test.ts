import { readFile } from "node:fs/promises"
import path from "node:path"
import { expect, test } from "vitest"
import { loadSyntheticFixtures, syntheticFixturesDir, verifyFixtureHashes } from "../src/fixtures"

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
