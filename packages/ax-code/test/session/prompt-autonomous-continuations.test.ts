import { describe, expect, test } from "vitest"
import { AutonomousContinuationPrompt } from "../../src/session/prompt-autonomous-continuations"

const pendingTodos = [{ content: "Report confirmed bugs to .internal/bugs/", status: "in_progress", priority: "high" }]

describe("autonomous continuation prompt builders", () => {
  test("builds goal continuation guidance", () => {
    const text = AutonomousContinuationPrompt.goal({
      objective: "finish the migration",
      continuation: 1,
    })

    expect(text).toContain("active session goal")
    expect(text).toContain("finish the migration")
    expect(text).toContain('update_goal with status "complete"')
    expect(text).toContain("goal auto-continuation 1")
  })

  test("builds goal-complete force-text guidance (#381)", () => {
    const text = AutonomousContinuationPrompt.goalCompleteForceText()
    expect(text).toContain("marked complete")
    expect(text).toContain("Tools are disabled")
    expect(text).toContain("final summary")
  })

  test("builds goal budget-limit wrap-up guidance", () => {
    const text = AutonomousContinuationPrompt.goalBudgetLimit({
      objective: "finish the migration",
      tokensUsed: 120,
      tokenBudget: 100,
      timeUsedSeconds: 9,
    })

    expect(text).toContain("reached its token budget")
    expect(text).toContain("Tokens used: 120")
    expect(text).toContain("Token budget: 100")
    expect(text).toContain("do not start new substantive work")
  })

  test("builds goal ceiling-approach convergence guidance", () => {
    const text = AutonomousContinuationPrompt.goalCeilingApproach({
      objective: "finish the migration",
      remainingTotalSteps: 42,
      totalStepLimit: 20_000,
    })

    expect(text).toContain("approaching its cumulative step ceiling")
    expect(text).toContain("42 of 20000 total steps remain")
    expect(text).toContain("finish the migration")
    expect(text).toContain("not higher-priority instructions")
    expect(text).toContain('update_goal status "complete"')
    expect(text).toContain("/goal resume")
  })

  test("builds global step-limit continuation guidance", () => {
    const text = AutonomousContinuationPrompt.stepLimit({
      stepLimit: 500,
      continuation: 2,
      maxContinuations: 3,
    })

    expect(text).toContain("Continue from where you left off")
    expect(text).toContain("auto-continuation 2/3")
    expect(text).toContain("Avoid over-engineering")
  })

  test("builds agent step-limit continuation guidance", () => {
    const text = AutonomousContinuationPrompt.agentStepLimit({
      agentName: "build",
      maxSteps: 20,
      continuation: 1,
      maxContinuations: 2,
    })

    expect(text).toContain("build agent step limit")
    expect(text).toContain("same agent")
    expect(text).toContain("agent step-limit auto-continuation 1/2")
  })

  test("builds empty model turn recovery guidance", () => {
    const text = AutonomousContinuationPrompt.emptyModelTurnRecovery({
      attempt: 1,
      maxAttempts: 1,
    })

    expect(text).toContain("returned no text and no tool calls")
    expect(text).toContain("empty-turn recovery 1/1")
  })

  test("builds a concise tool-free AX Engine truncation recovery", () => {
    const text = AutonomousContinuationPrompt.axEngineTruncatedModelTurnRecovery()

    expect(text).toContain("Tools are disabled")
    expect(text).toContain("under 120 words")
    expect(text).toContain("Do not continue, rewrite, or re-paste")
  })

  test("builds an AX Engine truncated code-work recovery that keeps tools available", () => {
    const text = AutonomousContinuationPrompt.axEngineTruncatedCodeWorkRecovery({
      attempt: 1,
      maxAttempts: 1,
    })

    expect(text).toContain("write or edit tool")
    expect(text).toContain("Do NOT re-paste")
    expect(text).toContain("local truncated-code recovery 1/1")
    expect(text).not.toContain("Tools are disabled")
  })

  test("bounds AX Engine read-only follow-up context", () => {
    const text = AutonomousContinuationPrompt.axEngineReadOnlyCheckpoint({
      consecutiveTurns: 2,
      forceThreshold: 4,
      forced: false,
    })

    expect(text).toContain("at most 6 representative files")
    expect(text).toContain("up to 400 lines each")
    expect(text).toContain("Working directory")
    expect(text).toContain("After 4 consecutive successful-evidence read-only turns")
  })

  test("forced AX Engine checkpoint forbids pasting tool XML and requires structured findings", () => {
    const text = AutonomousContinuationPrompt.axEngineReadOnlyCheckpoint({
      consecutiveTurns: 4,
      forceThreshold: 4,
      forced: true,
    })

    expect(text).toContain("Tools are disabled")
    expect(text).toContain("Do not paste tool-call XML")
    expect(text).toContain("Verdict")
    expect(text).toContain("Findings")
    expect(text).toContain("Do not paste large code blocks")
  })

  test("builds unexecutable tool text recovery guidance", () => {
    const text = AutonomousContinuationPrompt.unexecutableToolTextRecovery()

    expect(text).toContain("Tools are available again")
    expect(text).toContain("Do not paste XML")
    expect(text).toContain("Working directory")
  })

  test("builds completion gate retry guidance", () => {
    const text = AutonomousContinuationPrompt.completionGateRetry({
      message: "Subagent completed without a usable final response.",
      attempt: 2,
      maxAttempts: 3,
    })

    expect(text).toContain("completion gate blocked completion")
    expect(text).toContain("Completion gate resolution:")
    expect(text).toContain("completion-gate auto-continuation 2/3")
  })

  test("builds context convergence guidance with formatted todos", () => {
    const text = AutonomousContinuationPrompt.contextConvergence({ pendingTodos })

    expect(text).toContain("large context")
    expect(text).toContain("- [in_progress] Report confirmed bugs to .internal/bugs/")
    expect(text).toContain("context is already large")
  })

  test("builds deadline convergence guidance with optional report closure", () => {
    const text = AutonomousContinuationPrompt.deadlineConvergence({
      remainingAgentSteps: 2,
      pendingTodos,
      includeReportClosureGuidance: true,
    })

    expect(text).toContain("2 steps remaining")
    expect(text).toContain("1 unfinished todo")
    expect(text).toContain("credible suspected")
  })

  test("builds tool-only turn nudge guidance without misleading claims", () => {
    const text = AutonomousContinuationPrompt.toolOnlyTurnNudge({
      consecutiveToolOnlyTurns: 15,
      maxToolOnlyTurns: 35,
    })

    expect(text).toContain("last 15 turns ended with further tool calls")
    expect(text).toContain("does not reset this counter")
    expect(text).toContain("may continue the remaining work after the synthesis")
    expect(text).not.toContain("without a completed text response")
    expect(text).not.toContain("without producing any text response")
    expect(text).not.toContain("completing a turn with a text")
    expect(text).not.toContain("Stop broad exploration now")
  })

  test("final tool-only nudge demands wrap-up before the hard stop", () => {
    const text = AutonomousContinuationPrompt.toolOnlyTurnNudge({
      consecutiveToolOnlyTurns: 30,
      maxToolOnlyTurns: 35,
      final: true,
    })

    expect(text).toContain("FINAL checkpoint")
    expect(text).toContain("Tools will be disabled on the next turn")
    expect(text).not.toContain("completing a turn with a text")
  })

  test("forced tool-only nudge tells the model tools are disabled this turn", () => {
    const text = AutonomousContinuationPrompt.toolOnlyTurnNudge({
      consecutiveToolOnlyTurns: 30,
      maxToolOnlyTurns: 35,
      final: true,
      forced: true,
    })

    expect(text).toContain("Tools are disabled for your next turn")
    expect(text).not.toContain("already received a forced wrap-up")
    expect(text).not.toContain("FINAL checkpoint before that stop")
  })

  test("repeat forced wrap-up mentions the earlier attempt", () => {
    const text = AutonomousContinuationPrompt.toolOnlyTurnNudge({
      consecutiveToolOnlyTurns: 36,
      maxToolOnlyTurns: 35,
      final: true,
      forced: true,
      repeat: true,
    })

    expect(text).toContain("already received a forced wrap-up")
    expect(text).toContain("Tools are disabled for your next turn")
  })

  test("builds pending-todo continuation guidance with stagnation detail", () => {
    const text = AutonomousContinuationPrompt.todoContinuation({
      pendingTodos,
      attempt: 3,
      maxAttempts: 10,
      includeReportClosureGuidance: true,
      stagnantTodoRetries: 2,
    })

    expect(text).toContain("1 todo still pending")
    expect(text).toContain("auto-continuation 3/10")
    expect(text).toContain("do not keep doing broad exploration")
    expect(text).toContain("has not changed for 2 retries")
  })
})
