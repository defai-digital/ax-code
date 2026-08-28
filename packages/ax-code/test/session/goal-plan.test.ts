import { describe, expect, test, vi } from "vitest"
import fs from "fs"
import { GoalPlan } from "../../src/session/goal-plan"
import { Instance } from "../../src/project/instance"
import { Session } from "../../src/session"
import { tmpdir } from "../fixture/fixture"

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

  test("collapses embedded newlines so multi-line fields round-trip", () => {
    const contract = GoalPlan.fromFields({
      kind: "code-change",
      title: "fix the login bug\nand add a regression test",
      acceptance: [{ text: "login works\nand stays fast" }],
      verification: [
        {
          tag: "gating",
          action: "run pnpm test\nthen typecheck",
          observation: "both pass\nwith no warnings",
        },
      ],
      nonGoals: ["no refactors\nno new deps"],
      assumedScope: "src/session\ntest/session",
      implementationApproach: "keep it small\nno new helpers",
      taskChecklist: ["implement the fix\nwith care", "run verification"],
      risks: ["flaky test\non windows"],
    })

    // Fields are single-line after construction, so the line-based render
    // format parses back to the identical contract and digest.
    expect(contract.acceptance).toEqual([{ id: "AC1", text: "login works and stays fast" }])
    expect(contract.verification).toEqual([
      { tag: "gating", action: "run pnpm test then typecheck", observation: "both pass with no warnings" },
    ])
    expect(contract.nonGoals).toEqual(["no refactors no new deps"])

    const parsed = GoalPlan.parse(GoalPlan.render(contract))
    expect(parsed).toEqual(contract)
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

describe("GoalPlan persistence", () => {
  test("publishes the digest before the plan", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({})
        const created = Date.now()
        const published: string[] = []
        const rename = fs.promises.rename.bind(fs.promises)
        const spy = vi.spyOn(fs.promises, "rename").mockImplementation(async (from, to) => {
          published.push(String(to))
          return rename(from, to)
        })
        try {
          await GoalPlan.write(session.id, created, GoalPlan.render(GoalPlan.sample("ship the feature")))
        } finally {
          spy.mockRestore()
        }
        const plan = GoalPlan.pathFor(session.id, created)
        const digest = GoalPlan.digestPathFor(session.id, created)
        expect(published.indexOf(digest)).toBeGreaterThanOrEqual(0)
        expect(published.indexOf(plan)).toBeGreaterThan(published.indexOf(digest))
        expect(GoalPlan.hasValidContract(session.id, created)).toBe(true)
        await GoalPlan.remove(session.id, created)
        await Session.remove(session.id)
      },
    })
  })

  test("leaves a lone digest when the plan publish fails", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({})
        const created = Date.now()
        const plan = GoalPlan.pathFor(session.id, created)
        const digest = GoalPlan.digestPathFor(session.id, created)
        const rename = fs.promises.rename.bind(fs.promises)
        const spy = vi.spyOn(fs.promises, "rename").mockImplementation(async (from, to) => {
          if (String(to) === plan) throw new Error("disk full")
          return rename(from, to)
        })
        try {
          await expect(
            GoalPlan.write(session.id, created, GoalPlan.render(GoalPlan.sample("ship the feature"))),
          ).rejects.toThrow(/disk full/)
        } finally {
          spy.mockRestore()
        }
        expect(GoalPlan.storedDigest(session.id, created)).toBeTruthy()
        expect(GoalPlan.read(session.id, created).status).toBe("missing")
        expect(GoalPlan.hasValidContract(session.id, created)).toBe(false)
        expect(await fs.promises.stat(plan).catch((error: NodeJS.ErrnoException) => error.code)).toBe("ENOENT")
        expect(
          await fs.promises.stat(`${plan}.${process.pid}.tmp`).catch((error: NodeJS.ErrnoException) => error.code),
        ).toBe("ENOENT")
        expect(
          await fs.promises.stat(`${digest}.${process.pid}.tmp`).catch((error: NodeJS.ErrnoException) => error.code),
        ).toBe("ENOENT")
        await GoalPlan.remove(session.id, created)
        await Session.remove(session.id)
      },
    })
  })
})
