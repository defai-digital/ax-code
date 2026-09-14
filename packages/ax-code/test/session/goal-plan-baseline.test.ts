import { describe, expect, test } from "vitest"
import fs from "fs/promises"
import path from "path"
import { GoalPlanBaseline, BASELINE_PLACEHOLDER } from "../../src/session/goal-plan-baseline"
import type { GoalAssurance } from "../../src/session/goal-assurance"
import { git } from "../../src/util/git"
import { tmpdir } from "../fixture/fixture"

const sessionMinimalDiff =
  'sh -c \'set -e; b=$(git merge-base HEAD origin/main); test -z "$(git diff --name-only --diff-filter=D $b..HEAD -- packages/ax-code/test)"; ! git diff $b..HEAD -- packages/ax-code/test | grep -Eq "^\\\\+.*\\\\.(skip|todo|only)\\\\("; test -z "$(git diff --name-only $b..HEAD | grep -Ev "^(packages/(ax-code|sdk)|script/|docs/|package\\\\.json|pnpm-lock\\\\.yaml|pnpm-workspace\\\\.yaml)")"\''

function contract(command: string): GoalAssurance.Contract {
  return {
    version: 1,
    sourcePaths: ["src"],
    sources: [{ role: "requirement", reference: "User acceptance criteria" }],
    checks: [
      {
        id: "minimal-diff",
        acceptanceIds: ["AC1"],
        command,
        purpose: "Assert the goal diff stays in scope",
        environment: "local git workspace",
      },
    ],
  }
}

describe("GoalPlanBaseline", () => {
  test("rejects the session origin/main merge-base before-state", () => {
    expect(() =>
      GoalPlanBaseline.prepareAssurance(contract(sessionMinimalDiff), {
        objective: "refactor the core runtime then test and commit",
      }),
    ).toThrow(/origin\/main/)
  })

  test("allows a remote-tracking before-state when the objective names that remote", () => {
    const prepared = GoalPlanBaseline.prepareAssurance(contract("git diff --name-only origin/main..HEAD"), {
      objective: "push the fix to origin/main",
    })
    expect(prepared.checks[0]?.command).toBe("git diff --name-only origin/main..HEAD")
  })

  test("rejects @{u} as a before-state", () => {
    expect(() =>
      GoalPlanBaseline.prepareAssurance(contract("git diff --name-only @{u}..HEAD"), {
        objective: "refactor the core runtime then test and commit",
      }),
    ).toThrow(/@\{u\}/)
  })

  test("rejects upstream/main and other non-HEAD range before-states", () => {
    expect(() =>
      GoalPlanBaseline.prepareAssurance(contract("git diff --name-only upstream/main..HEAD"), {
        objective: "refactor the core runtime then test and commit",
      }),
    ).toThrow(/upstream\/main/)
    expect(() =>
      GoalPlanBaseline.prepareAssurance(contract("git merge-base HEAD fork/topic"), {
        objective: "refactor the core runtime then test and commit",
      }),
    ).toThrow(/fork\/topic/)
  })

  test("allows a rewritten SHA range with a pathspec that contains a slash", () => {
    const head = "0bdde3c78c9e8936f3f3be7a66ad44c2c2c52932"
    const prepared = GoalPlanBaseline.prepareAssurance(
      contract(`git diff --name-only ${BASELINE_PLACEHOLDER}..HEAD -- packages/ax-code`),
      { objective: "keep the diff in scope", snapshot: { head, divergedFromTracking: [], dirty: [] } },
    )
    expect(prepared.checks[0]?.command).toBe(`git diff --name-only ${head}..HEAD -- packages/ax-code`)
  })

  test("allows a quoted {BASELINE} after rewrite in merge-base --is-ancestor", () => {
    const head = "0bdde3c78c9e8936f3f3be7a66ad44c2c2c52932"
    const prepared = GoalPlanBaseline.prepareAssurance(
      contract(`git merge-base --is-ancestor "${BASELINE_PLACEHOLDER}" HEAD`),
      { objective: "verify changed files", snapshot: { head, divergedFromTracking: [], dirty: [] } },
    )
    expect(prepared.checks[0]?.command).toBe(`git merge-base --is-ancestor "${head}" HEAD`)
  })

  test("rejects a quoted non-HEAD range before-state", () => {
    expect(() =>
      GoalPlanBaseline.prepareAssurance(contract('git diff --name-only "fork/topic".."HEAD"'), {
        objective: "refactor the core runtime then test and commit",
      }),
    ).toThrow(/fork\/topic/)
  })

  test("does not treat non-git commands or pathspecs as git before-states", () => {
    expect(() =>
      GoalPlanBaseline.prepareAssurance(contract("echo foo..bar"), {
        objective: "refactor the core runtime then test and commit",
      }),
    ).not.toThrow()
    expect(() =>
      GoalPlanBaseline.prepareAssurance(contract("pnpm exec vitest run test/upstream/component.test.ts"), {
        objective: "refactor the core runtime then test and commit",
      }),
    ).not.toThrow()
    const head = "0bdde3c78c9e8936f3f3be7a66ad44c2c2c52932"
    const prepared = GoalPlanBaseline.prepareAssurance(
      contract(`git diff --name-only ${BASELINE_PLACEHOLDER}..HEAD -- origin/generated`),
      { objective: "keep the diff in scope", snapshot: { head, divergedFromTracking: [], dirty: [] } },
    )
    expect(prepared.checks[0]?.command).toContain("-- origin/generated")
    expect(() =>
      GoalPlanBaseline.prepareAssurance(contract("sh -c 'git diff -- foo && git diff origin/main..HEAD'"), {
        objective: "refactor the core runtime then test and commit",
      }),
    ).toThrow(/origin\/main/)
    expect(() =>
      GoalPlanBaseline.prepareAssurance(contract("sh -c 'git diff HEAD -- README.md | git diff origin/main..HEAD'"), {
        objective: "refactor the core runtime then test and commit",
      }),
    ).toThrow(/origin\/main/)
    expect(() =>
      GoalPlanBaseline.prepareAssurance(contract("sh -c -- 'git diff origin/main..HEAD'"), {
        objective: "refactor the core runtime then test and commit",
      }),
    ).toThrow(/origin\/main/)
    expect(() =>
      GoalPlanBaseline.prepareAssurance(
        contract("git diff HEAD -- README.md && git diff origin/main..HEAD -- packages/ax-code"),
        { objective: "refactor the core runtime then test and commit" },
      ),
    ).toThrow(/origin\/main/)
  })

  test("rewrites {BASELINE} to the plan-time HEAD SHA", () => {
    const head = "0bdde3c78c9e8936f3f3be7a66ad44c2c2c52932"
    const prepared = GoalPlanBaseline.prepareAssurance(contract(`git diff --name-only ${BASELINE_PLACEHOLDER}..HEAD`), {
      objective: "keep the diff in scope",
      snapshot: { head, divergedFromTracking: [], dirty: [] },
    })
    expect(prepared.checks[0]?.command).toBe(`git diff --name-only ${head}..HEAD`)
    expect(prepared.checks[0]?.command).not.toContain(BASELINE_PLACEHOLDER)
  })

  test("rejects {BASELINE} when no git HEAD is available", () => {
    expect(() =>
      GoalPlanBaseline.prepareAssurance(contract(`git diff --name-only ${BASELINE_PLACEHOLDER}..HEAD`), {
        objective: "keep the diff in scope",
      }),
    ).toThrow(/no usable HEAD/)
  })

  test("leaves ordinary project checks unchanged", () => {
    const prepared = GoalPlanBaseline.prepareAssurance(contract("pnpm --dir packages/ax-code run typecheck"), {
      objective: "refactor the core runtime then test and commit",
    })
    expect(prepared.checks[0]?.command).toBe("pnpm --dir packages/ax-code run typecheck")
  })

  test("prompt context tells the writer to use {BASELINE} and lists pre-existing divergence", () => {
    const text = GoalPlanBaseline.promptContext({
      head: "abc123",
      branch: "main",
      tracking: "origin/main",
      ahead: 10,
      behind: 0,
      divergedFromTracking: ["README.md"],
      dirty: ["packages/ax-code/ax-code.json"],
    })
    expect(text).toContain("HEAD: abc123")
    expect(text).toContain("ahead 10")
    expect(text).toContain("- README.md")
    expect(text).toContain("- packages/ax-code/ax-code.json")
    expect(text).toContain(BASELINE_PLACEHOLDER)
    expect(GoalPlanBaseline.writerUserText("do the work", text)).toContain("OBJECTIVE:\ndo the work")
  })

  test("snapshots tracking divergence from plan-time HEAD", async () => {
    await using tmp = await tmpdir({ git: true })
    const first = (await git(["rev-parse", "HEAD"], { cwd: tmp.path })).text().trim()
    await fs.writeFile(path.join(tmp.path, "README.md"), "header\n")
    await git(["add", "README.md"], { cwd: tmp.path })
    await git(["commit", "-m", "docs: header"], { cwd: tmp.path })
    await git(["remote", "add", "origin", tmp.path], { cwd: tmp.path })
    await git(["update-ref", "refs/remotes/origin/main", first], { cwd: tmp.path })
    const branch = (await git(["rev-parse", "--abbrev-ref", "HEAD"], { cwd: tmp.path })).text().trim()
    expect((await git(["config", `branch.${branch}.remote`, "origin"], { cwd: tmp.path })).exitCode).toBe(0)
    expect((await git(["config", `branch.${branch}.merge`, "refs/heads/main"], { cwd: tmp.path })).exitCode).toBe(0)
    const snap = await GoalPlanBaseline.snapshot(tmp.path)
    expect(snap.head).toMatch(/^[0-9a-f]{40}$/)
    expect(snap.head).not.toBe(first)
    expect(snap.tracking).toBe("origin/main")
    expect(snap.ahead).toBe(1)
    expect(snap.divergedFromTracking).toContain("README.md")
    const context = GoalPlanBaseline.promptContext(snap)
    expect(context).toContain("README.md")
    expect(context).toContain(snap.head)
  })
})
