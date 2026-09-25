import { describe, expect, test, vi } from "vitest"
import { goalPlanningContext, GOAL_CONTEXT_BYTES } from "../../src/session/goal-planning-context"
import { goalProgress } from "../../src/session/goal-progress"
import * as SourceState from "../../src/quality/source-state"
import { Instance } from "../../src/project/instance"
import { Session } from "../../src/session"
import { SessionGoal } from "../../src/session/goal"
import { GoalPlan } from "../../src/session/goal-plan"
import { GoalPlanOrchestration } from "../../src/session/goal-plan-orchestration"
import { executeGoalCommand } from "../../src/session/prompt/prompt-goal-command"
import { GoalPlanWriter } from "../../src/session/goal-plan-writer"
import { CreateGoalTool, UpdateGoalTool, GetGoalTool } from "../../src/tool/goal"
import { MessageID, PartID, type SessionID } from "../../src/session/schema"
import type { MessageV2 } from "../../src/session/message-v2"
import type { Tool } from "../../src/tool/tool"
import { tmpdir } from "../fixture/fixture"
import fs from "node:fs/promises"

function user(text: string, synthetic = false): MessageV2.WithParts {
  return {
    info: { id: text.slice(0, 20), role: "user", time: { created: 100 } },
    parts: [{ type: "text", text, synthetic }],
  } as any
}
function assistant(output?: string, tool = "read", metadata = {}, finish = "stop"): MessageV2.WithParts {
  return {
    info: { role: "assistant", time: { created: 100 }, finish },
    parts: output
      ? [{ type: "tool", tool, state: { status: "completed", input: {}, output, metadata } }]
      : [{ type: "text", text: "I will continue" }],
  } as any
}
function context(sessionID: SessionID, created?: number): Tool.Context {
  return {
    sessionID,
    messageID: MessageID.ascending(),
    agent: "build",
    abort: new AbortController().signal,
    goalBinding: { created },
    extra: { model: { id: "selected-model", providerID: "selected-provider" } },
    messages: [],
    metadata() {},
    async ask() {},
  }
}
async function withSession(fn: (sessionID: SessionID, directory: string) => Promise<void>) {
  await using tmp = await tmpdir({ git: true })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const session = await Session.create({})
      GoalPlanWriter.setWrite(GoalPlanWriter.stubWrite())
      try {
        await fn(session.id, tmp.path)
      } finally {
        GoalPlanWriter.resetWrite()
        await Session.remove(session.id)
      }
    },
  })
}
async function evidence(sessionID: SessionID, directory: string) {
  const messageID = MessageID.ascending()
  const partID = PartID.ascending()
  await Session.updateMessage({
    id: messageID,
    parentID: MessageID.ascending(),
    sessionID,
    role: "assistant",
    agent: "build",
    mode: "build",
    path: { cwd: directory, root: directory },
    modelID: "test",
    providerID: "test",
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    time: { created: Date.now(), completed: Date.now() },
  } as any)
  await Session.updatePart({
    id: partID,
    messageID,
    sessionID,
    type: "tool",
    tool: "bash",
    callID: "dependency-probe",
    state: {
      status: "error",
      input: { command: "check-staging" },
      error: "Required staging service is unavailable",
      time: { start: Date.now(), end: Date.now() },
    },
  })
  return partID
}

describe("goal context and progress", () => {
  test("keeps user provenance and corrections, excluding generated reminders and model claims", () => {
    const text = goalPlanningContext(
      [
        user("Preserve the public API"),
        assistant("secret model claim"),
        user("Do not deploy"),
        user("loop reminder", true),
      ],
      [
        { type: "file", filename: "requirements.md", source: { type: "file", path: "/project/requirements.md" } },
        { type: "file", filename: "image.png", url: "data:image/png;base64,PRIVATE" },
      ],
    )
    expect(text).toContain("Preserve the public API")
    expect(text).toContain("Do not deploy")
    expect(text).toContain("/project/requirements.md")
    expect(text).toContain("content not included")
    expect(text).not.toContain("secret model claim")
    expect(text).not.toContain("loop reminder")
    expect(text).not.toContain("PRIVATE")
  })
  test("omits oversized whole records while retaining recent corrections", () => {
    const text = goalPlanningContext([user("x".repeat(GOAL_CONTEXT_BYTES + 1)), user("Latest correction")])
    expect(text).toContain("1 user records omitted")
    expect(text).toContain("Latest correction")
    expect(Buffer.byteLength(text)).toBeLessThan(GOAL_CONTEXT_BYTES + 512)
  })
  test("repeated prose and checklist churn recover then pause instead of continuing 100 times", () => {
    const messages: MessageV2.WithParts[] = []
    messages.push(assistant(), assistant())
    expect(goalProgress(messages, 0).action).toBe("recover")
    messages.push(assistant("done", "todowrite"), assistant())
    expect(goalProgress(messages, 0).action).toBe("pause")
  })
  test("new research evidence advances, repeated results and failed commands do not", () => {
    const messages = [assistant("source A"), assistant("source B"), assistant("source C")]
    expect(goalProgress(messages, 0).action).toBe("continue")
    messages.push(assistant("source C"), assistant("source C"))
    expect(goalProgress(messages, 0).action).toBe("recover")
    messages.push(assistant("new error", "bash", { exit: 1 }), assistant())
    expect(goalProgress(messages, 0).action).toBe("pause")
  })
  test("distinct successful mutations count despite generic success output, while plan edits do not", () => {
    const changed = (content: string, filePath = "/project/src/file.ts") => {
      const message = assistant("Wrote file successfully.", "write")
      ;(message.parts[0] as any).state.input = { filePath, content }
      return message
    }
    expect(goalProgress([changed("a"), changed("b"), changed("c")], 0).stagnant).toBe(0)
    expect(goalProgress([changed("a"), changed("a"), changed("a")], 0).stagnant).toBe(2)
    expect(
      goalProgress([changed("a", "/project/.ax-code/goals/a.md"), changed("b", "/project/.ax-code/goals/a.md")], 0)
        .stagnant,
    ).toBe(2)
  })
  test("verification timing noise alone cannot renew progress", () => {
    const checks = [1, 2, 3].map((seconds) => assistant(`Passed in ${seconds}s`, "verify_project", { passed: true }))
    expect(goalProgress(checks, 0).action).toBe("recover")
  })
  test("apply_patch checklist churn does not count, while source patches do", () => {
    const patch = (file: string, content: string) => {
      const message = assistant("Updated file", "apply_patch")
      ;(message.parts[0] as any).state.input = {
        patchText: `*** Begin Patch\n*** Update File: ${file}\n@@\n-old\n+${content}\n*** End Patch`,
      }
      return message
    }
    expect(goalProgress([patch(".ax-code/goals/a.md", "a"), patch(".ax-code/goals/a.md", "b")], 0).stagnant).toBe(2)
    expect(goalProgress([patch("src/a.ts", "a"), patch("src/a.ts", "b")], 0).stagnant).toBe(0)
  })
  test("an omitted newer correction never exposes the older requirement it may replace", () => {
    const text = goalPlanningContext([
      user("Old requirement that may be superseded"),
      user("x".repeat(GOAL_CONTEXT_BYTES + 1)),
      user("Newest small correction"),
    ])
    expect(text).toContain("Newest small correction")
    expect(text).not.toContain("Old requirement")
    expect(text).toContain("omitted")
  })
  test("tool-call turns and compaction summaries do not manufacture finished-turn stalls", () => {
    const running = assistant(undefined, "read", {}, "tool-calls")
    const summary = assistant()
    ;(summary.info as any).summary = true
    expect(goalProgress([running, running, summary, running], 0).stagnant).toBe(0)
    expect(goalProgress([assistant(), assistant(), user("New correction"), assistant()], 0).stagnant).toBe(1)
  })
})

describe("goal tool boundaries", () => {
  test("inherits the selected model and advances only future model-step bindings", async () =>
    withSession(async (id) => {
      let captured: GoalPlanWriter.Input | undefined
      GoalPlanWriter.setWrite(async (input) => {
        captured = input
        return GoalPlanWriter.stubWrite()(input)
      })
      const ctx = context(id)
      let nextCreated: number | undefined
      ctx.onGoalCreated = (created) => {
        nextCreated = created
      }
      // Assurance is opt-in: this test is about the planning path, so it asks for it.
      await (await CreateGoalTool.init()).execute({ objective: "Repair the parser", assure: true }, ctx)
      expect(captured?.model).toEqual({ providerID: "selected-provider", modelID: "selected-model" })
      expect(ctx.goalBinding?.created).toBeUndefined()
      expect(nextCreated).toBe((await SessionGoal.get(id))?.time.created)
      await expect(
        (await UpdateGoalTool.init()).execute({ status: "complete", acceptanceEvidence: { AC1: "done" } }, ctx),
      ).rejects.toThrow("different goal")
    }))
  test("rejects immediate blocked and fabricated evidence; exposes original IDs for a real blocker", async () =>
    withSession(async (id, directory) => {
      const goal = await SessionGoal.create({ sessionID: id, objective: "Verify staging" })
      const ctx = context(id, goal.time.created)
      const update = await UpdateGoalTool.init()
      await expect(update.execute({ status: "blocked" }, ctx)).rejects.toThrow("Blocking requires")
      const blocker = {
        kind: "external_dependency" as const,
        reason: "Staging is unavailable",
        requiredChange: "Restore staging access",
        evidence: ["invented"],
        independentWorkRemaining: false as const,
      }
      await expect(update.execute({ status: "blocked", blocker }, ctx)).rejects.toThrow("original tool results")
      const partID = await evidence(id, directory)
      expect((await (await GetGoalTool.init()).execute({}, ctx)).output).toContain(partID)
      const result = await update.execute({ status: "blocked", blocker: { ...blocker, evidence: [partID] } }, ctx)
      expect(result.metadata.blocker?.requiredChange).toBe("Restore staging access")
      expect((await SessionGoal.get(id))?.status).toBe("blocked")
    }))
  test("get_goal remains usable when checkpoint fingerprinting fails", async () =>
    withSession(async (id) => {
      const goal = await SessionGoal.create({ sessionID: id, objective: "Verify project" })
      await GoalPlan.write(
        id,
        goal.time.created,
        GoalPlan.render({
          ...GoalPlan.sample(goal.objective),
          assurance: {
            version: 1,
            sourcePaths: ["src"],
            sources: [],
            checks: [
              {
                id: "test",
                acceptanceIds: ["AC1"],
                command: "node check.cjs",
                purpose: "Verify behavior",
                environment: "local",
              },
            ],
          },
        }),
      )
      const spy = vi.spyOn(SourceState, "currentSourceState").mockRejectedValue(new Error("temporary read failure"))
      try {
        const result = await (await GetGoalTool.init()).execute({}, context(id, goal.time.created))
        expect(result.output).toContain("Source fingerprint unavailable")
        expect(result.metadata.goal?.status).toBe("active")
      } finally {
        spy.mockRestore()
      }
    }))
  test("stale calls cannot block or complete a replacement even with its current evidence", async () =>
    withSession(async (id, directory) => {
      const old = await SessionGoal.create({ sessionID: id, objective: "Goal A" })
      const ctx = context(id, old.time.created)
      const fresh = await SessionGoal.create({ sessionID: id, objective: "Goal B", replace: true })
      expect(fresh.time.created).toBeGreaterThan(old.time.created)
      const partID = await evidence(id, directory)
      const tool = await UpdateGoalTool.init()
      await expect(
        tool.execute(
          {
            status: "blocked",
            blocker: {
              kind: "external_dependency",
              reason: "Unavailable",
              requiredChange: "Restore service",
              evidence: [partID],
              independentWorkRemaining: false,
            },
          },
          ctx,
        ),
      ).rejects.toThrow("different goal")
      await expect(tool.execute({ status: "complete" }, ctx)).rejects.toThrow("different goal")
      expect((await SessionGoal.get(id))?.status).toBe("active")
    }))
})

describe("explicit goal revisions", () => {
  test("retains old contracts and budget, assigns a fresh identity and records digest lineage", async () =>
    withSession(async (id) => {
      const first = await GoalPlanOrchestration.activate({ sessionID: id, objective: "Fix parser", tokenBudget: 1000 })
      const previous = await fs.readFile(first.path!, "utf8")
      const revised = await GoalPlanOrchestration.revise({ sessionID: id, correction: "Also preserve empty input" })
      expect(revised.goal.time.created).toBeGreaterThan(first.goal.time.created)
      expect(revised.goal.tokenBudget).toBe(1000)
      expect(revised.goal.tokensUsed).toBe(first.goal.tokensUsed)
      expect(await fs.readFile(first.path!, "utf8")).toBe(previous)
      expect(revised.goal.objective).toContain("Also preserve empty input")
      const lineage = await fs.readFile(
        GoalPlan.digestPathFor(id, revised.goal.time.created).replace(/\.sha256$/, ".revision.json"),
        "utf8",
      )
      expect(lineage).toContain(String(first.goal.time.created))
      expect(lineage).toContain("previousDigest")
    }))
  test("the explicit revision command reports changed acceptance and forwards attachment context", async () =>
    withSession(async (id) => {
      await GoalPlanOrchestration.activate({ sessionID: id, objective: "Fix parser" })
      let captured: GoalPlanWriter.Input | undefined
      GoalPlanWriter.setWrite(async (input) => {
        captured = input
        const plan = GoalPlan.sample(input.objective)
        plan.acceptance[0].text = "Handle empty input"
        return GoalPlan.render(plan)
      })
      let prompted = false
      await executeGoalCommand(
        {
          sessionID: id,
          command: "goal",
          arguments: "revise Handle empty input",
          model: "test/test-model",
          agent: "build",
          variant: "high",
          parts: [
            { type: "file", filename: "requirements.md", mime: "text/plain", url: "file:///project/requirements.md" },
          ],
        },
        async () => {
          prompted = true
          return { info: { role: "assistant" }, parts: [] } as any
        },
      )
      expect(prompted).toBe(true)
      expect(captured?.context).toContain("/project/requirements.md")
      expect(captured?.variant).toBe("high")
      const messages = await Session.messages({ sessionID: id })
      expect(
        messages
          .flatMap((m) => m.parts)
          .some((p) => p.type === "text" && p.text.includes("New AC1: Handle empty input")),
      ).toBe(true)
    }))
  test("a concurrent replacement cannot be resumed or overwritten by a revision candidate", async () =>
    withSession(async (id) => {
      await GoalPlanOrchestration.activate({ sessionID: id, objective: "Original" })
      let replacement: SessionGoal.Info | undefined
      GoalPlanWriter.setWrite(async (input) => {
        replacement = await SessionGoal.create({
          sessionID: id,
          objective: "Replacement",
          replace: true,
          status: "paused",
        })
        return GoalPlanWriter.stubWrite()(input)
      })
      await expect(GoalPlanOrchestration.revise({ sessionID: id, correction: "Preserve the API" })).rejects.toThrow(
        "changed while preparing",
      )
      expect((await SessionGoal.get(id))?.time.created).toBe(replacement?.time.created)
      expect((await SessionGoal.get(id))?.status).toBe("paused")
    }))
  test("a pause cannot be overwritten by a model terminal update", async () =>
    withSession(async (id) => {
      const goal = await SessionGoal.create({ sessionID: id, objective: "Original" })
      const ctx = context(id, goal.time.created)
      await SessionGoal.pause(id)
      await expect((await UpdateGoalTool.init()).execute({ status: "complete" }, ctx)).rejects.toThrow("not active")
      expect((await SessionGoal.get(id))?.status).toBe("paused")
    }))
  test("an explicit pause during planning is not undone by a successful writer", async () =>
    withSession(async (id) => {
      GoalPlanWriter.setWrite(async (input) => {
        await SessionGoal.pause(id)
        return GoalPlanWriter.stubWrite()(input)
      })
      await expect(GoalPlanOrchestration.activate({ sessionID: id, objective: "Fix parser" })).rejects.toThrow(
        "goal changed",
      )
      expect((await SessionGoal.get(id))?.status).toBe("paused")
    }))
  test("aborting a goal tool during planning prevents activation", async () =>
    withSession(async (id) => {
      const controller = new AbortController()
      const ctx = context(id)
      ctx.abort = controller.signal
      GoalPlanWriter.setWrite(async (input) => {
        expect(input.abort).toBe(controller.signal)
        controller.abort(new Error("user cancelled planning"))
        return GoalPlanWriter.stubWrite()(input)
      })
      await expect(
        (await CreateGoalTool.init()).execute({ objective: "Fix parser", assure: true }, ctx),
      ).rejects.toThrow("user cancelled")
      expect((await SessionGoal.get(id))?.status).toBe("paused")
    }))
  test("completed goals cannot spend a revision writer turn", async () =>
    withSession(async (id) => {
      await GoalPlanOrchestration.activate({ sessionID: id, objective: "Fix parser" })
      await SessionGoal.setStatus({ sessionID: id, status: "complete" })
      GoalPlanWriter.setWrite(async () => {
        throw new Error("writer should not execute")
      })
      await expect(GoalPlanOrchestration.revise({ sessionID: id, correction: "More work" })).rejects.toThrow(
        "Start a new goal",
      )
      expect((await SessionGoal.get(id))?.status).toBe("complete")
    }))
  test("invalid revision output restores a blocked goal and its original identity", async () =>
    withSession(async (id) => {
      const first = await GoalPlanOrchestration.activate({ sessionID: id, objective: "Fix parser" })
      await SessionGoal.setStatus({ sessionID: id, status: "blocked" })
      GoalPlanWriter.setWrite(async () => "invalid plan")
      await expect(GoalPlanOrchestration.revise({ sessionID: id, correction: "Preserve API" })).rejects.toThrow()
      expect((await SessionGoal.get(id))?.status).toBe("blocked")
      expect((await SessionGoal.get(id))?.time.created).toBe(first.goal.time.created)
    }))
  test("aborted resume preserves paused status with an existing frozen plan", async () =>
    withSession(async (id) => {
      await GoalPlanOrchestration.activate({ sessionID: id, objective: "Fix parser" })
      await SessionGoal.pause(id)
      const controller = new AbortController()
      controller.abort(new Error("cancel resume"))
      await expect(GoalPlanOrchestration.resumeWithPlan({ sessionID: id, abort: controller.signal })).rejects.toThrow(
        "cancel resume",
      )
      expect((await SessionGoal.get(id))?.status).toBe("paused")
    }))
  test("abort during resume plan publication cannot activate the goal", async () =>
    withSession(async (id) => {
      await SessionGoal.create({ sessionID: id, objective: "Fix parser", status: "paused" })
      const controller = new AbortController()
      const write = GoalPlan.write
      const spy = vi.spyOn(GoalPlan, "write").mockImplementation(async (...args) => {
        const result = await write(...args)
        controller.abort(new Error("cancel publication"))
        return result
      })
      try {
        await expect(GoalPlanOrchestration.resumeWithPlan({ sessionID: id, abort: controller.signal })).rejects.toThrow(
          "cancel publication",
        )
        expect((await SessionGoal.get(id))?.status).toBe("paused")
      } finally {
        spy.mockRestore()
      }
    }))
  test("writer failure retains the previous contract and leaves it resumable", async () =>
    withSession(async (id) => {
      const first = await GoalPlanOrchestration.activate({ sessionID: id, objective: "Fix parser" })
      GoalPlanWriter.setWrite(async () => {
        throw new Error("planner unavailable")
      })
      await expect(GoalPlanOrchestration.revise({ sessionID: id, correction: "Preserve API" })).rejects.toThrow(
        "planner unavailable",
      )
      expect((await SessionGoal.get(id))?.time.created).toBe(first.goal.time.created)
      expect((await SessionGoal.get(id))?.status).toBe("paused")
      expect(GoalPlan.hasValidContract(id, first.goal.time.created)).toBe(true)
    }))
})
