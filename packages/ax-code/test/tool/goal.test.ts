import { describe, expect, test } from "bun:test"
import { Instance } from "../../src/project/instance"
import { Session } from "../../src/session"
import { SessionGoal } from "../../src/session/goal"
import { MessageID } from "../../src/session/schema"
import { CreateGoalTool, GetGoalTool, UpdateGoalTool } from "../../src/tool/goal"
import { tmpdir } from "../fixture/fixture"

function toolContext(sessionID: string, directory: string) {
  return {
    sessionID: sessionID as any,
    messageID: MessageID.ascending(),
    agent: "build",
    abort: new AbortController().signal,
    messages: [],
    extra: {},
    metadata() {},
    async ask() {},
  }
}

describe("goal tools", () => {
  test("create, read, and update a durable session goal", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({})
        const ctx = toolContext(session.id, tmp.path)

        const create = await (
          await CreateGoalTool.init()
        ).execute({ objective: "finish goal tool tests", tokenBudget: 100 }, ctx)
        expect(create.output).toContain("finish goal tool tests")
        expect((await SessionGoal.get(session.id))?.status).toBe("active")

        const get = await (await GetGoalTool.init()).execute({}, ctx)
        expect(get.output).toContain("remainingTokens")

        const update = await (await UpdateGoalTool.init()).execute({ status: "complete" }, ctx)
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
        const ctx = toolContext(session.id, tmp.path)
        const tool = await CreateGoalTool.init()

        await tool.execute({ objective: "first goal" }, ctx)
        await expect(tool.execute({ objective: "second goal" }, ctx)).rejects.toThrow("already has an active goal")

        await Session.remove(session.id)
      },
    })
  })
})
