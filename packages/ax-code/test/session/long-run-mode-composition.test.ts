/**
 * Mode-composition contract tests for goal × autonomous × Super-Long.
 *
 * These call the shipped pure decision / gate / limit exports with fixtures —
 * not re-implementations — so a silent regression in any long-run control
 * point fails here without needing a multi-hour live agent run.
 */
import { describe, expect, test } from "vitest"
import { AutonomousCompletionGate } from "../../src/control-plane/autonomous-completion-gate"
import { GLOBAL_STEP_LIMIT, SUPER_LONG_TOTAL_STEP_HEADROOM } from "../../src/constants/session"
import { GoalVerification } from "../../src/session/goal-verification"
import {
  effectiveContinuationCap,
  emptyModelTurnDecision,
  globalStepLimitDecision,
  goalContinuationDecision,
  totalStepLimitDecision,
  truncatedModelTurnDecision,
} from "../../src/session/prompt-autonomous-decisions"
import { promptLoopLimits } from "../../src/session/prompt-loop-config"
import { SuperLongPolicy } from "../../src/session/super-long-policy"

describe("long-run mode composition", () => {
  test("active goal lifts continuation cap so step-limit cannot starve it past max_continuations", () => {
    const maxContinuations = 3
    const cap = effectiveContinuationCap({
      maxContinuations,
      superLongActive: false,
      goalStatus: "active",
    })
    expect(cap).toBe(Number.POSITIVE_INFINITY)

    // With the lifted cap, the global step-limit gate keeps continuing.
    const decision = globalStepLimitDecision({
      step: 500,
      stepLimit: 500,
      autonomous: true,
      continuations: maxContinuations + 5,
      maxContinuations: cap,
    })
    expect(decision.action).toBe("continue")
    if (decision.action !== "continue") throw new Error("expected continue")
    expect(decision.continuation).toBe(maxContinuations + 6)
  })

  test("without goal or Super-Long the ordinary continuation cap still stops", () => {
    const maxContinuations = 3
    const cap = effectiveContinuationCap({
      maxContinuations,
      superLongActive: false,
      goalStatus: "paused",
    })
    expect(cap).toBe(3)

    const decision = globalStepLimitDecision({
      step: 10,
      stepLimit: 10,
      autonomous: true,
      continuations: 3,
      maxContinuations: cap,
    })
    expect(decision.action).toBe("stop")
  })

  test("Super-Long lifts continuation cap but total-step ceiling still stops the run", () => {
    const limits = promptLoopLimits({ session: { max_steps: 10, max_continuations: 2 } } as any)
    expect(limits.maxTotalStepsSuperLong).toBe(10 * SUPER_LONG_TOTAL_STEP_HEADROOM)
    expect(limits.maxTotalSteps).toBe(10 * 3)

    const cap = effectiveContinuationCap({
      maxContinuations: limits.maxContinuations,
      superLongActive: true,
      goalStatus: undefined,
    })
    expect(cap).toBe(Number.POSITIVE_INFINITY)

    // Continuation path stays open under Super-Long...
    expect(
      globalStepLimitDecision({
        step: 10,
        stepLimit: 10,
        autonomous: true,
        continuations: 999,
        maxContinuations: cap,
      }).action,
    ).toBe("continue")

    // ...but the cumulative ceiling is always binding.
    const total = totalStepLimitDecision({
      totalSteps: limits.maxTotalStepsSuperLong,
      totalStepLimit: limits.maxTotalStepsSuperLong,
      continuations: 999,
    })
    expect(total.action).toBe("stop")
    if (total.action !== "stop") throw new Error("expected stop")
    expect(total.errorCode).toBe("TOTAL_STEP_LIMIT")
  })

  test("active goal + Super-Long compose: cap lifted, total-step still hard-stops", () => {
    const limits = promptLoopLimits({ session: undefined } as any)
    expect(limits.sessionStepLimit).toBe(GLOBAL_STEP_LIMIT)
    expect(limits.maxTotalStepsSuperLong).toBe(GLOBAL_STEP_LIMIT * SUPER_LONG_TOTAL_STEP_HEADROOM)

    const cap = effectiveContinuationCap({
      maxContinuations: limits.maxContinuations,
      superLongActive: true,
      goalStatus: "active",
    })
    expect(cap).toBe(Number.POSITIVE_INFINITY)

    // Goal auto-continuation itself ignores maxContinuations.
    expect(
      goalContinuationDecision({
        goal: {
          objective: "ship the contract",
          status: "active",
          tokensUsed: 1,
          timeUsedSeconds: 1,
        },
        continuations: 10_000,
        budgetWrapUp: "none",
      }).action,
    ).toBe("continue_active")

    expect(
      totalStepLimitDecision({
        totalSteps: limits.maxTotalStepsSuperLong,
        totalStepLimit: limits.maxTotalStepsSuperLong,
        continuations: 10_000,
      }).action,
    ).toBe("stop")
  })

  test("budget wrap-up fires once per budget cycle and then stops (not re-fire when concluded)", () => {
    const goal = {
      objective: "finish work",
      status: "budget_limited" as const,
      tokenBudget: 100,
      tokensUsed: 120,
      timeUsedSeconds: 9,
    }

    const wrapUp = goalContinuationDecision({
      goal,
      continuations: 25, // past ordinary max_continuations
      budgetWrapUp: "none",
    })
    expect(wrapUp.action).toBe("continue_budget_wrapup")

    const afterSent = goalContinuationDecision({
      goal,
      continuations: 26,
      budgetWrapUp: "sent",
    })
    expect(afterSent.action).toBe("stop_budget_limit")

    const concluded = goalContinuationDecision({
      goal,
      continuations: 0,
      budgetWrapUp: "concluded",
    })
    expect(concluded.action).toBe("ignore")
  })

  test("empty and truncated model turns recover then stop incomplete (not success)", () => {
    const emptyRecover = emptyModelTurnDecision({
      emptyModelTurn: true,
      emptyModelTurnRetries: 0,
      maxEmptyModelTurnRetries: 1,
      todoRetries: 0,
    })
    expect(emptyRecover.action).toBe("recover")

    const emptyStop = emptyModelTurnDecision({
      emptyModelTurn: true,
      emptyModelTurnRetries: 1,
      maxEmptyModelTurnRetries: 1,
      todoRetries: 0,
    })
    expect(emptyStop.action).toBe("stop")
    if (emptyStop.action !== "stop") throw new Error("expected stop")
    expect(emptyStop.errorCode).toBe("EMPTY_MODEL_TURN")
    expect(emptyStop.message).toMatch(/should not be treated as complete/i)

    const truncRecover = truncatedModelTurnDecision({
      truncatedModelTurn: true,
      truncatedModelTurnRetries: 0,
      maxTruncatedModelTurnRetries: 3,
    })
    expect(truncRecover.action).toBe("recover")

    const truncStop = truncatedModelTurnDecision({
      truncatedModelTurn: true,
      truncatedModelTurnRetries: 3,
      maxTruncatedModelTurnRetries: 3,
    })
    expect(truncStop.action).toBe("stop")
    if (truncStop.action !== "stop") throw new Error("expected stop")
    expect(truncStop.errorCode).toBe("TRUNCATED_MODEL_TURN")
  })

  test("completion gate blocks unfinished todos, empty subagent results, and unexecutable tool text", () => {
    expect(
      AutonomousCompletionGate.evaluate({
        messages: [],
        pendingTodos: [{ content: "still open", status: "pending", priority: "high" }],
      }),
    ).toMatchObject({ status: "blocked", reason: "unfinished_todos" })

    expect(
      AutonomousCompletionGate.evaluate({
        messages: [
          {
            info: { role: "assistant" },
            parts: [
              {
                type: "tool",
                tool: "task",
                callID: "call_1",
                state: {
                  status: "completed",
                  output: "Subagent completed without a final response.",
                  metadata: { emptyResult: true, sessionId: "ses_sub" },
                  input: { description: "explore" },
                },
              },
            ],
          },
        ],
        pendingTodos: [],
      }),
    ).toMatchObject({ status: "blocked", reason: "empty_subagent_result" })

    expect(
      AutonomousCompletionGate.evaluate({
        messages: [
          {
            info: { role: "assistant" },
            parts: [
              {
                type: "text",
                text: "<tool_call>\nname: bash\n</tool_call>",
              },
            ],
          },
        ],
        pendingTodos: [],
      }),
    ).toMatchObject({ status: "blocked", reason: "unexecutable_tool_text" })

    expect(
      AutonomousCompletionGate.evaluate({
        messages: [{ info: { role: "assistant" }, parts: [{ type: "text", text: "done" }] }],
        pendingTodos: [],
      }),
    ).toEqual({ status: "allow" })
  })

  test("update_goal complete evidence gate rejects pending todos and unverified mutations", () => {
    expect(
      GoalVerification.decide({
        messages: [],
        pendingTodos: [{ status: "pending" }],
      }),
    ).toMatchObject({ ok: false, reason: "pending_todos" })

    expect(
      GoalVerification.decide({
        messages: [
          {
            info: { role: "assistant", time: { created: 100 } },
            parts: [
              {
                type: "tool",
                tool: "edit",
                state: { status: "completed", input: {} },
              },
            ],
          },
        ],
        pendingTodos: [],
        since: 50,
      }),
    ).toMatchObject({ ok: false, reason: "unverified_changes" })

    expect(
      GoalVerification.decide({
        messages: [
          {
            info: { role: "assistant", time: { created: 100 } },
            parts: [
              {
                type: "tool",
                tool: "edit",
                state: { status: "completed", input: {} },
              },
              {
                type: "tool",
                tool: "bash",
                state: {
                  status: "completed",
                  input: { command: "bun test packages/ax-code/test/session/goal.test.ts" },
                  metadata: { exit: 0 },
                },
              },
            ],
          },
        ],
        pendingTodos: [],
        since: 50,
      }),
    ).toEqual({ ok: true })
  })

  test("Super-Long deadline expiry degrades rather than permanently bricking later prompts", () => {
    const startedAt = 0
    const durationMs = 72 * 60 * 60 * 1000

    const midRun = SuperLongPolicy.deadline({
      enabled: true,
      startedAt,
      now: durationMs - 1,
      requestedDurationMs: durationMs,
    })
    expect(midRun.ok).toBe(true)
    if (!midRun.ok) throw new Error("expected ok")
    expect(midRun.expired).toBe(false)

    const expired = SuperLongPolicy.deadline({
      enabled: true,
      startedAt,
      now: durationMs,
      requestedDurationMs: durationMs,
    })
    expect(expired.ok).toBe(true)
    if (!expired.ok) throw new Error("expected ok")
    expect(expired.expired).toBe(true)

    // enforceSuperLongDeadline (tested separately) degrades when lastUser
    // was created after startedAt + durationMs. Policy still reports expired
    // so the loop can choose stop-vs-degrade.
    const stop = SuperLongPolicy.deadlineStopDecision({
      deadline: expired,
      source: "config",
    })
    expect(stop.action).toBe("stop")
    if (stop.action !== "stop") throw new Error("expected stop")
    expect(stop.errorCode).toBe("SUPER_LONG_DEADLINE_REACHED")
  })

  test("provider pacing applies for non-local providers and is skipped for local ones", () => {
    expect(SuperLongPolicy.providerPacing("openai")).toEqual(
      expect.objectContaining({ windowMs: 60_000, maxRequests: 6, minDelayMs: 5_000 }),
    )
    expect(SuperLongPolicy.providerPacing("alibaba-cn")).toEqual(
      expect.objectContaining({ maxRequests: 4, minDelayMs: 10_000 }),
    )
    expect(SuperLongPolicy.providerPacing("ollama")).toBeUndefined()
    expect(SuperLongPolicy.providerPacing("custom", { baseURL: "http://127.0.0.1:11434" })).toBeUndefined()
  })
})
