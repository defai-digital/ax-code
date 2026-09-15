import { afterEach, expect, test, vi } from "vitest"
import { Instance } from "../../src/project/instance"
import { ModelID, ProviderID } from "../../src/provider/schema"
import { Session } from "../../src/session"
import { SessionGoal } from "../../src/session/goal"
import { GoalPlan } from "../../src/session/goal-plan"
import { GoalPlanWriter } from "../../src/session/goal-plan-writer"
import { GoalPlanOrchestration } from "../../src/session/goal-plan-orchestration"
import { SessionPrompt } from "../../src/session/prompt"
import { createStoppedAssistantTextResponse } from "../../src/session/prompt/prompt-assistant-response"
import { MessageID, PartID, type SessionID } from "../../src/session/schema"
import { tmpdir } from "../fixture/fixture"

const model = { providerID: ProviderID.make("test"), modelID: ModelID.make("test-model") }

async function response(sessionID: SessionID, error?: string) {
  return createStoppedAssistantTextResponse({
    sessionID,
    parent: { id: MessageID.ascending(), agent: "goal-plan-writer", model },
    text: error ?? "No submission",
    error: error ? { name: "UnknownError", data: { message: error } } : undefined,
  })
}

afterEach(() => vi.restoreAllMocks())

test("resolved child failure reaches the parent and leaves the goal paused without a contract", async () => {
  await using tmp = await tmpdir({ git: true })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const session = await Session.create({})
      let childID: SessionID | undefined
      const detail =
        "Agent reached the per-agent model-turn limit (12 model turns) and the continuation budget is exhausted (3 continuations used)."
      vi.spyOn(SessionPrompt, "prompt").mockImplementation(async (input) => {
        childID = input.sessionID
        return response(input.sessionID, detail)
      })
      await expect(
        GoalPlanOrchestration.activate({ sessionID: session.id, objective: "Fix bugs", model }),
      ).rejects.toThrow(detail)
      expect(childID).toBeDefined()
      const goal = await SessionGoal.get(session.id)
      expect(goal?.status).toBe("paused")
      expect(GoalPlan.hasValidContract(session.id, goal!.time.created)).toBe(false)
    },
  })
})

test("a recovered historical error does not replace the missing-submission diagnosis", async () => {
  await using tmp = await tmpdir({ git: true })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const session = await Session.create({})
      vi.spyOn(SessionPrompt, "prompt").mockImplementation(async (input) => {
        await response(input.sessionID, "Transient earlier failure")
        return response(input.sessionID)
      })
      await expect(GoalPlanWriter.write({ sessionID: session.id, objective: "Fix bugs", model })).rejects.toThrow(
        "finished without submit_goal_plan",
      )
    },
  })
})

test.each([false, true])("completed submission survives later failure (thrown=%s)", async (thrown) => {
  await using tmp = await tmpdir({ git: true })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const session = await Session.create({})
      const markdown = GoalPlan.render(GoalPlan.sample("Fix bugs"))
      vi.spyOn(SessionPrompt, "prompt").mockImplementation(async (input) => {
        const submitted = await response(input.sessionID)
        await Session.updatePart({
          id: PartID.ascending(),
          messageID: submitted.info.id,
          sessionID: input.sessionID,
          type: "tool",
          tool: "submit_goal_plan",
          callID: "submit",
          state: {
            status: "completed",
            input: {},
            output: markdown,
            title: "Goal plan",
            metadata: {},
            time: { start: 1, end: 2 },
          },
        })
        if (thrown) throw new Error("Stream closed after submission")
        return response(input.sessionID, "Model-turn limit reached after submission")
      })
      await expect(GoalPlanWriter.write({ sessionID: session.id, objective: "Fix bugs", model })).resolves.toBe(
        markdown,
      )
    },
  })
})

test.each([false, true])(
  "rejected submission reports validation details even with a terminal limit (limit=%s)",
  async (limit) => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({})
        vi.spyOn(SessionPrompt, "prompt").mockImplementation(async (input) => {
          const submitted = await response(input.sessionID)
          await Session.updatePart({
            id: PartID.ascending(),
            messageID: submitted.info.id,
            sessionID: input.sessionID,
            type: "tool",
            tool: "submit_goal_plan",
            callID: "rejected",
            state: {
              status: "error",
              input: {},
              error: "Code-change plans require assurance",
              time: { start: 1, end: 2 },
            },
          })
          return response(input.sessionID, limit ? "Model-turn limit reached" : undefined)
        })
        await expect(
          GoalPlanOrchestration.activate({ sessionID: session.id, objective: "Fix bugs", model }),
        ).rejects.toThrow("submit_goal_plan rejected the plan: Code-change plans require assurance")
        const goal = await SessionGoal.get(session.id)
        expect(goal?.status).toBe("paused")
        expect(GoalPlan.hasValidContract(session.id, goal!.time.created)).toBe(false)
      },
    })
  },
)

test("caller cancellation wins over a persisted child diagnosis", async () => {
  await using tmp = await tmpdir({ git: true })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const session = await Session.create({})
      const controller = new AbortController()
      const cancelled = new Error("Caller cancelled planning")
      vi.spyOn(SessionPrompt, "prompt").mockImplementation(async (input) => {
        const result = await response(input.sessionID, "Child aborted")
        controller.abort(cancelled)
        return result
      })
      await expect(
        GoalPlanWriter.write({ sessionID: session.id, objective: "Fix bugs", model, abort: controller.signal }),
      ).rejects.toBe(cancelled)
    },
  })
})

test("a deliberate planning blocker reaches the parent as a bounded explanation", async () => {
  await using tmp = await tmpdir({ git: true })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const session = await Session.create({})
      vi.spyOn(SessionPrompt, "prompt").mockImplementation(async (input) => {
        return createStoppedAssistantTextResponse({
          sessionID: input.sessionID,
          parent: { id: MessageID.ascending(), agent: "goal-plan-writer", model },
          text: "Cannot ground the required source: missing schema. " + "x".repeat(2000),
        })
      })
      let message = ""
      try {
        await GoalPlanWriter.write({ sessionID: session.id, objective: "Fix bugs", model })
      } catch (error) {
        message = (error as Error).message
      }
      expect(message).toContain("missing schema")
      expect(message).toContain("finished without submit_goal_plan")
      expect(message.length).toBeLessThan(1400)
    },
  })
})
