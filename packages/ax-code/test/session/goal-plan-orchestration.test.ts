import { describe, expect, test } from "vitest"
import { Instance } from "../../src/project/instance"
import { Session } from "../../src/session"
import { SessionGoal } from "../../src/session/goal"
import { GoalPlan } from "../../src/session/goal-plan"
import { GoalPlanOrchestration } from "../../src/session/goal-plan-orchestration"
import { GoalPlanWriter } from "../../src/session/goal-plan-writer"
import { tmpdir } from "../fixture/fixture"

describe("GoalPlanOrchestration", () => {
  test("writes a contract then activates the goal", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        GoalPlanWriter.setWrite(GoalPlanWriter.stubWrite())
        const session = await Session.create({})
        const prepared = await GoalPlanOrchestration.activate({
          sessionID: session.id,
          objective: "add a health endpoint",
        })
        expect(prepared.goal.status).toBe("active")
        expect(prepared.reused).toBe(false)
        expect(GoalPlan.hasValidContract(session.id, prepared.goal.time.created)).toBe(true)
        expect(GoalPlan.readCapped(prepared.path)).toContain("add a health endpoint")
        await Session.remove(session.id)
      },
    })
  })

  test("reuses a valid contract and does not call the writer again", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        let calls = 0
        GoalPlanWriter.setWrite(async (input) => {
          calls++
          return GoalPlanWriter.stubWrite()(input)
        })
        const session = await Session.create({})
        const first = await GoalPlanOrchestration.activate({
          sessionID: session.id,
          objective: "document the parser",
        })
        await SessionGoal.pause(session.id)
        const second = await GoalPlanOrchestration.resumeWithPlan({ sessionID: session.id })
        expect(calls).toBe(1)
        expect(second.reused).toBe(true)
        expect(second.path).toBe(first.path)
        expect(second.goal.status).toBe("active")
        await Session.remove(session.id)
      },
    })
  })

  test("fail-closed writer leaves the goal paused", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        GoalPlanWriter.setWrite(async () => {
          throw new GoalPlan.Error("writer", "boom")
        })
        const session = await Session.create({})
        await expect(
          GoalPlanOrchestration.activate({
            sessionID: session.id,
            objective: "this should stay paused",
          }),
        ).rejects.toThrow("boom")
        expect((await SessionGoal.get(session.id))?.status).toBe("paused")
        await Session.remove(session.id)
      },
    })
  })

  test("missing-plan resume retries the writer before activating", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({})
        await SessionGoal.create({ sessionID: session.id, objective: "legacy goal", status: "paused" })
        let calls = 0
        GoalPlanWriter.setWrite(async (input) => {
          calls++
          return GoalPlanWriter.stubWrite()(input)
        })
        const prepared = await GoalPlanOrchestration.resumeWithPlan({ sessionID: session.id })
        expect(calls).toBe(1)
        expect(prepared.reused).toBe(false)
        expect(prepared.goal.status).toBe("active")
        await Session.remove(session.id)
      },
    })
  })

  test("copies the plan onto a forked session", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        GoalPlanWriter.setWrite(GoalPlanWriter.stubWrite())
        const session = await Session.create({})
        const prepared = await GoalPlanOrchestration.activate({
          sessionID: session.id,
          objective: "fork this contract",
        })
        const fork = await Session.create({})
        const copied = await SessionGoal.copyTo({ from: session.id, to: fork.id })
        expect(copied?.objective).toBe("fork this contract")
        expect(GoalPlan.hasValidContract(fork.id, copied!.time.created)).toBe(true)
        expect(GoalPlan.read(fork.id, copied!.time.created)?.acceptance[0]?.text).toContain("fork this contract")
        expect(prepared.path).not.toBe(GoalPlan.pathFor(fork.id, copied!.time.created))
        await Session.remove(fork.id)
        await Session.remove(session.id)
      },
    })
  })
})
