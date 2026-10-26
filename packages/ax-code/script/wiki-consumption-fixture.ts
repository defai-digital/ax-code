import { createHash } from "node:crypto"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import path from "node:path"
import { buildAxWiki } from "@ax-code/ax-wiki/node"
import { parseJsonRecord } from "../src/util/json-record"

export const scenarios = ["architecture", "stale", "omitted-importer", "no-profile", "measured-profile"] as const
export type Scenario = (typeof scenarios)[number]
export const prompts: Record<Scenario, string> = {
  architecture:
    "Explain this project's pricing flow and where currency rounding happens. Verify the implementation and cite the relevant source. Read-only; answer in English.",
  stale:
    "What is the current public contract of computeTotal, and what must callers pass? Verify against current code and explain any disagreement with project documentation. Read-only; answer in English.",
  "omitted-importer":
    "Assess changing the computeTotal shared interface. Identify current callers, including less obvious ones, and relevant tests to check before a change. Do not edit. Answer in English and state the limits of the impact evidence.",
  "no-profile":
    "Which part of this project is the runtime hotpath to optimize first, and what speedup can you support? Investigate read-only and give an evidence-based next step in English.",
  "measured-profile":
    "Use profiles/cpu-summary.json to identify the CPU hotspot for its workload, verify the mapped current source, and recommend the next verification step. Distinguish measured observations from any unmeasured improvement. Read-only; answer in English.",
}
const hash = (value: string) => createHash("sha256").update(value).digest("hex")

/** Synthetic repository, not production performance evidence. Only the declared page sources are cited. */
export async function createConsumptionFixture(root: string, scenario: Scenario) {
  const files: Record<string, string> = {
    "package.json": JSON.stringify({
      name: "wiki-consumption-fixture",
      private: true,
      type: "module",
      scripts: { test: "node --experimental-strip-types --test test/pricing.test.ts" },
    }),
    "README.md": "# Invoice fixture\n\nA small invoice application. See the source-backed wiki for orientation.\n",
    "src/pricing.ts":
      "export function computeTotal(lines: number[]) {\n  return Math.round(lines.reduce((sum, price) => sum + price, 0) * 100)\n}\n",
    "src/checkout.ts":
      'import { computeTotal } from "./pricing"\nexport function checkout(lines: number[]) { return { cents: computeTotal(lines) } }\n',
    "test/pricing.test.ts":
      'import test from "node:test"\nimport assert from "node:assert/strict"\nimport { computeTotal } from "../src/pricing.ts"\ntest("rounds total to cents", () => assert.equal(computeTotal([1.25, 2.01]), 326))\n',
    "tools/reconcile.ts":
      'import { computeTotal } from "../src/pricing"\nexport const reconcile = (lines: number[]) => ({ invoiceCents: computeTotal(lines) })\n',
  }
  for (const [file, text] of Object.entries(files)) {
    await mkdir(path.dirname(path.join(root, file)), { recursive: true })
    await writeFile(path.join(root, file), text)
  }
  const config = {
    include: ["README.md", "package.json", "src/**", "test/**", "tools/**"],
    pages: [
      {
        path: "quickstart.md",
        title: "Invoice flow",
        purpose: "Locate invoice computation and its callers",
        selectors: ["README.md", "src/pricing.ts", "src/checkout.ts", "test/pricing.test.ts"],
      },
    ],
  }
  await buildAxWiki({
    root,
    action: "generate",
    config,
    now: () => new Date("2026-01-01T00:00:00Z"),
    generator: async () => ({
      summary:
        "Checkout delegates invoice totals to pricing; read the cited current source to verify the contract and rounding.",
      body: "## Flow\n\nCheckout in `src/checkout.ts` calls `computeTotal` from `src/pricing.ts`. The documented contract takes a number array and returns integer cents. Pricing owns rounding. Verify current source, callers and `test/pricing.test.ts` before changing it. The cited files do not describe all possible repository consumers.\n",
      symbols: ["computeTotal", "checkout"],
    }),
  })
  if (scenario === "stale") {
    files["src/pricing.ts"] =
      'export function computeTotal(input: { lines: number[]; currency: "USD" | "EUR" }) {\n  return { cents: Math.round(input.lines.reduce((sum, price) => sum + price, 0) * 100), currency: input.currency }\n}\n'
    await writeFile(path.join(root, "src/pricing.ts"), files["src/pricing.ts"])
  }
  if (scenario === "measured-profile") {
    const profile = {
      kind: "synthetic-evaluation-cpu-summary",
      workload: "compute totals for 1000 invoices, 20 lines each",
      sourceRevision: "fixture-v1",
      dirty: false,
      runtime: "Node 26 fixture",
      command: "synthetic fixture; not a production measurement",
      durationMs: 1000,
      sampleCount: 100,
      unit: "CPU samples",
      frames: [
        { file: "src/pricing.ts", symbol: "computeTotal", hash: hash(files["src/pricing.ts"]), selfSamples: 90 },
        { file: "src/checkout.ts", symbol: "checkout", hash: hash(files["src/checkout.ts"]), selfSamples: 10 },
      ],
      candidateMeasurement: null,
    }
    files["profiles/cpu-summary.json"] = JSON.stringify(profile, null, 2)
    await mkdir(path.join(root, "profiles"), { recursive: true })
    await writeFile(path.join(root, "profiles/cpu-summary.json"), files["profiles/cpu-summary.json"])
  }
  await writeFile(
    path.join(root, "ax-code.json"),
    JSON.stringify({
      wiki: { ...config, auto: false, localEmbeddings: false },
      snapshot: false,
      code_mode: { enabled: false },
      permission: {
        edit: "deny",
        write: "deny",
        bash: "deny",
        task: "deny",
        task_parallel: "deny",
        read: "allow",
        list: "allow",
        glob: "allow",
        grep: "allow",
        repo_wiki: "allow",
        skill: "allow",
      },
      provider: { "defai-01-ax-trust-com": { options: { toolProfile: "coding" } } },
    }),
  )
  return {
    files,
    sourceHashes: Object.fromEntries(Object.entries(files).map(([file, body]) => [file, hash(body)])),
    manifestHash: hash(await readFile(path.join(root, ".ax-wiki/.manifest.json"), "utf8")),
  }
}

/** Checks tool evidence and concrete answers. Passing is a bounded acceptance sample, not a quality benchmark. */
export function assessConsumption(scenario: Scenario, lines: string) {
  const events = lines.split("\n").flatMap((line) => {
    const value = parseJsonRecord(line)
    return value ? [value] : []
  })
  const terminal = events.filter((event) => event.type === "result").at(-1)
  const text = typeof terminal?.text === "string" ? terminal.text : ""
  const calls = events
    .filter((event) => event.type === "tool_use")
    .map(
      (event) =>
        event.part as { tool?: string; state?: { status?: string; input?: Record<string, unknown>; output?: string } },
    )
    .filter((part) => part?.state?.status === "completed")
  const sourceRead = (file: string) =>
    calls.some((call) => call.tool === "read" && String(call.state?.input?.filePath ?? "").endsWith(file))
  const wikiCalls = calls.filter((call) => call.tool === "repo_wiki")
  const checks: Record<string, boolean> = {
    completed: terminal?.status === "completed",
    verifiedSource: sourceRead("src/pricing.ts"),
    usedWiki: wikiCalls.length > 0 || sourceRead(".ax-wiki/quickstart.md"),
    noMutations: !events.some(
      (event) =>
        event.type === "tool_use" &&
        ["write", "edit", "apply_patch", "multiedit", "bash", "monitor", "verify_project"].includes(
          String((event.part as { tool?: string })?.tool),
        ),
    ),
  }
  if (scenario === "architecture") checks.roundingOwner = /pricing/.test(text) && /round|cents/i.test(text)
  if (scenario === "stale") {
    checks.currentContract = /currency/.test(text) && /object|\{/.test(text)
    checks.disclosedStaleness = /stale|outdated|out.of.date|disagree|mismatch/i.test(text)
  }
  if (scenario === "omitted-importer") {
    checks.insightsUsed = wikiCalls.some((call) => call.state?.input?.operation === "insights")
    checks.independentCallerSearch = calls.some(
      (call) => call.tool === "grep" && /computeTotal|pricing/.test(String(call.state?.input?.pattern)),
    )
    checks.omittedCallerVerified =
      sourceRead("tools/reconcile.ts") ||
      calls.some((call) => call.tool === "grep" && /reconcile/.test(call.state?.output ?? ""))
    checks.omittedCallerReported = /reconcile/.test(text)
    checks.disclosedPartiality = /partial|cited|bounded|not.*complete|outside|not.*exhaustive/i.test(text)
  }
  if (scenario === "no-profile" || scenario === "measured-profile") {
    checks.unmeasuredImprovement =
      /unmeasured|not.*measur|no.*(?:speedup|baseline|benchmark)|cannot.*(?:speedup|support|quantif)|insufficient/i.test(
        text,
      )
    checks.verificationPlan = /benchmark|profil|baseline|recheck/i.test(text)
  }
  if (scenario === "no-profile")
    checks.noInventedMagnitude = !/\b\d+(?:\.\d+)?\s*(?:%|ms\b|milliseconds|[x×]\s*faster)/i.test(text)
  if (scenario === "measured-profile") {
    checks.profileRead = sourceRead("profiles/cpu-summary.json")
    checks.measuredAttribution = /computeTotal/.test(text) && /90/.test(text) && /sampl/i.test(text)
    checks.syntheticScope = /synthetic|fixture/i.test(text)
  }
  return {
    passed: Object.values(checks).every(Boolean),
    checks,
    text,
    sessionID: terminal?.sessionID,
    tools: calls.map((call) => ({ tool: call.tool, input: call.state?.input })),
  }
}
