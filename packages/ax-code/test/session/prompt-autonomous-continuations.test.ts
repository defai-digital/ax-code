import { describe, expect, test } from "vitest"
import { AutonomousContinuationPrompt } from "../../src/session/prompt-autonomous-continuations"

const pendingTodos = [
  { content: "Report confirmed bugs to .internal/bugs/", status: "in_progress", priority: "high" },
]

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

    expect(text).toContain("last 15 turns each ended in further tool calls")
    expect(text).toContain("stops automatically after 35 consecutive")
    expect(text).toContain("continue the remaining work after the synthesis")
    expect(text).toContain("resets this counter")
    // The streak only proves the finish reason was tool-calls; the model may
    // have produced narration text, and it may be doing legitimate
    // implementation work rather than exploring.
    expect(text).not.toContain("without producing any text response")
    expect(text).not.toContain("Stop broad exploration now")
  })

  test("final tool-only nudge demands wrap-up before the hard stop", () => {
    const text = AutonomousContinuationPrompt.toolOnlyTurnNudge({
      consecutiveToolOnlyTurns: 30,
      maxToolOnlyTurns: 35,
      final: true,
    })

    expect(text).toContain("FINAL checkpoint")
    expect(text).toContain("end your turn with a text response")
    expect(text).not.toContain("resets this counter")
  })

  test("forced tool-only nudge tells the model tools are disabled this turn", () => {
    const text = AutonomousContinuationPrompt.toolOnlyTurnNudge({
      consecutiveToolOnlyTurns: 30,
      maxToolOnlyTurns: 35,
      final: true,
      forced: true,
    })

    expect(text).toContain("already received one final checkpoint warning")
    expect(text).toContain("Tools are disabled for your next turn")
    expect(text).not.toContain("FINAL checkpoint before that stop")
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
