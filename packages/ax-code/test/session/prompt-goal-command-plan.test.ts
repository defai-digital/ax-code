import { describe, expect, test } from "vitest"
import { Instance } from "../../src/project/instance"
import { Session } from "../../src/session"
import { SessionGoal } from "../../src/session/goal"
import { GoalPlan } from "../../src/session/goal-plan"
import { GoalPlanWriter } from "../../src/session/goal-plan-writer"
import { executeGoalCommand } from "../../src/session/prompt-goal-command"
import type { PromptInput } from "../../src/session/prompt-input"
import { tmpdir } from "../fixture/fixture"

const model = {
  providerID: "test",
  modelID: "test-model",
}

describe("executeGoalCommand plan writer", () => {
  test("create writes a plan before invoking the implementer", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        let writerCalls = 0
        GoalPlanWriter.setWrite(async (input) => {
          writerCalls++
          return GoalPlanWriter.stubWrite()(input)
        })
        const session = await Session.create({})
        const prompts: PromptInput[] = []
        const result = await executeGoalCommand(
          {
            sessionID: session.id,
            command: "goal",
            arguments: "add a health endpoint",
            agent: "build",
            model: "test/test-model",
          },
          async (input) => {
            prompts.push(input)
            return {
              info: {
                id: "msg_goal_plan" as any,
                sessionID: session.id,
                role: "assistant",
                time: { created: Date.now() },
                agent: "build",
                model,
              },
              parts: [],
            } as any
          },
        )
        expect(writerCalls).toBe(1)
        expect(prompts).toHaveLength(1)
        expect(prompts[0]?.parts.some((part) => part.type === "text" && part.text.includes("source of truth"))).toBe(
          true,
        )
        const goal = await SessionGoal.get(session.id)
        expect(goal?.status).toBe("active")
        expect(GoalPlan.hasValidContract(session.id, goal!.time.created)).toBe(true)
        expect(result.info.role).toBe("assistant")
        await Session.remove(session.id)
      },
    })
  })

  test("writer failure does not invoke the implementer", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        GoalPlanWriter.setWrite(async () => {
          throw new GoalPlan.Error("writer", "planner down")
        })
        const session = await Session.create({})
        const prompts: PromptInput[] = []
        const result = await executeGoalCommand(
          {
            sessionID: session.id,
            command: "goal",
            arguments: "this must stay paused",
            agent: "build",
            model: "test/test-model",
          },
          async (input) => {
            prompts.push(input)
            return { info: { role: "assistant" }, parts: [] } as any
          },
        )
        expect(prompts).toHaveLength(0)
        expect(result.parts.some((part) => part.type === "text" && part.text.includes("planner down"))).toBe(true)
        expect((await SessionGoal.get(session.id))?.status).toBe("paused")
        await Session.remove(session.id)
      },
    })
  })

  test("duplicate create does not call the writer", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        let writerCalls = 0
        GoalPlanWriter.setWrite(async (input) => {
          writerCalls++
          return GoalPlanWriter.stubWrite()(input)
        })
        const session = await Session.create({})
        await executeGoalCommand(
          {
            sessionID: session.id,
            command: "goal",
            arguments: "first",
            agent: "build",
            model: "test/test-model",
          },
          async () => ({ info: { role: "assistant" }, parts: [] }) as any,
        )
        writerCalls = 0
        const duplicate = await executeGoalCommand(
          {
            sessionID: session.id,
            command: "goal",
            arguments: "second",
            agent: "build",
            model: "test/test-model",
          },
          async () => ({ info: { role: "assistant" }, parts: [] }) as any,
        )
        expect(writerCalls).toBe(0)
        expect(
          duplicate.parts.some((part) => part.type === "text" && part.text.includes("already has an active goal")),
        ).toBe(true)
        await Session.remove(session.id)
      },
    })
  })
})
