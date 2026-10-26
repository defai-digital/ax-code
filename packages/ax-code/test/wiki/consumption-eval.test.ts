import { expect, test } from "vitest"
import { readFile } from "node:fs/promises"
import path from "node:path"
import { loadWikiManifest, getPageFreshness } from "@ax-code/ax-wiki/node"
import { tmpdir } from "../fixture/fixture"
import { assessConsumption, createConsumptionFixture } from "../../script/wiki-consumption-fixture"

const tool = (name: string, input: Record<string, unknown>, output = "") => ({
  type: "tool_use",
  part: { tool: name, state: { status: "completed", input, output } },
})
const stream = (events: unknown[]) => events.map((event) => JSON.stringify(event)).join("\n")
const result = (text: string, status = "completed") => ({ type: "result", status, text, sessionID: "fixture-session" })

test("behavior evaluator requires actual source and Wiki calls, a completed run and no mutations", () => {
  const prose = result("Pricing owns rounding to cents in src/pricing.ts")
  expect(assessConsumption("architecture", stream([prose])).passed).toBe(false)
  const calls = [
    tool("repo_wiki", { operation: "read", page: "quickstart.md" }),
    tool("read", { filePath: "/fixture/src/pricing.ts" }),
  ]
  expect(assessConsumption("architecture", stream([...calls, prose])).passed).toBe(true)
  expect(assessConsumption("architecture", stream([...calls, result("Pricing rounds cents", "timeout")])).passed).toBe(
    false,
  )
  expect(assessConsumption("architecture", stream([...calls, tool("edit", {}), prose])).passed).toBe(false)
  expect(assessConsumption("architecture", stream([...calls, tool("verify_project", {}), prose])).passed).toBe(false)
  expect(
    assessConsumption(
      "architecture",
      stream([
        tool("read", { filePath: "/fixture/.ax-wiki/quickstart.md" }),
        tool("read", { filePath: "/fixture/src/pricing.ts" }),
        prose,
      ]),
    ).passed,
  ).toBe(true)
  expect(assessConsumption("architecture", "invalid\nnull\n{}").passed).toBe(false)
})

test("omitted importer acceptance requires an independent search and verified uncited consumer", () => {
  const calls = [
    tool("repo_wiki", { operation: "insights", targets: ["src/pricing.ts"] }),
    tool("read", { filePath: "src/pricing.ts" }),
  ]
  const answer = result("Partial cited scope; tools/reconcile.ts is also a caller.")
  expect(assessConsumption("omitted-importer", stream([...calls, answer])).passed).toBe(false)
  expect(
    assessConsumption(
      "omitted-importer",
      stream([
        ...calls,
        tool("grep", { pattern: "computeTotal" }, 'tools/reconcile.ts imports computeTotal from "../src/pricing"'),
        answer,
      ]),
    ).passed,
  ).toBe(true)
})

test("no-profile acceptance rejects invented magnitudes and requires a measurement plan", () => {
  const calls = [tool("repo_wiki", { operation: "insights" }), tool("read", { filePath: "src/pricing.ts" })]
  expect(
    assessConsumption(
      "no-profile",
      stream([
        ...calls,
        result("Impact is unmeasured. Collect a CPU profile for the workload and establish a baseline benchmark."),
      ]),
    ).passed,
  ).toBe(true)
  expect(
    assessConsumption(
      "no-profile",
      stream([...calls, result("Unmeasured baseline; this should be 20% faster. Benchmark it.")]),
    ).passed,
  ).toBe(false)
})

test("fixture makes stale contract and omitted-importer traps real, without fabricated production profiling", async () => {
  await using stale = await tmpdir()
  await createConsumptionFixture(stale.path, "stale")
  const manifest = (await loadWikiManifest(stale.path))!
  expect(manifest.pages["quickstart.md"].sources).toContain("src/pricing.ts")
  expect(manifest.pages["quickstart.md"].sources).not.toContain("tools/reconcile.ts")
  expect((await getPageFreshness({ root: stale.path })).get("quickstart.md")?.freshness).toBe("stale")
  expect(await readFile(path.join(stale.path, "src/pricing.ts"), "utf8")).toContain("currency")
  await using profile = await tmpdir()
  await createConsumptionFixture(profile.path, "measured-profile")
  const body = await readFile(path.join(profile.path, "profiles/cpu-summary.json"), "utf8")
  expect(body).toContain("synthetic-evaluation")
  expect(body).toContain('"candidateMeasurement": null')
})

test("live fixture admits the Wiki and read/search tools through effective permissions", async () => {
  const { Instance } = await import("../../src/project/instance")
  const { Agent } = await import("../../src/agent/agent")
  const { Permission } = await import("../../src/permission")
  await using tmp = await tmpdir()
  await createConsumptionFixture(tmp.path, "architecture")
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      for (const name of ["build", "perf"]) {
        const agent = await Agent.get(name)
        expect([...Permission.disabled(["repo_wiki", "read", "grep", "glob", "list"], agent.permission)]).toEqual([])
      }
    },
  })
})
