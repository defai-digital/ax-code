import { expect, test } from "vitest"
import { GoalCheckVerification } from "../../src/session/goal-check-verification"
import { GoalAssurance } from "../../src/session/goal-assurance"
import { GoalPlan } from "../../src/session/goal-plan"

const assurance: GoalAssurance.Contract = {
  version: 1,
  sourcePaths: ["src"],
  sources: [{ role: "legacy", reference: "schema.sql@v1" }],
  checks: [
    {
      id: "db",
      acceptanceIds: ["AC1"],
      command: "node check.cjs -- --target staging",
      purpose: "Database parity",
      environment: "staging",
    },
  ],
}
const source = { available: true, commit: "commit-a", dirtyDigest: "content-v1:abc" }
const receipt: GoalCheckVerification.Receipt = {
  version: 1,
  sessionID: "session-a",
  goalCreated: 100,
  checkID: "db",
  contractDigest: "a".repeat(64),
  cwd: "/fixture",
  command: assurance.checks[0].command,
  startedAt: 110,
  endedAt: 120,
  sourceBefore: source,
  sourceAfter: source,
  passed: true,
  exitCode: 0,
}
function message(value: unknown = receipt, status = "completed") {
  return {
    info: { role: "assistant" },
    parts: [
      {
        type: "tool",
        tool: "verify_project",
        state: { status, input: { goalCheck: "db" }, metadata: { passed: true, goalCheckReceipt: value } },
      },
    ],
  }
}
const base = {
  assurance,
  sessionID: receipt.sessionID,
  created: 100,
  digest: receipt.contractDigest,
  cwd: "/fixture",
  source,
}

test("existing goal digests remain compatible with the pre-assurance format", () => {
  expect(GoalPlan.digestOf(GoalPlan.sample("ship it"))).toBe(
    "259d1f3adf0d60d8f6698bb178f90916cd40714f05f650f2a8e99a1ec1130e09",
  )
})

test("only current successful receipts satisfy required checks", () => {
  expect(GoalCheckVerification.missing({ ...base, messages: [message()] })).toEqual([])
  for (const patch of [
    { sessionID: "other-session" },
    { goalCreated: 99 },
    { checkID: "other" },
    { contractDigest: "b".repeat(64) },
    { cwd: "/other-workspace" },
    { command: "true" },
    { startedAt: 90 },
    { endedAt: 109 },
    { passed: false },
    { exitCode: 1 },
    { exitCode: null },
    { sourceBefore: { ...source, dirtyDigest: "content-v1:old" } },
    { sourceAfter: { ...source, commit: "old-commit" } },
    { sourceAfter: { ...source, available: false } },
  ])
    expect(GoalCheckVerification.missing({ ...base, messages: [message({ ...receipt, ...patch })] })).toEqual(["db"])
  expect(GoalCheckVerification.missing({ ...base, messages: [message("all checks passed")] })).toEqual(["db"])
  expect(
    GoalCheckVerification.missing({ ...base, source: { ...source, available: false }, messages: [message()] }),
  ).toEqual(["db"])
})

test("latest failed or unfinished attempts invalidate earlier successful receipts", () => {
  for (const status of ["error", "running", "pending"]) {
    expect(GoalCheckVerification.missing({ ...base, messages: [message(), message(undefined, status)] })).toEqual([
      "db",
    ])
  }
  expect(
    GoalCheckVerification.missing({
      ...base,
      messages: [message(), message({ ...receipt, passed: false, exitCode: 1 })],
    }),
  ).toEqual(["db"])
})

test("persisted attempt timestamps prevent reordered history from reviving an older pass", () => {
  const older = message()
  const newer = message({ ...receipt, passed: false, exitCode: 1 })
  const timed = (entry: ReturnType<typeof message>, start: number) => ({
    ...entry,
    parts: entry.parts.map((part) => ({ ...part, state: { ...part.state, time: { start } } })),
  })
  expect(GoalCheckVerification.missing({ ...base, messages: [timed(newer, 300), timed(older, 200)] })).toEqual(["db"])
})

test("assurance is round-trip stable and cannot omit or fabricate acceptance coverage", () => {
  const contract = { ...GoalPlan.sample("ship it"), assurance }
  const parsed = GoalPlan.parse(GoalPlan.render(contract))
  expect(parsed.assurance).toEqual(assurance)
  expect(GoalPlan.digestOf(parsed)).toBe(GoalPlan.digestOf(contract))
  expect(GoalPlan.digestOf(parsed)).not.toBe(GoalPlan.digestOf(GoalPlan.sample("ship it")))
  expect(() => GoalAssurance.validate(assurance, ["AC1", "AC2"])).toThrow(/missing AC2/)
  expect(() => GoalAssurance.validate(assurance, ["AC2"])).toThrow(/Unknown acceptance/)
  expect(() =>
    GoalAssurance.validate({ ...assurance, checks: [...assurance.checks, ...assurance.checks] }, ["AC1"]),
  ).toThrow(/Duplicate goal check/)
  expect(() => GoalAssurance.validate({ ...assurance, sourcePaths: ["../outside"] }, ["AC1"])).toThrow(
    /inside the workspace/,
  )
  expect(() =>
    GoalAssurance.validate(
      { ...assurance, checks: [{ ...assurance.checks[0], command: "node check.cjs\necho done" }] },
      ["AC1"],
    ),
  ).toThrow(/single line/)
})
