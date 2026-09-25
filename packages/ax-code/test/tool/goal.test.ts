import { describe, expect, test } from "vitest"
import { Instance } from "../../src/project/instance"
import { Session } from "../../src/session"
import { SessionGoal } from "../../src/session/goal"
import { MessageID } from "../../src/session/schema"
import { CreateGoalTool, GetGoalTool, UpdateGoalTool } from "../../src/tool/goal"
import { GoalPlanWriter } from "../../src/session/goal-plan-writer"
import { tmpdir } from "../fixture/fixture"

function toolContext(sessionID: string, _directory: string) {
  return {
    sessionID: sessionID as any,
    messageID: MessageID.ascending(),
    agent: "build",
    abort: new AbortController().signal,
    messages: [],
    extra: { model: { id: "test-model", providerID: "test" } },
    metadata() {},
    async ask() {},
  }
}

describe("goal tools", () => {
  test("create_goal coerces tokenBudget from string values", async () => {
    const tool = await CreateGoalTool.init()

    const parsed = tool.parameters.parse({
      objective: "finish goal tool schema test",
      tokenBudget: "100",
    })

    expect(parsed.tokenBudget).toBe(100)
  })

  test("create_goal rejects non-decimal token budgets", async () => {
    const tool = await CreateGoalTool.init()

    expect(() =>
      tool.parameters.parse({
        objective: "finish goal tool schema test",
        tokenBudget: "0x100",
      }),
    ).toThrow()
    expect(() =>
      tool.parameters.parse({
        objective: "finish goal tool schema test",
        tokenBudget: "1e3",
      }),
    ).toThrow()
  })

  test("create, read, and update a durable session goal", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({})
        GoalPlanWriter.setWrite(GoalPlanWriter.stubWrite())
        const ctx = toolContext(session.id, tmp.path)

        const create = await (
          await CreateGoalTool.init()
        ).execute({ objective: "finish goal tool tests", tokenBudget: 100 }, ctx)
        expect(create.output).toContain("finish goal tool tests")
        expect((await SessionGoal.get(session.id))?.status).toBe("active")

        const get = await (await GetGoalTool.init()).execute({}, ctx)
        expect(get.output).toContain("remainingTokens")

        const update = await (
          await UpdateGoalTool.init()
        ).execute({ status: "complete", acceptanceEvidence: { AC1: "no files changed in this test" } }, ctx)
        expect(update.output).toContain("completionBudgetReport")
        expect((await SessionGoal.get(session.id))?.status).toBe("complete")

        await Session.remove(session.id)
      },
    })
  })

  test("create_goal refuses to replace an active goal", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({})
        GoalPlanWriter.setWrite(GoalPlanWriter.stubWrite())
        const ctx = toolContext(session.id, tmp.path)
        const tool = await CreateGoalTool.init()

        await tool.execute({ objective: "first goal" }, ctx)
        await expect(tool.execute({ objective: "second goal" }, ctx)).rejects.toThrow("already has an active goal")

        await Session.remove(session.id)
      },
    })
  })
})

describe("create_goal assurance is opt-in (item 2, option A)", () => {
  test("starts immediately without a contract unless assure is set", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        let writerCalls = 0
        GoalPlanWriter.setWrite(async (input) => {
          writerCalls++
          return GoalPlanWriter.stubWrite()(input)
        })
        try {
          const session = await Session.create({})
          const tool = await CreateGoalTool.init()
          const result = await tool.execute({ objective: "keep main green" } as never, toolContext(session.id, tmp.path) as never)

          expect(writerCalls).toBe(0)
          const goal = await SessionGoal.get(session.id)
          expect(goal?.status).toBe("active")
          expect((result.metadata as any).planPath).toBeUndefined()
          expect((result.metadata as any).goal.planPath).toBeUndefined()
        } finally {
          GoalPlanWriter.resetWrite()
        }
      },
    })
  })

  test("assure plans first and reports the plan path", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        let writerCalls = 0
        GoalPlanWriter.setWrite(async (input) => {
          writerCalls++
          return GoalPlanWriter.stubWrite()(input)
        })
        try {
          const session = await Session.create({})
          const tool = await CreateGoalTool.init()
          const result = await tool.execute(
            { objective: "ship the feature", assure: true } as never,
            toolContext(session.id, tmp.path) as never,
          )

          expect(writerCalls).toBe(1)
          const goal = await SessionGoal.get(session.id)
          expect(goal?.status).toBe("active")
          expect((result.metadata as any).planPath).toBeTruthy()
        } finally {
          GoalPlanWriter.resetWrite()
        }
      },
    })
  })
})
