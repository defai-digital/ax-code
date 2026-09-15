import { test, expect } from "vitest"
import { spawnSync } from "node:child_process"
import { createHash } from "node:crypto"
import fs from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { tmpdir } from "../fixture/fixture"
import { parseJsonStrict } from "../../src/util/json-value"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..")
const emptyDiff = createHash("sha256").update("").digest("hex")
function capture(passed: boolean) {
  return {
    version: 1,
    repetitions: 2,
    scenarios: ["case"],
    revision: passed ? "candidate" : "baseline",
    runtimeDiffHash: emptyDiff,
    fixtureHash: "same-fixture",
    node: process.version,
    model: "scripted-no-network",
    runnerExitCode: 0,
    observations: [0, 1].map((repetition) => ({
      scenario: "case",
      category: "reliability",
      repetition,
      passed,
      elapsedMs: 10,
      detail: passed ? "ok" : "failed oracle",
    })),
  }
}
async function compare(baseline: unknown, candidate: unknown) {
  await using tmp = await tmpdir()
  const before = path.join(tmp.path, "before.json"),
    after = path.join(tmp.path, "after.json")
  await fs.writeFile(before, JSON.stringify(baseline))
  await fs.writeFile(after, JSON.stringify(candidate))
  return spawnSync(process.execPath, ["--import", "tsx", "script/goal-benchmark.ts", "compare", before, after], {
    cwd: root,
    encoding: "utf8",
    timeout: 10000,
  })
}
test("benchmark reports failures in the denominator", async () => {
  const result = await compare(capture(false), capture(true))
  expect(result.status).toBe(0)
  const parsed = parseJsonStrict(result.stdout) as any
  expect(parsed.rows[0].baseline).toMatchObject({ passed: 0, total: 2, failures: ["failed oracle"] })
  expect(parsed.rows[0].candidate).toMatchObject({ passed: 2, total: 2 })
})
test("benchmark rejects missing and duplicated observations", async () => {
  const missing = capture(true)
  missing.observations.pop()
  expect((await compare(capture(false), missing)).status).not.toBe(0)
  const duplicate = capture(true)
  duplicate.observations[1] = duplicate.observations[0]
  expect((await compare(capture(false), duplicate)).status).not.toBe(0)
})
test("benchmark rejects different Node versions and fixture contents", async () => {
  const node = capture(true)
  node.node = "v0.0.0"
  expect((await compare(capture(false), node)).stderr).toContain("identical fixture")
  const fixture = capture(true)
  fixture.fixtureHash = "changed-fixture"
  expect((await compare(capture(false), fixture)).stderr).toContain("identical fixture")
})
test("benchmark rejects dirty runtime source and failed runners", async () => {
  const dirty = capture(true)
  dirty.runtimeDiffHash = "changed-runtime"
  expect((await compare(capture(false), dirty)).stderr).toContain("declared revision")
  const failed = capture(true)
  failed.runnerExitCode = 1
  expect((await compare(capture(false), failed)).stderr).toContain("runner failed")
})
