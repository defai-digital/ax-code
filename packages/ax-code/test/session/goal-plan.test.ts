import { describe, expect, test } from "vitest"
import { GoalPlan } from "../../src/session/goal-plan"

describe("GoalPlan parser", () => {
  test("round-trips a code-change contract", () => {
    const contract = GoalPlan.sample("migrate auth to the new API")
    const parsed = GoalPlan.parse(GoalPlan.render(contract))
    expect(parsed.kind).toBe("code-change")
    expect(parsed.acceptance[0]?.id).toBe("AC1")
    expect(parsed.acceptance[0]?.text).toContain("migrate auth")
    expect(parsed.verification[0]?.tag).toBe("gating")
    expect(parsed.taskChecklist?.length).toBeGreaterThanOrEqual(2)
    expect(GoalPlan.digestOf(parsed)).toBe(GoalPlan.digestOf(contract))
  })

  test.each([
    {
      label: "an ASCII hyphen in the action",
      action: "run unit tests - then integration tests",
      observation: "tests pass",
    },
    {
      label: "an ASCII hyphen in the observation",
      action: "run pnpm test",
      observation: "unit - integration suites pass",
    },
    {
      label: "an em dash in the action",
      action: "run foo — bar suite",
      observation: "tests pass",
    },
    {
      label: "an em dash in the observation",
      action: "run pnpm test",
      observation: "tests pass — including integration",
    },
    {
      label: "a double hyphen in the action",
      action: "run foo -- bar suite",
      observation: "tests pass",
    },
  ])("round-trips verification text containing $label", ({ action, observation }) => {
    const contract = GoalPlan.fromFields({
      kind: "code-change",
      acceptance: [{ text: "the feature works" }],
      verification: [{ tag: "gating", action, observation }],
      nonGoals: ["unrelated changes"],
      assumedScope: "src",
      implementationApproach: "keep the change small",
      taskChecklist: ["implement", "verify"],
    })
    const parsed = GoalPlan.parse(GoalPlan.render(contract))
    expect(parsed.verification).toEqual(contract.verification)
    expect(GoalPlan.digestOf(parsed)).toBe(GoalPlan.digestOf(contract))
  })

  test("splits a legacy verification line once and preserves the observation", () => {
    const markdown = GoalPlan.render(GoalPlan.sample("ship it")).replace(
      "1. gating: run the relevant tests or verify_project — the checks pass after the last change",
      "1. gating: run unit tests - then integration tests - both pass",
    )
    const parsed = GoalPlan.parse(markdown)
    expect(parsed.verification[0]).toEqual({
      tag: "gating",
      action: "run unit tests",
      observation: "then integration tests - both pass",
    })
  })

  test("parses analysis plans without a checklist", () => {
    const markdown = `# Plan: Review the auth module

## Goal kind
analysis

## Acceptance criteria
1. AC1: a written summary of the current auth flow exists

## Verification plan
1. gating: read the summary — it names the login, refresh, and logout paths

## Non-goals
- rewriting the module

## Assumed scope
src/auth
`
    const parsed = GoalPlan.parse(markdown)
    expect(parsed.kind).toBe("analysis")
    expect(parsed.taskChecklist).toBeUndefined()
    expect(parsed.implementationApproach).toBeUndefined()
  })

  test("rejects unknown kinds, empty sections, and oversized input", () => {
    expect(() => GoalPlan.parse("# Plan: x\n\n## Goal kind\nrefactor\n")).toThrow(/Goal kind/)
    expect(() =>
      GoalPlan.parse(`# Plan: x

## Goal kind
code-change

## Acceptance criteria
1. done

## Verification plan
1. gating: test — pass

## Non-goals

## Assumed scope
src
`),
    ).toThrow(/Non-goals/)
    expect(() => GoalPlan.parse("x".repeat(GoalPlan.MAX_READ_BYTES + 1))).toThrow(/exceeds/)
    const multibyte = GoalPlan.render(GoalPlan.sample("界".repeat(3_000)))
    expect(multibyte.length).toBeLessThan(GoalPlan.MAX_READ_BYTES)
    expect(Buffer.byteLength(multibyte, "utf8")).toBeGreaterThan(GoalPlan.MAX_READ_BYTES)
    expect(() => GoalPlan.parse(multibyte)).toThrow(/exceeds/)
  })

  test("rejects duplicate acceptance ids and missing code-change checklist", () => {
    expect(() =>
      GoalPlan.fromFields({
        kind: "code-change",
        acceptance: [
          { id: "AC1", text: "one" },
          { id: "AC1", text: "two" },
        ],
        verification: [{ tag: "gating", action: "test", observation: "pass" }],
        nonGoals: ["other"],
        assumedScope: "src",
        implementationApproach: "small change",
        taskChecklist: ["a", "b"],
      }),
    ).toThrow(/Duplicate/)
    expect(() =>
      GoalPlan.fromFields({
        kind: "code-change",
        acceptance: [{ text: "one" }],
        verification: [{ tag: "gating", action: "test", observation: "pass" }],
        nonGoals: ["other"],
        assumedScope: "src",
        implementationApproach: "small change",
        taskChecklist: ["only one"],
      }),
    ).toThrow(/Task checklist/)
  })

  test("mines the first unchecked task-checklist item and ignores other sections", () => {
    const markdown = `# Plan: x

## Goal kind
code-change

## Acceptance criteria
1. AC1: the feature works

## Verification plan
1. gating: test — pass

## Non-goals
- [ ] do not mine this

## Assumed scope
src

## Implementation approach
keep it small

## Task checklist
- [x] already done
- [ ] implement the change
- [ ] verify

## Deviations
- [ ] also ignore
`
    expect(GoalPlan.firstUncheckedTask(markdown)).toBe("implement the change")
  })

  test("digest ignores checklist edits", () => {
    const a = GoalPlan.sample("ship it")
    const b = { ...a, taskChecklist: [...(a.taskChecklist ?? []), "extra"] }
    expect(GoalPlan.digestOf(a)).toBe(GoalPlan.digestOf(b))
    const c = { ...a, acceptance: [{ id: "AC1", text: "different" }] }
    expect(GoalPlan.digestOf(a)).not.toBe(GoalPlan.digestOf(c))
  })
})
