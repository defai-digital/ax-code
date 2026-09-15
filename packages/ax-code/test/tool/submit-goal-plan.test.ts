import fs from "node:fs/promises"
import path from "node:path"
import { VerificationPolicy } from "../../src/session/verification-policy"
import { describe, expect, test } from "vitest"
import { SubmitGoalPlanTool } from "../../src/tool/submit_goal_plan"
import { GoalPlan } from "../../src/session/goal-plan"
import { MessageID } from "../../src/session/schema"
import type { GoalAssurance } from "../../src/session/goal-assurance"
import { Instance } from "../../src/project/instance"
import { Session } from "../../src/session"
import { SessionGoal } from "../../src/session/goal"
import { git } from "../../src/util/git"
import { tmpdir } from "../fixture/fixture"

const assurance: GoalAssurance.Contract = {
  version: 1,
  sourcePaths: ["src"],
  sources: [{ role: "requirement", reference: "User acceptance criteria" }],
  checks: [
    {
      id: "tests",
      acceptanceIds: ["AC1"],
      command: "node check.cjs",
      purpose: "Assert acceptance",
      environment: "local fixture",
    },
  ],
}

describe("submit_goal_plan", () => {
  test("new code-change plans cannot omit executable assurance", async () => {
    const tool = await SubmitGoalPlanTool.init()
    await expect(
      tool.execute(
        {
          kind: "code-change",
          acceptance: ["Feature works"],
          verification: [{ tag: "gating", action: "inspect", observation: "works" }],
          nonGoals: ["other features"],
          assumedScope: "src",
          implementationApproach: "Implement",
          taskChecklist: ["Implement", "Verify"],
        },
        {
          sessionID: "ses_test" as any,
          messageID: MessageID.ascending(),
          agent: "goal-plan-writer",
          abort: new AbortController().signal,
          messages: [],
          metadata() {},
          async ask() {},
        },
      ),
    ).rejects.toThrow(/require assurance/)
  })
  test("renders a canonical contract", async () => {
    const tool = await SubmitGoalPlanTool.init()
    const result = await tool.execute(
      {
        kind: "code-change",
        assurance,
        title: "Add health endpoint",
        acceptance: ["GET /health returns 200"],
        verification: [{ tag: "gating", action: "curl the endpoint", observation: "HTTP 200" }],
        nonGoals: ["metrics"],
        assumedScope: "src/server",
        implementationApproach: "Add a route next to the existing ping handler.",
        taskChecklist: ["Find the router", "Add the route", "Verify"],
      },
      {
        sessionID: "ses_test" as any,
        messageID: MessageID.ascending(),
        agent: "goal-plan-writer",
        abort: new AbortController().signal,
        messages: [],
        extra: {},
        metadata() {},
        async ask() {},
      },
    )
    const parsed = GoalPlan.parse(result.output)
    expect(parsed.kind).toBe("code-change")
    expect(parsed.acceptance[0]?.id).toBe("AC1")
    expect(parsed.acceptance[0]?.text).toContain("GET /health")
  })

  test("rejects a rendered plan over the read cap with an actionable error", async () => {
    const tool = await SubmitGoalPlanTool.init()
    const params = {
      kind: "code-change" as const,
      assurance: {
        ...assurance,
        checks: [{ ...assurance.checks[0], acceptanceIds: ["AC1", "AC2", "AC3", "AC4", "AC5"] }],
      },
      title: "A very verbose plan",
      acceptance: Array.from({ length: 5 }, (_, index) => `Criterion ${index}: ${"outcome ".repeat(120)}`),
      verification: Array.from({ length: 8 }, (_, index) => ({
        tag: "gating" as const,
        action: `Step ${index}: ${"run the verification suite and inspect ".repeat(60)}`,
        observation: `Observation ${index}: ${"all checks pass and the output shows ".repeat(60)}`,
      })),
      nonGoals: ["unrelated refactors"],
      assumedScope: "src",
      implementationApproach: "Approach: ".concat("describe the work in detail ".repeat(200)),
      taskChecklist: Array.from(
        { length: 8 },
        (_, index) => `Task ${index}: ${"perform the implementation step ".repeat(60)}`,
      ),
    }
    const ctx = {
      sessionID: "ses_test" as any,
      messageID: MessageID.ascending(),
      agent: "goal-plan-writer",
      abort: new AbortController().signal,
      messages: [],
      extra: {},
      metadata() {},
      async ask() {},
    }
    const before = JSON.stringify(params)
    const failure = await tool.execute(params, ctx).catch((error: unknown) => error)
    expect(failure).toBeInstanceOf(Error)
    const message = (failure as Error).message
    expect(message).toMatch(new RegExp(`exceeding the ${GoalPlan.MAX_READ_BYTES}-byte limit`))
    expect(message).toContain('kind="code-change"')
    expect(message).toContain("COMPLETE object")
    expect(message).toContain("Keep every acceptance id and required check")
    const bytes = Number(message.match(/plan is (\d+) bytes/)?.[1])
    expect(message).toContain(`remove at least ${bytes - GoalPlan.MAX_READ_BYTES} bytes`)
    expect(JSON.stringify(params)).toBe(before)
  })

  test("accepts a plan just under the read cap", async () => {
    const tool = await SubmitGoalPlanTool.init()
    const result = await tool.execute(
      {
        kind: "code-change",
        assurance,
        title: "A large but compact plan",
        acceptance: ["The feature works end to end"],
        verification: [{ tag: "gating", action: "run the test suite", observation: "all checks pass" }],
        nonGoals: ["unrelated refactors"],
        assumedScope: "src",
        implementationApproach: "Details: ".concat("step ".repeat(900)),
        taskChecklist: ["Implement", "Verify"],
      },
      {
        sessionID: "ses_test" as any,
        messageID: MessageID.ascending(),
        agent: "goal-plan-writer",
        abort: new AbortController().signal,
        messages: [],
        extra: {},
        metadata() {},
        async ask() {},
      },
    )
    expect(Buffer.byteLength(result.output, "utf8")).toBeLessThanOrEqual(GoalPlan.MAX_READ_BYTES)
    expect(() => GoalPlan.parse(result.output)).not.toThrow()
  })

  test("opts out of generic output truncation so the persisted plan stays intact", async () => {
    // A plan of many tiny single-character non-goals can stay under the byte
    // cap while exceeding the generic 2000-line truncation threshold. Without
    // the bypass, the tool part stored for the orchestrator would lose its
    // tail sections and GoalPlan.write would fail (or freeze a truncated
    // contract) only after the writer session has stopped.
    const tool = await SubmitGoalPlanTool.init()
    const result = await tool.execute(
      {
        kind: "analysis",
        title: "x",
        acceptance: ["a"],
        verification: [{ tag: "gating", action: "a", observation: "a" }],
        nonGoals: Array.from({ length: 1985 }, () => "a"),
        assumedScope: "a",
        implementationApproach: "a",
        taskChecklist: ["a", "b"],
      },
      {
        sessionID: "ses_test" as any,
        messageID: MessageID.ascending(),
        agent: "goal-plan-writer",
        abort: new AbortController().signal,
        messages: [],
        extra: {},
        metadata() {},
        async ask() {},
      },
    )
    const { Truncate } = await import("../../src/tool/truncate")
    expect(Buffer.byteLength(result.output, "utf8")).toBeLessThanOrEqual(GoalPlan.MAX_READ_BYTES)
    expect(result.output.split("\n").length).toBeGreaterThan(Truncate.MAX_LINES)
    expect(result.metadata.truncated).toBe(false)
    expect(result.output).toContain("## Assumed scope")
    expect(() => GoalPlan.parse(result.output)).not.toThrow()
  })

  test("rejects a remote-tracking git before-state unless the objective names that remote", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const tool = await SubmitGoalPlanTool.init()
        const ctx = {
          sessionID: "ses_test" as any,
          messageID: MessageID.ascending(),
          agent: "goal-plan-writer",
          abort: new AbortController().signal,
          messages: [],
          extra: {},
          metadata() {},
          async ask() {},
        }
        await expect(
          tool.execute(
            {
              kind: "code-change",
              assurance: {
                ...assurance,
                checks: [
                  {
                    ...assurance.checks[0],
                    command: "sh -c 'b=$(git merge-base HEAD origin/main); git diff --name-only $b..HEAD'",
                  },
                ],
              },
              title: "Refactor core",
              acceptance: ["The change stays in scope"],
              verification: [{ tag: "gating", action: "inspect the diff", observation: "only declared paths" }],
              nonGoals: ["unrelated refactors"],
              assumedScope: "src",
              implementationApproach: "Keep it small",
              taskChecklist: ["Implement", "Verify"],
            },
            ctx,
          ),
        ).rejects.toThrow(/origin\/main/)
      },
    })
  })

  test("rewrites {BASELINE} to HEAD and freezes that SHA", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const head = (await git(["rev-parse", "HEAD"], { cwd: tmp.path })).text().trim()
        const session = await Session.create({})
        await SessionGoal.create({ sessionID: session.id, objective: "keep the diff in scope then test and commit" })
        const tool = await SubmitGoalPlanTool.init()
        const result = await tool.execute(
          {
            kind: "code-change",
            assurance: {
              ...assurance,
              checks: [
                {
                  ...assurance.checks[0],
                  command: "sh -c 'git diff --name-only {BASELINE}..HEAD'",
                },
              ],
            },
            title: "Keep the diff in scope",
            acceptance: ["Changed paths stay in scope"],
            verification: [{ tag: "gating", action: "inspect the diff", observation: "only declared paths" }],
            nonGoals: ["unrelated refactors"],
            assumedScope: "src",
            implementationApproach: "Keep it small",
            taskChecklist: ["Implement", "Verify"],
          },
          {
            sessionID: session.id,
            messageID: MessageID.ascending(),
            agent: "goal-plan-writer",
            abort: new AbortController().signal,
            messages: [],
            extra: {},
            metadata() {},
            async ask() {},
          },
        )
        expect(result.output).toContain(`git diff --name-only ${head}..HEAD`)
        expect(result.output).not.toContain("{BASELINE}")
        await Session.remove(session.id)
      },
    })
  })

  test("uses the parent session objective when the writer is a child", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const parent = await Session.create({})
        await SessionGoal.create({ sessionID: parent.id, objective: "push the fix to origin/main" })
        const child = await Session.create({ parentID: parent.id, title: "Goal plan writer" })
        const tool = await SubmitGoalPlanTool.init()
        const result = await tool.execute(
          {
            kind: "code-change",
            assurance: {
              ...assurance,
              checks: [
                {
                  ...assurance.checks[0],
                  command: "sh -c 'git diff --name-only origin/main..HEAD'",
                },
              ],
            },
            title: "Push the fix",
            acceptance: ["HEAD matches origin/main"],
            verification: [{ tag: "gating", action: "compare HEAD to origin/main", observation: "they match" }],
            nonGoals: ["unrelated refactors"],
            assumedScope: "src",
            implementationApproach: "Keep it small",
            taskChecklist: ["Implement", "Verify"],
          },
          {
            sessionID: child.id,
            messageID: MessageID.ascending(),
            agent: "goal-plan-writer",
            abort: new AbortController().signal,
            messages: [],
            extra: {},
            metadata() {},
            async ask() {},
          },
        )
        expect(result.output).toContain("origin/main")
        await Session.remove(child.id)
        await Session.remove(parent.id)
      },
    })
  })
})

test.each([
  { command: "test -s review.md", error: "only establish file presence" },
  { command: 'test -n "$(git log --format=%h 1234567..HEAD -- src)"', error: "only establish matching git log output" },
])("rejects weak new checks while preserving frozen digest: $command", async ({ command, error }) => {
  const legacy = {
    ...GoalPlan.sample("Review fixes"),
    assurance: {
      ...assurance,
      checks: [{ ...assurance.checks[0], command }],
    },
  }
  const originalDigest = GoalPlan.digestOf(legacy)
  expect(GoalPlan.digestOf(GoalPlan.parse(GoalPlan.render(legacy)))).toBe(originalDigest)
  const tool = await SubmitGoalPlanTool.init()
  await expect(
    tool.execute(
      {
        kind: "code-change",
        assurance: legacy.assurance,
        acceptance: ["Review completed"],
        verification: [{ tag: "gating", action: "Validate review", observation: "Successful review" }],
        nonGoals: ["Other changes"],
        assumedScope: "src",
        implementationApproach: "Review then fix",
        taskChecklist: ["Review", "Verify"],
      },
      {
        sessionID: "ses_test" as any,
        messageID: MessageID.ascending(),
        agent: "goal-plan-writer",
        abort: new AbortController().signal,
        messages: [],
        metadata() {},
        async ask() {},
      },
    ),
  ).rejects.toThrow(error)
})

test("mixed-scope commits pass the old filtered log assertion and are recognized by the new guard", async () => {
  await using tmp = await tmpdir({ git: true })
  const baseline = (await git(["rev-parse", "HEAD"], { cwd: tmp.path })).text().trim()
  await fs.mkdir(path.join(tmp.path, "src"))
  await fs.writeFile(path.join(tmp.path, "src/fix.ts"), "export const fixed = true\n")
  await fs.writeFile(path.join(tmp.path, "unrelated.txt"), "outside the declared scope\n")
  await git(["add", "src/fix.ts", "unrelated.txt"], { cwd: tmp.path })
  const commit = await git(["commit", "-m", "Fix source and include unrelated data"], { cwd: tmp.path })
  expect(commit.exitCode).toBe(0)
  const log = await git(["log", "--format=%h", `${baseline}..HEAD`, "--", "src"], { cwd: tmp.path })
  expect(log.exitCode).toBe(0)
  expect(log.text().trim()).not.toBe("")
  const paths = await git(["diff-tree", "--no-commit-id", "--name-only", "-r", "HEAD"], { cwd: tmp.path })
  expect(paths.text()).toContain("unrelated.txt")
  expect(
    VerificationPolicy.isGitLogPresenceOnlyCommand(`test -n "$(git log --format=%h ${baseline}..HEAD -- src)"`),
  ).toBe(true)
})
