import { describe, expect, test } from "vitest"
import {
  discoveredGoalTests,
  evidenceFindingIds,
  findingNumbers,
  prefixErrors,
  reviewErrors,
  scopeAllowed,
  scopeErrors,
  terminalVerdict,
  triageErrors,
  type Batch,
  type ReviewRun,
  type TriageEntry,
} from "./check-goal-bughunt"

const BASELINE = "3eeab62e3c7feb1c7c0a0ae59fff26d5fb7503d0"
const batches: Batch[] = [
  { id: "goal-runtime", paths: ["packages/ax-code/src/session/goal.ts"], fingerprint: "fp-a" },
  { id: "goal-small", paths: ["packages/ax-code/src/session/goal-blocker.ts"], fingerprint: "fp-b" },
]

function run(overrides: Partial<ReviewRun> & Pick<ReviewRun, "reviewer" | "batch">): ReviewRun {
  return {
    exitCode: 0,
    signal: null,
    completed: true,
    error: null,
    stdoutBytes: 100,
    fingerprint: overrides.batch === "goal-runtime" ? "fp-a" : "fp-b",
    logText: "",
    ...overrides,
  }
}

const cleanLog = (findings: number, extra = "") => {
  const blocks = Array.from(
    { length: findings },
    (_, index) => `FINDING ${index + 1}: defect ${index + 1}\n  file: x${index + 1}.ts:${index + 1}\n`,
  ).join("")
  return `${extra}${blocks}BASELINE: ${BASELINE}\n${findings > 0 ? `FINDINGS: ${findings}` : "NO_FINDINGS"}\n`
}

function completeRuns(): ReviewRun[] {
  return [
    run({ reviewer: "claude", batch: "goal-runtime", logText: cleanLog(1) }),
    run({ reviewer: "codex", batch: "goal-runtime", logText: cleanLog(0) }),
    run({ reviewer: "muse", batch: "goal-small", logText: cleanLog(0) }),
  ]
}

describe("terminal verdict parsing", () => {
  test("accepts both terminal verdicts and rejects a missing one", () => {
    expect(terminalVerdict("text\nNO_FINDINGS")).toEqual({ verdict: "NO_FINDINGS", count: 0 })
    expect(terminalVerdict("text\nFINDINGS: 3")).toEqual({ verdict: "FINDINGS", count: 3 })
    expect(terminalVerdict("FINDINGS: 1\n\n")).toEqual({ verdict: "FINDINGS", count: 1 })
    expect(terminalVerdict("a trailing prose line stops this")).toBeNull()
    expect(terminalVerdict("")).toBeNull()
  })

  test("derives distinct finding numbers from the raw log", () => {
    expect(findingNumbers("FINDING 1: a\nFINDING 3: c\nFINDING 1: a")).toEqual([1, 3])
    expect(findingNumbers("nothing here")).toEqual([])
  })
})

describe("review evidence gate", () => {
  test("accepts complete reviewer runs covering every batch", () => {
    expect(reviewErrors({ baseline: BASELINE, batches, runs: completeRuns() })).toEqual([])
  })

  test("rejects a stalled or incomplete reviewer run", () => {
    const runs = completeRuns().map((item) =>
      item.reviewer === "muse"
        ? { ...item, completed: false, exitCode: null, signal: "SIGKILL", error: "ETIMEDOUT" }
        : item,
    )
    const errors = reviewErrors({ baseline: BASELINE, batches, runs })
    expect(errors.join("\n")).toContain("incomplete run")
    expect(errors.join("\n")).toContain("reviewer muse has no completed run")
  })

  test("rejects a fingerprint mismatch against the recomputed baseline", () => {
    const runs = completeRuns().map((item) =>
      item.reviewer === "claude" ? { ...item, fingerprint: "tampered" } : item,
    )
    expect(reviewErrors({ baseline: BASELINE, batches, runs }).join("\n")).toContain("fingerprint")
  })

  test("rejects a log that does not echo the baseline identity", () => {
    const runs = completeRuns().map((item) =>
      item.reviewer === "claude" ? { ...item, logText: "FINDING 1: x\nFINDINGS: 1\n" } : item,
    )
    expect(reviewErrors({ baseline: BASELINE, batches, runs }).join("\n")).toContain("does not echo the baseline")
  })

  test("rejects a missing terminal verdict and a mismatched count", () => {
    const missing = completeRuns().map((item) =>
      item.reviewer === "claude" ? { ...item, logText: `FINDING 1: x\nBASELINE: ${BASELINE}\n` } : item,
    )
    expect(reviewErrors({ baseline: BASELINE, batches, runs: missing }).join("\n")).toContain("no terminal FINDINGS")

    const mismatch = completeRuns().map((item) =>
      item.reviewer === "claude"
        ? { ...item, logText: `FINDING 1: a\nFINDING 2: b\nBASELINE: ${BASELINE}\nFINDINGS: 5\n` }
        : item,
    )
    expect(reviewErrors({ baseline: BASELINE, batches, runs: mismatch }).join("\n")).toContain("verdict count")
  })

  test("rejects a declared batch that no completed run covered", () => {
    const runs = completeRuns().filter((item) => item.batch !== "goal-small")
    expect(reviewErrors({ baseline: BASELINE, batches, runs }).join("\n")).toContain("goal-small was not covered")
  })

  test("collects finding ids only from completed runs", () => {
    const runs = completeRuns().map((item) =>
      item.reviewer === "muse" ? { ...item, completed: false, exitCode: 1 } : item,
    )
    expect(evidenceFindingIds({ baseline: BASELINE, batches, runs })).toEqual(["claude/goal-runtime/F1"])
  })
})

describe("triage gate", () => {
  const evidenceIds = ["claude/goal-runtime/F1"]

  const fixEntry: TriageEntry = {
    id: "claude/goal-runtime/F1",
    summary: "real defect",
    confirmed: true,
    decision: "fix",
    reason: "reproduced",
    confirmation: { method: "read the code", evidence: "file.ts:1" },
    fix: { summary: "guard the path", paths: ["packages/ax-code/src/session/x.ts"] },
    regression: { testPath: "test/session/goal-source-scope.test.ts" },
  }

  test("accepts a fully triaged finding", () => {
    expect(triageErrors({ evidenceIds, entries: [fixEntry] })).toEqual([])
  })

  test("rejects an orphan and an untriaged finding", () => {
    const orphan = triageErrors({ evidenceIds, entries: [{ ...fixEntry, id: "claude/goal-runtime/F9" }] })
    expect(orphan.join("\n")).toContain("orphan")
    expect(orphan.join("\n")).toContain("was never triaged")
    expect(triageErrors({ evidenceIds, entries: [] }).join("\n")).toContain("was never triaged")
  })

  test("rejects a duplicate triage entry", () => {
    expect(triageErrors({ evidenceIds, entries: [fixEntry, fixEntry] }).join("\n")).toContain("more than once")
  })

  test("rejects a rejection without an attempted reproduction", () => {
    const reject: TriageEntry = {
      ...fixEntry,
      decision: "reject",
      rejection: { attempted: false, evidence: "" },
    }
    const errors = triageErrors({ evidenceIds, entries: [reject] }).join("\n")
    expect(errors).toContain("attempted reproduction")
  })

  test("rejects a fix without a regression test", () => {
    expect(triageErrors({ evidenceIds, entries: [{ ...fixEntry, regression: undefined }] }).join("\n")).toContain(
      "regression testPath",
    )
  })
})

describe("pre-fix regression evidence", () => {
  const logs: Record<string, string> = {
    "prefix-fail.txt": "FAIL test/session/x.test.ts > does the thing\n × asserts\nTests 1 failed | 2 passed",
    "prefix-pass.txt": "Tests 3 passed",
    "prefix-empty.txt": "",
  }
  const readLog = (file: string) => logs[file]

  test("accepts a captured nonzero pre-fix run with a failure marker", () => {
    const errors = prefixErrors({
      fixes: [{ id: "F1", prefix: { log: "prefix-fail.txt", exitCode: 1, testName: "does the thing" } }],
      readLog,
    })
    expect(errors).toEqual([])
  })

  test("rejects a pre-fix log that does not show the declared test name", () => {
    expect(
      prefixErrors({
        fixes: [{ id: "F1", prefix: { log: "prefix-fail.txt", exitCode: 1, testName: "a different test" } }],
        readLog,
      }).join("\n"),
    ).toContain("does not show test")
  })

  test("rejects a missing, passing, empty or markerless pre-fix log", () => {
    expect(prefixErrors({ fixes: [{ id: "F1" }], readLog }).join("\n")).toContain("no captured pre-fix")
    expect(
      prefixErrors({ fixes: [{ id: "F1", prefix: { log: "prefix-fail.txt", exitCode: 0 } }], readLog }).join("\n"),
    ).toContain("nonzero exit")
    expect(
      prefixErrors({ fixes: [{ id: "F1", prefix: { log: "prefix-missing.txt", exitCode: 1 } }], readLog }).join("\n"),
    ).toContain("is missing")
    expect(
      prefixErrors({ fixes: [{ id: "F1", prefix: { log: "prefix-empty.txt", exitCode: 1 } }], readLog }).join("\n"),
    ).toContain("is empty")
    expect(
      prefixErrors({ fixes: [{ id: "F1", prefix: { log: "prefix-pass.txt", exitCode: 1 } }], readLog }).join("\n"),
    ).toContain("no failure marker")
  })
})

describe("commit scope gate", () => {
  test("allowlists only goal/agentic source, test and the two script paths", () => {
    expect(scopeAllowed("packages/ax-code/src/session/goal-source-scope.ts")).toBe(true)
    expect(scopeAllowed("packages/ax-code/test/session/goal-source-scope.test.ts")).toBe(true)
    expect(scopeAllowed("script/check-goal-bughunt.ts")).toBe(true)
    expect(scopeAllowed(".internal/reports/goal-agentic-bughunt/batches.json")).toBe(false)
    expect(scopeAllowed("AGENTS.md")).toBe(false)
    expect(scopeAllowed("packages/ax-code/src/provider/models.ts")).toBe(false)
    expect(scopeAllowed("docs/guides/autonomous.md")).toBe(false)
  })

  test("rejects a non-linear, empty, non-ancestor or out-of-scope range", () => {
    const base = {
      baseline: BASELINE,
      isAncestor: true,
      mergeCount: 0,
      commits: [{ sha: "a".repeat(40), paths: ["packages/ax-code/src/session/goal.ts"] }],
      trackedInternal: [] as string[],
      trackedAgents: [] as string[],
    }
    expect(scopeErrors(base)).toEqual([])
    expect(scopeErrors({ ...base, isAncestor: false }).join("\n")).toContain("not an ancestor")
    expect(scopeErrors({ ...base, commits: [] }).join("\n")).toContain("range is empty")
    expect(scopeErrors({ ...base, mergeCount: 1 }).join("\n")).toContain("linear")
    expect(
      scopeErrors({ ...base, commits: [{ sha: "b".repeat(40), paths: [".internal/x.md"] }] }).join("\n"),
    ).toContain("out-of-scope")
    expect(scopeErrors({ ...base, trackedInternal: [".internal/plan.md"] }).join("\n")).toContain("tracked local-only")
    expect(scopeErrors({ ...base, trackedAgents: ["AGENTS.md"] }).join("\n")).toContain("tracked local-only")
  })
})

describe("discovered goal tests", () => {
  test("finds the goal suite and never returns an empty list for this repo", () => {
    const found = discoveredGoalTests("packages/ax-code/test")
    expect(found.length).toBeGreaterThan(0)
    expect(found).toContain("test/session/goal-source-scope.test.ts")
    expect(found.every((file) => file.endsWith(".test.ts"))).toBe(true)
  })
})
