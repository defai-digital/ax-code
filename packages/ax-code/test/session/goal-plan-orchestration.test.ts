import { describe, expect, test } from "vitest"
import fs from "fs/promises"
import path from "path"
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

  test("refuses to replace a corrupt frozen contract on resume", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        GoalPlanWriter.setWrite(GoalPlanWriter.stubWrite())
        const session = await Session.create({})
        const prepared = await GoalPlanOrchestration.activate({
          sessionID: session.id,
          objective: "preserve the frozen contract",
        })
        await SessionGoal.pause(session.id)
        const digestPath = GoalPlan.digestPathFor(session.id, prepared.goal.time.created)
        const digestBefore = await fs.readFile(digestPath, "utf8")
        const corrupt = "# Plan: preserve the frozen contract\n\nthis is not a valid contract\n"
        await fs.writeFile(prepared.path, corrupt)
        let calls = 0
        GoalPlanWriter.setWrite(async (input) => {
          calls++
          return GoalPlanWriter.stubWrite()(input)
        })

        await expect(GoalPlanOrchestration.resumeWithPlan({ sessionID: session.id })).rejects.toThrow(
          "frozen goal contract",
        )
        expect(calls).toBe(0)
        expect(await fs.readFile(prepared.path, "utf8")).toBe(corrupt)
        expect(await fs.readFile(digestPath, "utf8")).toBe(digestBefore)
        expect((await SessionGoal.get(session.id))?.status).toBe("paused")
        await Session.remove(session.id)
      },
    })
  })

  test("copies the plan and checklist progress onto a forked session verbatim", async () => {
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
        const checked = (await fs.readFile(prepared.path, "utf8"))
          .replace("- [ ] Inspect the current code", "- [x] Inspect the current code")
          .replace("- [ ] Implement the change", "- [x] Implement the change")
        await fs.writeFile(prepared.path, checked)
        const sourceDigest = await fs.readFile(GoalPlan.digestPathFor(session.id, prepared.goal.time.created), "utf8")
        const fork = await Session.create({})
        const copied = await SessionGoal.copyTo({ from: session.id, to: fork.id })
        expect(copied?.objective).toBe("fork this contract")
        expect(GoalPlan.hasValidContract(fork.id, copied!.time.created)).toBe(true)
        const forkPath = GoalPlan.pathFor(fork.id, copied!.time.created)
        const forkMarkdown = await fs.readFile(forkPath, "utf8")
        expect(forkMarkdown).toBe(checked)
        expect(GoalPlan.firstUncheckedTask(forkMarkdown)).toBe("Run verification")
        expect(await fs.readFile(GoalPlan.digestPathFor(fork.id, copied!.time.created), "utf8")).toBe(sourceDigest)
        const result = GoalPlan.read(fork.id, copied!.time.created)
        expect(result.status).toBe("found")
        if (result.status !== "found") throw new Error("expected copied goal plan")
        expect(result.contract.acceptance[0]?.text).toContain("fork this contract")
        expect(prepared.path).not.toBe(GoalPlan.pathFor(fork.id, copied!.time.created))
        await Session.remove(fork.id)
        await Session.remove(session.id)
      },
    })
  })

  test("rebuilds a missing source digest while copying the plan verbatim", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        GoalPlanWriter.setWrite(GoalPlanWriter.stubWrite())
        const session = await Session.create({})
        const prepared = await GoalPlanOrchestration.activate({
          sessionID: session.id,
          objective: "recover the fork digest",
        })
        const sourceMarkdown = (await fs.readFile(prepared.path, "utf8")).replace(
          "- [ ] Inspect the current code",
          "- [x] Inspect the current code",
        )
        await fs.writeFile(prepared.path, sourceMarkdown)
        await fs.unlink(GoalPlan.digestPathFor(session.id, prepared.goal.time.created))

        const fork = await Session.create({})
        const copied = await SessionGoal.copyTo({ from: session.id, to: fork.id })
        const forkMarkdown = await fs.readFile(GoalPlan.pathFor(fork.id, copied!.time.created), "utf8")
        expect(forkMarkdown).toBe(sourceMarkdown)
        expect(forkMarkdown).toContain("- [x] Inspect the current code")
        expect(GoalPlan.hasValidContract(fork.id, copied!.time.created)).toBe(true)
        const result = GoalPlan.read(fork.id, copied!.time.created)
        if (result.status !== "found") throw new Error("expected copied goal plan")
        expect(await fs.readFile(GoalPlan.digestPathFor(fork.id, copied!.time.created), "utf8")).toBe(
          GoalPlan.digestOf(result.contract) + "\n",
        )
        await Session.remove(fork.id)
        await Session.remove(session.id)
      },
    })
  })

  test("refuses to replace a digest whose plan was never published", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        GoalPlanWriter.setWrite(GoalPlanWriter.stubWrite())
        const session = await Session.create({})
        const reserved = await SessionGoal.create({
          sessionID: session.id,
          objective: "keep the unpublished plan fail-closed",
          status: "paused",
        })
        const digestPath = GoalPlan.digestPathFor(session.id, reserved.time.created)
        const planPath = GoalPlan.pathFor(session.id, reserved.time.created)
        await fs.mkdir(path.dirname(digestPath), { recursive: true })
        await fs.writeFile(digestPath, "a".repeat(64) + "\n")
        let calls = 0
        GoalPlanWriter.setWrite(async (input) => {
          calls++
          return GoalPlanWriter.stubWrite()(input)
        })

        await expect(GoalPlanOrchestration.resumeWithPlan({ sessionID: session.id })).rejects.toThrow(
          "frozen goal contract",
        )
        expect(calls).toBe(0)
        expect(await fs.readFile(digestPath, "utf8")).toBe("a".repeat(64) + "\n")
        await expect(fs.stat(planPath)).rejects.toMatchObject({ code: "ENOENT" })
        expect((await SessionGoal.get(session.id))?.status).toBe("paused")
        await Session.remove(session.id)
      },
    })
  })
})
