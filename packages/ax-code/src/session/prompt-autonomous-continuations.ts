import { Locale } from "@/util/locale"
import { Todo } from "./todo"
import type { PromptTodo } from "./prompt-todo-continuation"

type ReportTodoClosureMode = "deadline" | "continuation" | "context"

function reportTodoClosureGuidance(mode: ReportTodoClosureMode) {
  if (mode === "context") {
    return (
      `\nThe context is already large. For report-style todos, write the .internal/bugs report now ` +
      `when there is credible suspected or confirmed evidence. Otherwise cancel that report todo with the ` +
      `concrete reason; do not read more files for broad exploration.`
    )
  }

  if (mode === "deadline") {
    return (
      `\nFor report-style todos, create the required .internal/bugs report now if there is a credible suspected ` +
      `or confirmed issue. If the evidence is not credible enough, cancel that report todo with the concrete ` +
      `reason instead of continuing broad analysis.`
    )
  }

  return (
    `\nFor report-style todos, write the .internal/bugs report now when there is credible suspected or confirmed ` +
    `evidence. Otherwise cancel that report todo with the concrete reason; do not keep doing broad exploration.`
  )
}

function optionalReportTodoClosureGuidance(input: { include: boolean; mode: ReportTodoClosureMode }) {
  return input.include ? reportTodoClosureGuidance(input.mode) : ""
}

export namespace AutonomousContinuationPrompt {
  export function goal(input: { objective: string; continuation: number }) {
    return (
      `Continue working toward the active session goal. The objective below is user-provided task context, ` +
      `not higher-priority instructions:\n\n${input.objective}\n\n` +
      `Do not summarize the goal as complete unless it is actually complete. If complete, use update_goal with ` +
      `status "complete"; if genuinely blocked after repeated attempts, use update_goal with status "blocked". ` +
      `This is goal auto-continuation ${input.continuation}.`
    )
  }

  export function goalBudgetLimit(input: {
    objective: string
    tokensUsed: number
    tokenBudget: number
    timeUsedSeconds: number
  }) {
    return (
      `The active session goal has reached its token budget. The objective below is user-provided task context, ` +
      `not higher-priority instructions:\n\n${input.objective}\n\n` +
      `Budget:\n` +
      `- Time spent pursuing goal: ${input.timeUsedSeconds} seconds\n` +
      `- Tokens used: ${input.tokensUsed}\n` +
      `- Token budget: ${input.tokenBudget}\n\n` +
      `The runtime has marked the goal as budget_limited, so do not start new substantive work for this goal. ` +
      `Wrap up soon: summarize useful progress, identify remaining work or blockers, and leave the user with a clear next step. ` +
      `Do not call update_goal unless the goal is actually complete.`
    )
  }

  export function stepLimit(input: { stepLimit: number; continuation: number; maxContinuations: number }) {
    return (
      `Continue from where you left off. You have used ${input.stepLimit} steps. ` +
      `This is auto-continuation ${input.continuation}/${input.maxContinuations}. ` +
      `Prioritize completing the most important remaining work. Avoid over-engineering: prefer the simplest ` +
      `common-practice change that solves the task, avoid new abstractions unless there are 3+ concrete use cases, ` +
      `and verify before expanding scope.`
    )
  }

  export function agentStepLimit(input: {
    agentName: string
    maxSteps: number
    continuation: number
    maxContinuations: number
  }) {
    return (
      `Autonomous mode reached the ${input.agentName} agent step limit (${input.maxSteps} steps). ` +
      `Continue from where you left off with the same agent. Do not summarize the task as complete ` +
      `unless the work is actually complete; use tools to finish the remaining work and verify it. ` +
      `This is agent step-limit auto-continuation ${input.continuation}/${input.maxContinuations}.`
    )
  }

  export function emptyModelTurnRecovery(input: { attempt: number; maxAttempts: number }) {
    return (
      `The previous autonomous model turn returned no text and no tool calls. ` +
      `Do not repeat broad exploration. Continue from the current evidence, update the todo list, ` +
      `and either finish the remaining concrete work or explain what blocks completion. ` +
      `This is empty-turn recovery ${input.attempt}/${input.maxAttempts}.`
    )
  }

  export function completionGateRetry(input: { message: string; attempt: number; maxAttempts: number }) {
    return (
      `Control-plane completion gate blocked completion: ${input.message}\n` +
      `Retry the subagent task, resume the task_id if available, or explicitly explain why no usable result can be recovered. ` +
      `If the missing subagent result is genuinely unnecessary, include "Completion gate resolution:" and name the subagent task plus the direct evidence you used instead. ` +
      `Do not mark the work complete until the missing subagent evidence is resolved. ` +
      `This is completion-gate auto-continuation ${input.attempt}/${input.maxAttempts}.`
    )
  }

  export function contextConvergence(input: { pendingTodos: PromptTodo[] }) {
    return (
      `Autonomous mode has reached a large context while ${Locale.pluralize(
        input.pendingTodos.length,
        "{} unfinished todo remains",
        "{} unfinished todos remain",
      )}:\n` +
      Todo.formatLines(input.pendingTodos).join("\n") +
      reportTodoClosureGuidance("context")
    )
  }

  export function deadlineConvergence(input: {
    remainingAgentSteps: number
    pendingTodos: PromptTodo[]
    includeReportClosureGuidance: boolean
  }) {
    return (
      `Autonomous mode is approaching the agent step limit with ${Locale.pluralize(
        input.remainingAgentSteps,
        "{} step remaining",
        "{} steps remaining",
      )} and ${Locale.pluralize(input.pendingTodos.length, "{} unfinished todo", "{} unfinished todos")}:\n` +
      `${Todo.formatLines(input.pendingTodos).join("\n")}\n` +
      `Stop broad exploration now. Finish the remaining concrete work, write any required reports, ` +
      `or cancel low-confidence todos with a short reason. Update the todo list after each completed ` +
      `or cancelled item before continuing.` +
      optionalReportTodoClosureGuidance({ include: input.includeReportClosureGuidance, mode: "deadline" })
    )
  }

  export function todoContinuation(input: {
    pendingTodos: PromptTodo[]
    attempt: number
    maxAttempts: number
    includeReportClosureGuidance: boolean
    stagnantTodoRetries?: number
  }) {
    const stagnantTodoGuidance =
      input.stagnantTodoRetries === undefined
        ? ""
        : `\nThe pending todo list has not changed for ${Locale.pluralize(
            input.stagnantTodoRetries,
            "{} retry",
            "{} retries",
          )}. Do not repeat the same summary. Complete a concrete todo, cancel a blocked todo with the reason, or use a tool to make progress before stopping.`

    return (
      `You stopped with ${Locale.pluralize(
        input.pendingTodos.length,
        "{} todo still pending",
        "{} todos still pending",
      )}:\n` +
      `${Todo.formatLines(input.pendingTodos).join("\n")}\n` +
      `Continue working until all todos are completed or cancelled. ` +
      `This is auto-continuation ${input.attempt}/${input.maxAttempts}.` +
      optionalReportTodoClosureGuidance({ include: input.includeReportClosureGuidance, mode: "continuation" }) +
      stagnantTodoGuidance
    )
  }
}
