import fs from "node:fs/promises"
import path from "node:path"
import { expect, test } from "vitest"
import { extractVerdicts, verify, reviewSourceDirty } from "../../script/verify-cli-review-receipts"
import { regressionReportFailures, runReviewRegressions, validateRegression } from "../../script/cli-review-regressions"
import { git } from "../../src/util/git"
import { tmpdir } from "../fixture/fixture"

const revision = "a".repeat(40)
const regression = { file: "packages/ax-code/test/cli/tui/regression.test.ts", fullName: "fixed behavior" }
const verdict = {
  verdict: "findings",
  reviewed_revision: revision,
  findings: [{ id: "F1", severity: "high", file: "src/a.ts", line: 1, summary: "example" }],
}

test("concatenates Grok text deltas while excluding thought and control events", () => {
  const json = JSON.stringify(verdict)
  const raw = [
    { type: "thought", data: JSON.stringify({ ...verdict, reviewed_revision: "wrong" }) },
    { type: "text", data: json.slice(0, 19) },
    { type: "control", data: "not part of answer" },
    { type: "thought", text: json },
    { type: "text", data: json.slice(19) },
  ]
    .map((x) => JSON.stringify(x))
    .join("\n")
  expect(extractVerdicts(raw, "jsonl")).toEqual([
    { verdict: "findings", reviewedRevision: revision, findings: verdict.findings },
  ])
  expect(extractVerdicts(JSON.stringify({ type: "thought", data: json }), "jsonl")).toEqual([])
  expect(extractVerdicts(`Final answer:\n${json}`)).toHaveLength(1)
})

test("fixed prose cannot claim regression coverage and missing receipts still fail", async () => {
  await using tmp = await tmpdir()
  const findings = []
  for (const cli of ["grok", "claude", "codex"]) {
    const dir = path.join(tmp.path, "round-1", cli)
    await fs.mkdir(dir, { recursive: true })
    await fs.writeFile(path.join(dir, "exit.txt"), "0\n")
    await fs.writeFile(path.join(dir, cli === "grok" ? "stdout.jsonl" : "stdout.txt"), JSON.stringify(verdict))
    findings.push({ round: "round-1", cli, id: "F1", status: "fixed", evidence: "No test exists" })
  }
  await fs.writeFile(path.join(tmp.path, "round-1/revision.txt"), revision)
  await fs.writeFile(path.join(tmp.path, "dispositions.json"), JSON.stringify({ findings }))
  const result = verify({ root: tmp.path, revision })
  expect(result.failures.filter((x) => x.includes("requires regression"))).toHaveLength(3)
  expect(result.failures.filter((x) => x.includes("new revision"))).toHaveLength(3)
  expect(result.lines.join("\n")).not.toContain("covered by a regression test")
  await fs.writeFile(
    path.join(tmp.path, "dispositions.json"),
    JSON.stringify({ findings: findings.map((x) => ({ ...x, regression })) }),
  )
  expect(verify({ root: tmp.path, revision }).regressions).toHaveLength(3)
  const fixedRevision = "b".repeat(40)
  for (const cli of ["grok", "claude", "codex"]) {
    const dir = path.join(tmp.path, "round-2", cli)
    await fs.mkdir(dir, { recursive: true })
    await fs.writeFile(path.join(dir, "exit.txt"), "0")
    await fs.writeFile(
      path.join(dir, cli === "grok" ? "stdout.jsonl" : "stdout.txt"),
      JSON.stringify({ verdict: "no_findings", reviewed_revision: fixedRevision, findings: [] }),
    )
  }
  await fs.writeFile(path.join(tmp.path, "round-2/revision.txt"), fixedRevision)
  expect(verify({ root: tmp.path, revision: fixedRevision }).failures).toEqual([])

  await fs.writeFile(
    path.join(tmp.path, "dispositions.json"),
    JSON.stringify({ findings: [...findings, findings[0]].map((x) => ({ ...x, regression })) }),
  )
  expect(verify({ root: tmp.path, revision }).failures).toContain("duplicate disposition round-1/grok/F1")
  await fs.writeFile(
    path.join(tmp.path, "round-1/grok/stdout.jsonl"),
    JSON.stringify(verdict) + "\n" + JSON.stringify(verdict),
  )
  expect(verify({ root: tmp.path, revision }).failures).toContain("round-1/grok: multiple verdicts are ambiguous")
  await fs.unlink(path.join(tmp.path, "round-1/claude/exit.txt"))
  expect(verify({ root: tmp.path, revision }).failures).toContain("round-1/claude: missing exit.txt")
})

test("requires the exact passed assertion, not a skipped test or another file", () => {
  const root = path.resolve("report-fixture")
  const report = {
    success: true,
    numTotalTests: 1,
    numFailedTests: 0,
    testResults: [
      {
        name: path.join(root, regression.file),
        assertionResults: [{ fullName: regression.fullName, status: "passed" }],
      },
    ],
  }
  expect(regressionReportFailures(report, [regression], root)).toEqual([])
  report.testResults[0].assertionResults.push({ fullName: regression.fullName, status: "passed" })
  expect(regressionReportFailures(report, [regression], root)).toHaveLength(1)
  report.testResults[0].assertionResults.pop()
  report.testResults[0].assertionResults[0].status = "pending"
  expect(regressionReportFailures(report, [regression], root)).toHaveLength(1)
  expect(regressionReportFailures({ ...report, numTotalTests: 0 }, [regression], root)).toHaveLength(1)
  expect(
    validateRegression({ ...regression, file: "packages/ax-code/test/cli/tui/../../outside.test.ts" }),
  ).toBeUndefined()
})

test("runs actual regressions and rejects failing or missing assertions", async () => {
  await using tmp = await tmpdir()
  const packageRoot = path.join(tmp.path, "packages/ax-code")
  await fs.mkdir(path.dirname(path.join(tmp.path, regression.file)), { recursive: true })
  // Import Vitest from this checkout; the isolated project has no dependency install.
  const entry = path.resolve("node_modules/vitest/dist/index.js").replaceAll("\\", "/")
  await fs.writeFile(
    path.join(packageRoot, "vitest.config.mjs"),
    'export default { test: { include: ["test/**/*.test.ts"] } }\n',
  )
  const file = path.join(tmp.path, regression.file)
  await fs.writeFile(
    file,
    `import { test, expect } from ${JSON.stringify(entry)}; test("fixed behavior", () => expect(1).toBe(1))\n`,
  )
  expect(await runReviewRegressions(tmp.path, [regression])).toEqual([])
  expect(await runReviewRegressions(tmp.path, [{ ...regression, fullName: "missing assertion" }])).toHaveLength(1)
  await fs.writeFile(
    file,
    `import { test, expect } from ${JSON.stringify(entry)}; test("fixed behavior", () => expect(1).toBe(2))\n`,
  )
  expect((await runReviewRegressions(tmp.path, [regression]))[0]).toContain("Regression execution failed")
}, 30_000)

test("review identity rejects uncommitted source while preserving unrelated local configuration", async () => {
  await using tmp = await tmpdir({ git: true })
  const source = path.join(tmp.path, "packages/ax-code/src/cli/tui/component/fixture.ts")
  await fs.mkdir(path.dirname(source), { recursive: true })
  await fs.writeFile(path.join(tmp.path, "packages/ax-code/ax-code.json"), "{}")
  expect(reviewSourceDirty(tmp.path)).toBe(false)
  const config = path.join(tmp.path, "packages/ax-code/vitest.config.ts")
  await fs.writeFile(config, "export default {}\n")
  expect(reviewSourceDirty(tmp.path)).toBe(true)
  await fs.unlink(config)
  await fs.writeFile(source, "export const value = 1\n")
  expect(reviewSourceDirty(tmp.path)).toBe(true)
  await git(["add", "packages/ax-code/src/cli/tui/component/fixture.ts"], { cwd: tmp.path })
  await git(["commit", "-m", "Add source fixture"], { cwd: tmp.path })
  expect(reviewSourceDirty(tmp.path)).toBe(false)
  await fs.appendFile(source, "// changed\n")
  expect(reviewSourceDirty(tmp.path)).toBe(true)
})

test("text receipts preserve standalone pretty-printed finding objects", () => {
  const finding = JSON.stringify({ ...verdict.findings[0], type: "bug" })
  const raw = `{\n"verdict":"findings",\n"reviewed_revision":"${revision}",\n"findings":[\n${finding}\n]\n}`
  expect(extractVerdicts(raw)[0]?.findings).toEqual(verdict.findings)
  expect(extractVerdicts(JSON.stringify({ ...verdict, findings: [] }))).toEqual([])
})
