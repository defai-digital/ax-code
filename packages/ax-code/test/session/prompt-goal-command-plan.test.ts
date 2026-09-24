import { describe, expect, test, vi } from "vitest"
import { Instance } from "../../src/project/instance"
import { Session } from "../../src/session"
import { SessionGoal } from "../../src/session/goal"
import { GoalPlan } from "../../src/session/goal-plan"
import { GoalPlanOrchestration } from "../../src/session/goal-plan-orchestration"
import { GoalPlanWriter } from "../../src/session/goal-plan-writer"
import { SessionPrompt } from "../../src/session/prompt"
import { executeGoalCommand } from "../../src/session/prompt/prompt-goal-command"
import type { PromptInput } from "../../src/session/prompt/prompt-input"
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
        expect(duplicate.parts.some((part) => part.type === "text" && part.text.includes("/goal replace"))).toBe(true)
        await Session.remove(session.id)
      },
    })
  })

  test("resume cancels an in-flight run before reactivating the goal", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        GoalPlanWriter.setWrite(GoalPlanWriter.stubWrite())
        const session = await Session.create({})
        const prepared = await GoalPlanOrchestration.activate({
          sessionID: session.id,
          objective: "resume while busy",
        })
        await SessionGoal.pause(session.id)
        // Force the busy branch: resume must cancel the running turn (like
        // create and revise) or the reactivated goal sits dormant.
        const busySpy = vi.spyOn(SessionPrompt, "assertNotBusy").mockImplementation(() => {
          throw new Session.BusyError(session.id)
        })
        const cancelSpy = vi.spyOn(SessionPrompt, "cancel").mockResolvedValue(undefined as any)
        const prompts: PromptInput[] = []
        try {
          await executeGoalCommand(
            {
              sessionID: session.id,
              command: "goal",
              arguments: "resume",
              agent: "build",
              model: "test/test-model",
            },
            async (input) => {
              prompts.push(input)
              return { info: { role: "assistant" }, parts: [] } as any
            },
          )
          expect(cancelSpy).toHaveBeenCalledTimes(1)
          expect(prompts).toHaveLength(1)
          expect(prepared.goal.status).toBe("active")
          expect((await SessionGoal.get(session.id))?.status).toBe("active")
        } finally {
          cancelSpy.mockRestore()
          busySpy.mockRestore()
          GoalPlanWriter.resetWrite()
          await Session.remove(session.id)
        }
      },
    })
  })

  test("a fresh create supersedes a paused goal that never got a plan", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        GoalPlanWriter.setWrite(async () => {
          throw new GoalPlan.Error("writer", "planner down")
        })
        const session = await Session.create({})
        await executeGoalCommand(
          {
            sessionID: session.id,
            command: "goal",
            arguments: "first attempt",
            agent: "build",
            model: "test/test-model",
          },
          async () => ({ info: { role: "assistant" }, parts: [] }) as any,
        )
        // The fail-closed writer leaves a paused goal with no contract; giving
        // the goal again must supersede it instead of rejecting the session.
        expect((await SessionGoal.get(session.id))?.status).toBe("paused")
        GoalPlanWriter.setWrite(GoalPlanWriter.stubWrite())
        const prompts: PromptInput[] = []
        await executeGoalCommand(
          {
            sessionID: session.id,
            command: "goal",
            arguments: "second attempt",
            agent: "build",
            model: "test/test-model",
          },
          async (input) => {
            prompts.push(input)
            return { info: { role: "assistant" }, parts: [] } as any
          },
        )
        expect(prompts).toHaveLength(1)
        const goal = await SessionGoal.get(session.id)
        expect(goal?.status).toBe("active")
        expect(goal?.objective).toBe("second attempt")
        expect(GoalPlan.hasValidContract(session.id, goal!.time.created)).toBe(true)
        await Session.remove(session.id)
      },
    })
  })

  test("replace supersedes an active goal and rewrites the plan", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        GoalPlanWriter.setWrite(GoalPlanWriter.stubWrite())
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
        let writerCalls = 0
        GoalPlanWriter.setWrite(async (input) => {
          writerCalls++
          return GoalPlanWriter.stubWrite()(input)
        })
        const prompts: PromptInput[] = []
        await executeGoalCommand(
          {
            sessionID: session.id,
            command: "goal",
            arguments: "replace second",
            agent: "build",
            model: "test/test-model",
          },
          async (input) => {
            prompts.push(input)
            return { info: { role: "assistant" }, parts: [] } as any
          },
        )
        expect(writerCalls).toBe(1)
        expect(prompts).toHaveLength(1)
        const goal = await SessionGoal.get(session.id)
        expect(goal?.objective).toBe("second")
        expect(goal?.status).toBe("active")
        expect(GoalPlan.hasValidContract(session.id, goal!.time.created)).toBe(true)
        await Session.remove(session.id)
      },
    })
  })

  test("a paused goal with a frozen plan blocks a bare create with actionable guidance", async () => {
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
        await executeGoalCommand(
          {
            sessionID: session.id,
            command: "goal",
            arguments: "pause",
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
        const text = duplicate.parts.find((part) => part.type === "text")
        expect(text?.type === "text" && text.text.includes("paused goal with a frozen plan")).toBe(true)
        expect(text?.type === "text" && text.text.includes("/goal resume")).toBe(true)
        expect(text?.type === "text" && text.text.includes("/goal replace")).toBe(true)
        expect((await SessionGoal.get(session.id))?.objective).toBe("first")
        await Session.remove(session.id)
      },
    })
  })
})
