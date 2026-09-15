/** Opt-in, paired runtime benchmark. Run with script/goal-benchmark.ts. */
import { test, vi } from "vitest"
import fs from "node:fs/promises"
import { Instance } from "../../src/project/instance"
import { Session } from "../../src/session"
import { SessionGoal } from "../../src/session/goal"
import { GoalPlan } from "../../src/session/goal-plan"
import { GoalPlanWriter } from "../../src/session/goal-plan-writer"
import { GoalPlanOrchestration } from "../../src/session/goal-plan-orchestration"
import { CreateGoalTool, UpdateGoalTool } from "../../src/tool/goal"
import { Bus } from "../../src/bus"
import { SessionStatus } from "../../src/session/status"
import { executeGoalCommand } from "../../src/session/prompt/prompt-goal-command"
import { SessionPrompt } from "../../src/session/prompt"
import { Provider } from "../../src/provider/provider"
import { LLM } from "../../src/session/llm"
import { Snapshot } from "../../src/snapshot"
import { MessageID, PartID, type SessionID } from "../../src/session/schema"
import { tmpdir } from "../fixture/fixture"

const model: Provider.Model = {
  id: "benchmark-model" as any,
  providerID: "benchmark" as any,
  name: "Scripted benchmark",
  family: "benchmark",
  api: { id: "benchmark-model", url: "https://example.invalid", npm: "@ai-sdk/openai-compatible" },
  capabilities: {
    temperature: true,
    reasoning: false,
    attachment: false,
    toolcall: true,
    input: { text: true, audio: false, image: false, video: false, pdf: false },
    output: { text: true, audio: false, image: false, video: false, pdf: false },
    interleaved: false,
  },
  limit: { context: 128000, output: 8192 },
  status: "active",
  options: {},
  headers: {},
  release_date: "2026-01-01",
}
function ctx(sessionID: SessionID, created?: number): any {
  return {
    sessionID,
    messageID: MessageID.ascending(),
    agent: "build",
    abort: new AbortController().signal,
    goalBinding: { created },
    messages: [],
    extra: { model },
    metadata() {},
    async ask() {},
  }
}
async function rejects(action: () => Promise<unknown>) {
  try {
    await action()
    return false
  } catch {
    return true
  }
}
type Observation = {
  passed: boolean
  detail: string
  modelCalls?: number
  goalTurns?: number
  horizonReached?: boolean
}
type Scenario = {
  id: string
  category: "reliability" | "preserved" | "capability"
  run: (id: SessionID, dir: string) => Promise<Observation>
}
const scenarios: Scenario[] = [
  {
    id: "headless-start-does-not-close-event-stream",
    category: "reliability",
    async run(id) {
      let earlyIdle = false
      let started = false
      const unsubscribe = Bus.subscribe(SessionStatus.Event.Status, (event) => {
        if (event.properties.sessionID === id && event.properties.status.type === "idle" && !started) earlyIdle = true
      })
      GoalPlanWriter.setWrite(async (input) => {
        started = true
        return GoalPlanWriter.stubWrite()(input)
      })
      try {
        await executeGoalCommand(
          {
            sessionID: id,
            command: "goal",
            arguments: "Repair parser",
            model: "benchmark/benchmark-model",
            agent: "build",
          } as any,
          async () => ({}) as any,
        )
        return {
          passed: started && !earlyIdle,
          detail: earlyIdle
            ? "Premature idle closes headless event loop before planning"
            : "No terminal event before planning",
        }
      } finally {
        unsubscribe()
      }
    },
  },

  {
    id: "planner-model-inheritance",
    category: "reliability",
    async run(id) {
      let captured: any
      GoalPlanWriter.setWrite(async (input) => {
        captured = input
        return GoalPlanWriter.stubWrite()(input)
      })
      await (await CreateGoalTool.init()).execute({ objective: "Repair the parser" }, ctx(id))
      const passed = captured?.model?.modelID === model.id && captured?.model?.providerID === model.providerID
      return { passed, detail: passed ? "Selected model reaches planner" : "Planner did not receive selected model" }
    },
  },
  {
    id: "parent-correction-context",
    category: "reliability",
    async run(id) {
      const messageID = MessageID.ascending()
      await Session.updateMessage({
        id: messageID,
        sessionID: id,
        role: "user",
        time: { created: Date.now() },
        agent: "build",
        model: { providerID: model.providerID, modelID: model.id },
      })
      await Session.updatePart({
        id: PartID.ascending(),
        messageID,
        sessionID: id,
        type: "text",
        text: "Correction: retain the legacy empty-input behavior.",
      })
      let captured: any
      GoalPlanWriter.setWrite(async (input) => {
        captured = input
        return GoalPlanWriter.stubWrite()(input)
      })
      await GoalPlanOrchestration.activate({
        sessionID: id,
        objective: "Repair parser",
        model: { providerID: model.providerID, modelID: model.id },
      })
      const passed = captured?.context?.includes("retain the legacy empty-input behavior") === true
      return {
        passed,
        detail: passed ? "Original correction reaches planner" : "Correction missing from planner input",
      }
    },
  },
  {
    id: "prose-loop-bounded",
    category: "reliability",
    async run(id) {
      return loop(id, false)
    },
  },
  {
    id: "productive-loop-completes",
    category: "preserved",
    async run(id) {
      return loop(id, true)
    },
  },
  {
    id: "unsupported-block-rejected",
    category: "reliability",
    async run(id) {
      const goal = await SessionGoal.create({ sessionID: id, objective: "Repair parser" })
      const rejected = await rejects(async () =>
        (await UpdateGoalTool.init()).execute({ status: "blocked" }, ctx(id, goal.time.created)),
      )
      return {
        passed: rejected && (await SessionGoal.get(id))?.status === "active",
        detail: rejected ? "Missing blocker evidence rejected" : "Goal blocked without evidence",
      }
    },
  },
  {
    id: "stale-tool-cannot-complete-replacement",
    category: "reliability",
    async run(id) {
      const old = await SessionGoal.create({ sessionID: id, objective: "Original goal" })
      await new Promise((resolve) => setTimeout(resolve, 2))
      const replacement = await SessionGoal.create({ sessionID: id, objective: "Replacement", replace: true })
      const rejected = await rejects(async () =>
        (await UpdateGoalTool.init()).execute({ status: "complete" }, ctx(id, old.time.created)),
      )
      const current = await SessionGoal.get(id)
      return {
        passed: rejected && current?.time.created === replacement.time.created && current.status === "active",
        detail: rejected ? "Stale update rejected" : "Stale update terminated replacement",
      }
    },
  },
  {
    id: "pause-during-planning-preserved",
    category: "reliability",
    async run(id) {
      GoalPlanWriter.setWrite(async (input) => {
        await SessionGoal.pause(id)
        return GoalPlanWriter.stubWrite()(input)
      })
      const rejected = await rejects(() =>
        GoalPlanOrchestration.activate({ sessionID: id, objective: "Repair parser" }),
      )
      return {
        passed: rejected && (await SessionGoal.get(id))?.status === "paused",
        detail: rejected ? "Explicit pause preserved" : "Planner undid explicit pause",
      }
    },
  },
  {
    id: "cancel-during-planning-preserved",
    category: "reliability",
    async run(id) {
      const controller = new AbortController()
      GoalPlanWriter.setWrite(async (input) => {
        controller.abort(new Error("Benchmark cancellation"))
        return GoalPlanWriter.stubWrite()(input)
      })
      const rejected = await rejects(() =>
        GoalPlanOrchestration.activate({ sessionID: id, objective: "Repair parser", abort: controller.signal } as any),
      )
      return {
        passed: rejected && (await SessionGoal.get(id))?.status === "paused",
        detail: rejected ? "Cancellation prevented activation" : "Cancelled planning activated goal",
      }
    },
  },
  {
    id: "missing-receipts-prevent-completion",
    category: "preserved",
    async run(id) {
      const goal = await SessionGoal.create({ sessionID: id, objective: "Repair parser" })
      await GoalPlan.write(
        id,
        goal.time.created,
        GoalPlan.render({
          ...GoalPlan.sample(goal.objective),
          assurance: {
            version: 1,
            sourcePaths: ["fixture.txt"],
            sources: [{ role: "implementation", reference: "fixture.txt" }],
            checks: [
              {
                id: "exact",
                acceptanceIds: ["AC1"],
                command: "node --version",
                purpose: "Fixture executable check",
                environment: "local fixture",
              },
            ],
          },
        }),
      )
      const rejected = await rejects(async () =>
        (await UpdateGoalTool.init()).execute(
          { status: "complete", acceptanceEvidence: { AC1: "Claimed success" } },
          ctx(id, goal.time.created),
        ),
      )
      return {
        passed: rejected && (await SessionGoal.get(id))?.status === "active",
        detail: rejected ? "Prose cannot replace receipts" : "Unverified completion accepted",
      }
    },
  },
  {
    id: "exhausted-budget-not-resumed",
    category: "preserved",
    async run(id) {
      await GoalPlanOrchestration.activate({ sessionID: id, objective: "Repair parser", tokenBudget: 1 })
      await SessionGoal.addUsage({
        sessionID: id,
        message: {
          id: MessageID.ascending(),
          sessionID: id,
          role: "assistant",
          parentID: MessageID.ascending(),
          mode: "build",
          agent: "build",
          modelID: model.id,
          providerID: model.providerID,
          path: { cwd: Instance.directory, root: Instance.worktree },
          time: { created: Date.now(), completed: Date.now() },
          tokens: { input: 1, output: 1, reasoning: 0, cache: { read: 0, write: 0 } },
        },
      })
      const rejected = await rejects(() => GoalPlanOrchestration.resumeWithPlan({ sessionID: id }))
      return {
        passed: rejected && (await SessionGoal.get(id))?.status === "budget_limited",
        detail: rejected ? "Exhausted budget preserved" : "Budget bypassed",
      }
    },
  },
  {
    id: "explicit-revision-retains-budget",
    category: "capability",
    async run(id) {
      const first = await GoalPlanOrchestration.activate({
        sessionID: id,
        objective: "Repair parser",
        tokenBudget: 200,
      })
      const revise = (GoalPlanOrchestration as any).revise
      if (typeof revise !== "function") return { passed: false, detail: "Unsupported: explicit revision is absent" }
      const revised = await revise({ sessionID: id, correction: "Preserve empty-input behavior" })
      const passed =
        revised.goal.time.created > first.goal.time.created &&
        revised.goal.tokenBudget === 200 &&
        GoalPlan.hasValidContract(id, first.goal.time.created)
      return { passed, detail: passed ? "Fresh revision preserves old plan and budget" : "Revision invariant failed" }
    },
  },
]
async function loop(id: SessionID, productive: boolean): Promise<Observation> {
  await SessionGoal.create({ sessionID: id, objective: "Complete the benchmark task" })
  let calls = 0
  let goalTurns = 0
  let horizonReached = false
  vi.spyOn(LLM, "stream").mockImplementation((async (input: LLM.StreamInput) => {
    calls++
    if (input.agent.name !== "build")
      return { text: Promise.resolve("Benchmark title"), fullStream: (async function* () {})() }
    goalTurns++
    if (productive) {
      const messageID = MessageID.ascending()
      await Session.updateMessage({
        id: messageID,
        sessionID: id,
        role: "assistant",
        parentID: MessageID.ascending(),
        mode: "build",
        agent: "build",
        modelID: model.id,
        providerID: model.providerID,
        path: { cwd: Instance.directory, root: Instance.worktree },
        time: { created: Date.now(), completed: Date.now() },
        tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
      })
      await Session.updatePart({
        id: PartID.ascending(),
        messageID,
        sessionID: id,
        type: "tool",
        tool: "read",
        callID: `read-${calls}`,
        state: {
          status: "completed",
          input: { filePath: `source-${calls}.txt` },
          output: `Independent source evidence ${calls}`,
          title: "Source evidence",
          metadata: {},
          time: { start: Date.now(), end: Date.now() },
        },
      })
      if (goalTurns === 6)
        await (
          await UpdateGoalTool.init()
        ).execute({ status: "complete" }, ctx(id, (await SessionGoal.get(id))!.time.created))
    }
    if (goalTurns === 12) {
      horizonReached = true
      await SessionGoal.pause(id)
    }
    return {
      fullStream: (async function* () {
        yield { type: "start" }
        yield { type: "start-step" }
        yield { type: "text-start", id: `t${calls}` }
        yield {
          type: "text-delta",
          id: `t${calls}`,
          text: productive ? "Reviewed another source" : "I will continue working",
        }
        yield { type: "text-end", id: `t${calls}` }
        yield {
          type: "finish-step",
          finishReason: "stop",
          usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
        }
        yield { type: "finish" }
      })(),
    }
  }) as any)
  await SessionPrompt.prompt({
    sessionID: id,
    agent: "build",
    model: { providerID: model.providerID, modelID: model.id },
    parts: [{ type: "text", text: "Execute the goal" }],
  })
  const goal = await SessionGoal.get(id)
  const passed = productive
    ? goal?.status === "complete" && goalTurns === 6
    : goal?.status === "paused" && goalTurns <= 4 && !horizonReached
  return {
    passed,
    detail: `${goal?.status}; ${calls} scripted model calls; ${goalTurns} goal turns${horizonReached ? "; observer stopped at 12-call horizon" : ""}`,
    modelCalls: calls,
    goalTurns,
    horizonReached,
  }
}

const output = process.env.GOAL_BENCHMARK_OUTPUT
const repetitions = Number(process.env.GOAL_BENCHMARK_REPETITIONS ?? 3)
test.skipIf(!output)(
  "capture goal runtime observations",
  async () => {
    if (!Number.isSafeInteger(repetitions) || repetitions < 1 || repetitions > 20)
      throw new Error("Repetitions must be 1..20")
    const observations: unknown[] = []
    for (let repetition = 0; repetition < repetitions; repetition++) {
      for (const scenario of repetition % 2 ? [...scenarios].reverse() : scenarios) {
        await using tmp = await tmpdir({ git: true })
        await Instance.provide({
          directory: tmp.path,
          fn: async () => {
            const session = await Session.create({})
            await fs.writeFile(`${tmp.path}/fixture.txt`, "Benchmark fixture v1\n")
            GoalPlanWriter.setWrite(GoalPlanWriter.stubWrite())
            vi.spyOn(Provider, "getModel").mockResolvedValue(model)
            vi.spyOn(Provider, "defaultModel").mockResolvedValue({ providerID: model.providerID, modelID: model.id })
            vi.spyOn(Snapshot, "track").mockResolvedValue(undefined)
            process.env.AX_CODE_AUTONOMOUS = "1"
            const start = performance.now()
            let result: Observation
            try {
              result = await scenario.run(session.id, tmp.path)
            } catch (error) {
              result = {
                passed: false,
                detail: `Scenario error: ${error instanceof Error ? error.message : String(error)}`,
              }
            }
            const elapsedMs = performance.now() - start
            observations.push({ scenario: scenario.id, category: scenario.category, repetition, elapsedMs, ...result })
            await fs.writeFile(
              output!,
              JSON.stringify(
                { version: 1, repetitions, scenarios: scenarios.map((item) => item.id), observations },
                null,
                2,
              ) + "\n",
            )
            GoalPlanWriter.resetWrite()
            vi.restoreAllMocks()
            await Session.remove(session.id)
          },
        })
      }
    }
  },
  180000,
)
