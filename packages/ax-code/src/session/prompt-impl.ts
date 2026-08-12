import { SessionID } from "./schema"
import { MessageV2 } from "./message-v2"
import { Log } from "../util/log"
import { SessionRevert } from "./revert"
import { Session } from "."
import { Agent } from "../agent/agent"
import { providerModelKey } from "../provider/model-key"
import { Provider } from "../provider/provider"
import { ProviderID } from "../provider/schema"
import { SessionCompaction } from "./compaction"
import { SessionRetry } from "./retry"
import { BlastRadius } from "./blast-radius"
import { AutonomousCompletionGate } from "../control-plane/autonomous-completion-gate"
import { Instance } from "../project/instance"
import { defer } from "../util/defer"
import { ScopedFlag } from "../flag/scoped"
import { Todo } from "./todo"
import { SessionGoal } from "./goal"
import { Config } from "@/config/config"
import { fn } from "@/util/fn"
import { agentInfo, modelInfo } from "./prompt-agent-model-info"
import { processorLoopDecision } from "./prompt-loop-decisions"
import {
  maybeSchedulePreflightCompaction,
  maybeScheduleUsageCompaction,
  processPendingCompaction,
} from "./prompt-loop-compaction"
import { resolvePromptLoopErrorTransition } from "./prompt-loop-errors"
import { resolvePromptLoopAssistantExit } from "./prompt-loop-exit"
import { handlePromptLoopGoalContinuation } from "./prompt-loop-goal"
import { handlePromptLoopAgentStepLimit } from "./prompt-loop-agent-step-limit"
import { emitPromptLoopCompletionGateDecision } from "./prompt-loop-completion-gate"
import { handlePromptLoopCompletionGateRetry } from "./prompt-loop-completion-gate-retry"
import { handlePromptLoopEmptyTurn } from "./prompt-loop-empty-turn"
import {
  handlePromptLoopTruncatedTurn,
  isLargeTruncatedCodePaste,
  truncatedModelOutputPrefix,
} from "./prompt-loop-truncated-turn"
import { handlePromptLoopTodoConvergence } from "./prompt-loop-todo-convergence"
import { handlePromptLoopTodoContinuation } from "./prompt-loop-todo-continuation"
import { appendNewerMessages, loopMessages, scanLoopMessages } from "./prompt-loop-messages"
import { finishPromptLoopQueue } from "./prompt-loop-queue"
import { beginPromptLoopRecording, finishPromptLoopRecording, type PromptLoopEndReason } from "./prompt-loop-recording"
import { resolvePromptLoopResult } from "./prompt-loop-result"
import { markPromptLoopBusy } from "./prompt-loop-status"
import { handlePromptLoopGlobalStepLimit } from "./prompt-loop-step-limit"
import { handlePromptLoopTotalStepLimit } from "./prompt-loop-total-step-limit"
import { preparePromptRequest, type PromptRequestCache } from "./prompt-request-build"
import { createStructuredOutputTurn } from "./prompt-structured-output"
import { publishPromptFailure, createSyntheticFailureAssistant } from "./prompt-loop-failure"
import { executeSubtask } from "./prompt-subtask"
import { resolveTools, shouldBypassAgentCheck } from "./prompt-tools"
import { clearPromptProcessorInstructions, createPromptProcessor } from "./prompt-processor"
import { addPromptGoalUsage } from "./prompt-goal-usage"
import {
  effectiveContinuationCap,
  effectiveTotalStepLimit,
  goalCompleteForceTextDecision,
  goalLongRunActive,
  emptyModelTurnIncompleteMessage,
  hasSuccessfulGoalCompleteTool,
  hasLargeSuccessfulReadOnlyOutput,
  hasUsableReadOnlyEvidence,
  isReadOnlyExplorationTurn,
  isEmptyModelTurn,
  isTruncatedModelTurn,
  modelTurnFinished,
  readOnlyExplorationDecision,
  resolveTurnToolChoice,
  shouldRestoreForcedTextOnlyTurn,
  toolOnlyTurnDecision,
  unexecutableToolTextRecoveryDecision,
  type ForceTextReason,
  type GoalBudgetWrapUp,
} from "./prompt-autonomous-decisions"
import { toErrorMessage } from "../util/error-message"
import { insertReminders } from "./prompt-reminders"
import { executeShellCommand } from "./prompt-shell-command"
import { executePromptCommand } from "./prompt-command-execution"
import { createDeferredCodeGraphAutoIndex } from "./prompt-code-graph"
import { recordPromptSessionStart } from "./prompt-session-start"
import { scheduleFirstTurnSummary } from "./prompt-session-summary"
import { enforceSuperLongDeadline } from "./prompt-super-long"
import { SuperLongPolicy } from "./super-long-policy"
import { AutonomousContinuationPrompt } from "./prompt-autonomous-continuations"
import { createAutonomousTextContinuation, createUserMessage } from "./prompt-user-message"
import { permissionRulesetFromLegacyTools } from "./prompt-permission"
import { resolvePromptIsolationPolicy } from "./prompt-runtime-policy"
import { createPromptRunState } from "./prompt-run-state"
import { resolvePromptCache, type PromptCacheEntry } from "./prompt-cache"
import {
  detectTurnExecutionProfile,
  RESPONSE_ONLY_SYSTEM_PROMPT,
  responseOnlyUsesFastReasoning,
  type TurnExecutionProfile,
} from "./prompt-turn-profile"
import { SystemPrompt } from "./system"
import {
  AX_ENGINE_LARGE_TOOL_OUTPUT_CHARS,
  AX_ENGINE_MAX_TRUNCATED_MODEL_TURN_RETRIES,
  AX_ENGINE_READ_ONLY_TURN_FORCE,
  AX_ENGINE_READ_ONLY_TURN_NUDGE,
  AX_ENGINE_TRUNCATED_CODE_RECOVERY_MAX_OUTPUT_TOKENS,
  AX_ENGINE_TRUNCATED_RECOVERY_MAX_OUTPUT_TOKENS,
  MAX_UNEXECUTABLE_TOOL_TEXT_RECOVERIES,
  effectivePacingMaxSteps,
  promptLoopLimits,
} from "./prompt-loop-config"
import { AX_ENGINE_PROVIDER_ID } from "@/provider/ax-engine/constants"
import { GOAL_CEILING_CONVERGENCE_STEPS } from "@/constants/session"
import {
  CommandInput as CommandInputSchema,
  type CommandInput as CommandInputType,
  LoopInput as LoopInputSchema,
  type LoopInput as LoopInputType,
  PromptInput as PromptInputSchema,
  type PromptInput as PromptInputType,
  ShellInput as ShellInputSchema,
  type ShellInput as ShellInputType,
} from "./prompt-input"

// @ts-ignore — suppresses ai-sdk stdout log warnings.
// See: https://github.com/vercel/ai/blob/2dc67e0ef538307f21368db32d5a12345d98831b/packages/ai/src/logger/log-warnings.ts#L85
globalThis.AI_SDK_LOG_WARNINGS = false

const STRUCTURED_OUTPUT_SYSTEM_PROMPT = `IMPORTANT: The user has requested structured output. You MUST use the StructuredOutput tool to provide your final response. Do NOT respond with plain text - you MUST call the StructuredOutput tool with your answer formatted according to the schema.`

// Turns the (often opaque) provider/stream error captured for an empty turn
// into a short, single-line cause for the stop diagnostic. Returns undefined
// when no error was recorded so the message falls back to its generic form.
function describeStreamErrorCause(error: unknown): string | undefined {
  if (error === undefined || error === null) return undefined
  const message = toErrorMessage(error).trim()
  if (!message) return undefined
  return message.length > 300 ? `${message.slice(0, 297)}...` : message
}

function modelOutputText(messages: MessageV2.WithParts[], messageID: MessageV2.Info["id"]): string | undefined {
  const message = messages.find((item) => item.info.id === messageID)
  if (!message) return undefined
  const text = message.parts
    .filter((part): part is MessageV2.TextPart => part.type === "text" && !part.synthetic)
    .map((part) => part.text)
    .join("\n")
  return text || undefined
}

export namespace SessionPrompt {
  const log = Log.create({ service: "session.prompt" })
  const runState = createPromptRunState()

  export function assertNotBusy(sessionID: SessionID) {
    runState.assertNotBusy(sessionID)
  }

  export const PromptInput = PromptInputSchema
  export type PromptInput = PromptInputType

  export const prompt = fn(PromptInput, async (input) => {
    const session = await Session.get(input.sessionID)

    // User lifecycle hooks (UserPromptSubmit): a blockOnFailure hook can veto
    // the prompt before the user message is persisted. This must run BEFORE
    // SessionRevert.cleanup — cleanup permanently deletes reverted messages,
    // and a vetoed prompt must not destroy the user's undo history.
    // Synthetic continuation prompts (agentRouting: "preserve") and subagent
    // child sessions are exempt so internal flows cannot be wedged by a
    // misbehaving hook.
    if (input.agentRouting !== "preserve" && !session.parentID) {
      let blockedDetail: string | undefined
      try {
        const { LifecycleHooks } = await import("@/hooks/lifecycle")
        const promptText = input.parts
          .filter((part) => part.type === "text")
          .map((part) => part.text)
          .join("\n")
        const submit = await LifecycleHooks.runForWorkspace({
          event: "UserPromptSubmit",
          sessionID: input.sessionID,
          args: { prompt: promptText },
        })
        if (submit.blocked) {
          blockedDetail =
            submit.outputs
              .filter((o) => o.exit !== 0)
              .map((o) => o.stderr || o.stdout || `exit ${o.exit}`)
              .join("\n") || "hook failed"
        }
      } catch (error) {
        // Hook load/run failures must not brick prompting.
        log.warn("UserPromptSubmit lifecycle hooks failed", { sessionID: input.sessionID, error })
      }
      if (blockedDetail !== undefined) {
        throw new Error(`UserPromptSubmit hook blocked prompt: ${blockedDetail}`)
      }
    }

    await SessionRevert.cleanup(session)

    const message = await createUserMessage(input)
    await Session.touch(input.sessionID)

    // Backwards compatibility for legacy prompt-time `tools` toggles.
    const permissions = permissionRulesetFromLegacyTools(input.tools)
    if (permissions.length > 0 && input.toolsScope !== "turn") {
      session.permission = permissions
      await Session.setPermission({ sessionID: session.id, permission: permissions })
    }

    if (input.noReply === true) {
      return message
    }

    return loop({ sessionID: input.sessionID })
  })

  function start(sessionID: SessionID) {
    return runState.start(sessionID)
  }

  function resume(sessionID: SessionID) {
    return runState.resume(sessionID)
  }

  export async function cancel(sessionID: SessionID) {
    log.info("cancel", { command: "session.prompt.cancel", status: "started", sessionID })
    return runState.cancel(sessionID)
  }

  export const LoopInput = LoopInputSchema
  export type LoopInput = LoopInputType
  export const loop = fn(LoopInput, async (input) => {
    const { sessionID, resume_existing } = input

    const resumedAbort = resume_existing ? resume(sessionID) : undefined
    const isResumingActiveLoop = resumedAbort !== undefined
    const abort = isResumingActiveLoop ? undefined : start(sessionID)
    if (!abort) {
      return new Promise<MessageV2.WithParts>((resolve, reject) => {
        // Capture atomically: a concurrent cancel() may have deleted the
        // state entry between the `start()` check above and this access,
        // which previously threw TypeError: Cannot read properties of
        // undefined (reading 'callbacks').
        if (!runState.enqueue(sessionID, { resolve, reject })) {
          reject(new Error("Session was cancelled"))
        }
      })
    }

    const loopTimer = log.time("loop", {
      sessionID,
      resumeExisting: isResumingActiveLoop,
    })
    await using _loopTimer = defer(() => loopTimer.stop())
    await using _ = defer(() => {
      return finishPromptLoopQueue({
        sessionID,
        reason,
        queuedCallbacks: runState.queuedCallbacks,
        markIdle: runState.markIdle,
        cancel,
        resumeLoop: loop,
      })
    })
    let sessionStarted = false
    await using _recorder = defer(async () => {
      await finishPromptLoopRecording({ sessionID, sessionStarted, isResumingActiveLoop, reason, totalSteps })
    })
    beginPromptLoopRecording(sessionID)
    // Idempotent — primary warmup happens in InstanceBootstrap so providers
    // load in the background while the UI renders. This is a fallback in
    // case the prompt loop is entered without a full bootstrap.
    Provider.warmup()

    let step = 0
    let totalSteps = 0
    let lastProducedAssistantID: string | undefined
    // Bookkeeping for the durable Super-Long step counter: how many of
    // `totalSteps` have already been reported to the runtime store, and the
    // cumulative cross-invocation count it returned. The durable count is
    // what the Super-Long ceiling checks, so a crash/restart cannot hand a
    // long run a fresh step budget.
    let reportedSuperLongSteps = 0
    let durableSuperLongSteps = 0
    // IMPORTANT: every break path inside the loop MUST set `reason` first.
    // The default "error" is the correct catch-all for unexpected throws,
    // but a break without a prior assignment will misreport a completed session.
    let reason: PromptLoopEndReason = "error"
    let consecutiveErrors = 0
    let continuations = 0
    // Budget wrap-up state for the session goal. Seeded from the DURABLE
    // goal status below (after the session loads): a goal that was already
    // budget_limited when this run started had its single wrap-up turn in an
    // earlier run — without the seed, every new user prompt in the session
    // (and the first prompt of a forked session) would re-fire the wrap-up
    // turn and then stop with a spurious budget error.
    let goalBudgetWrapUp: GoalBudgetWrapUp = "none"
    // Whether Super-Long mode was active (enabled and unexpired) as of the
    // most recent deadline check. While active, the continuation cap is
    // lifted — the Super-Long deadline, doom-loop detection, and
    // blast-radius caps are the guardrails instead, so a supervised long
    // run is not cut short by session.max_continuations.
    let superLongActive = false
    const deferredCodeGraphAutoIndex = createDeferredCodeGraphAutoIndex({ sessionID, abort })
    await using _autoIndex = defer(deferredCodeGraphAutoIndex.flush)
    const session = await Session.get(sessionID)
    // Pre-load expensive resources once before the loop
    const cfg = await Config.get()
    // Seed the budget wrap-up state from the durable goal status (see the
    // declaration comment). A transient read failure seeds "none", which at
    // worst repeats one wrap-up turn — never silently drops a goal.
    const initialGoal = await SessionGoal.get(sessionID).catch(() => undefined)
    if (initialGoal?.status === "budget_limited") goalBudgetWrapUp = "concluded"
    const {
      sessionStepLimit,
      maxContinuations,
      maxTotalSteps,
      maxTotalStepsSuperLong,
      maxTotalStepsGoal,
      maxTodoRetries,
      maxCompletionGateRetries,
      maxEmptyModelTurnRetries,
      maxTruncatedModelTurnRetries,
      autonomy: autonomyBudget,
    } = promptLoopLimits(cfg)
    const toolOnlyNudgeThreshold = autonomyBudget.toolOnly.nudge
    const toolOnlyFinalNudgeThreshold = autonomyBudget.toolOnly.finalNudge
    const maxToolOnlyTurns = autonomyBudget.toolOnly.maxTurns
    // One-shot guard for the goal ceiling-approach convergence warning: warn
    // once per goal (keyed by the goal's creation time, so a replacement goal
    // started later in the same run still gets its own warning), then let the
    // hard ceiling stop the run.
    let goalCeilingWarnedFor: number | undefined
    let todoRetries = 0
    let completionGateRetries = 0
    let lastCompletionGateSignature: string | undefined
    let lastPendingTodoSignature: string | undefined
    let lastTodoDeadlineSignature: string | undefined
    let lastTodoContextSignature: string | undefined
    let stagnantTodoRetries = 0
    let emptyModelTurnRetries = 0
    let truncatedModelTurnRetries = 0
    let previousTruncatedModelOutputPrefix: string | undefined
    // Consecutive outer-loop turns where the model only produced tool calls
    // (finish="tool-calls") without ever finishing with a text response.
    // Reset to 0 whenever the model finishes cleanly. If this exceeds
    // MAX_TOOL_ONLY_TURNS, the model is stuck in a read-only exploration
    // loop (e.g. endlessly listing directories) and we break out.
    let consecutiveToolOnlyTurns = 0
    // Number of nudge continuations injected during the current streak of
    // tool-only turns (first checkpoint at TOOL_ONLY_TURN_NUDGE, final
    // warning at TOOL_ONLY_TURN_FINAL_NUDGE). Reset alongside
    // consecutiveToolOnlyTurns.
    let toolOnlyNudges = 0
    // How many times the FINAL tool-only-turn checkpoint has fired this run.
    // Deliberately NOT reset alongside consecutiveToolOnlyTurns/toolOnlyNudges:
    // a model can trivially "reset the clock" by producing one completed-text
    // turn (even a token acknowledgment) right after the final checkpoint,
    // then resume a fresh tool-only streak with a full new budget — see #340.
    // The first final checkpoint is advisory (gives the model its existing
    // 5-turn buffer to wrap up on its own). If the streak reaches the final
    // checkpoint again afterward, the model already burned that grace period,
    // so forceTextOnlyTurn below strips tools from the very next request
    // instead of trusting another advisory nudge.
    let toolOnlyFinalCheckpointHits = 0
    let forceTextOnlyTurn = false
    // Why the current/pending force-text turn was requested. Recovery that
    // re-enables tools is only valid for ax_engine_read_only.
    let forceTextReason: ForceTextReason | undefined
    // True when the provider request currently being processed applied
    // toolChoice:"none" because forceTextOnlyTurn was consumed. Used to
    // recover once if the model pastes unexecutable tool markup instead of
    // answering — tools must be re-enabled for that recovery turn.
    let lastTurnWasForceTextOnly = false
    let lastTurnForceTextReason: ForceTextReason | undefined
    let unexecutableToolTextRecoveries = 0
    // AX Engine runtime control is request-local policy, not user content.
    // Keep the instruction in memory until a provider turn successfully
    // consumes it; never persist it as a synthetic chat message.
    let pendingAxEngineTurnInstruction: string | undefined
    // Hard max_tokens ceiling for the next provider request only (ax-engine
    // truncated recovery). Soft "keep it short" text is not enough on local
    // models that ignore word limits and re-fill the full model output budget.
    let pendingMaxOutputTokens: number | undefined
    let activeTurnProfile: TurnExecutionProfile | undefined
    let consecutiveAxEngineReadOnlyTurns = 0
    let axEngineReadOnlyNudged = false
    // Across the current ax-engine read-only streak: any successful tool.
    let axEngineReadOnlyHasEvidence = false
    // One-shot: deferred force after a large successful tool result this streak.
    let axEngineLargeEvidenceGraceUsed = false

    function armForceTextOnlyTurn(reason: ForceTextReason) {
      forceTextOnlyTurn = true
      forceTextReason = reason
    }
    const cachedSystemPrompt: PromptRequestCache = {
      environment: undefined,
      environmentModelKey: undefined,
      instructions: undefined,
    }
    // Cache agent/model info per loop to avoid repeated async lookups
    let cachedAgent: PromptCacheEntry<Agent.Info>
    let cachedModel: PromptCacheEntry<Provider.Model>
    let fallbackModelOverride: MessageV2.User["model"] | undefined
    const failedFallbackProviderIDs = new Set<ProviderID>()
    // Cache session history — only load from DB on first step, refresh on subsequent steps
    let cachedMsgs: MessageV2.WithParts[] | undefined
    // Hoisted so continueAutonomousLoop can reuse the latest in-memory list
    // without a full Session.messages() reload (PERF-01).
    let msgs: MessageV2.WithParts[] = []

    async function continueAutonomousLoop({
      text,
      event,
      logExtras = {},
      resetTodoDeadlineSignature = false,
    }: {
      text: string
      event: string
      logExtras?: Record<string, unknown>
      resetTodoDeadlineSignature?: boolean
    }) {
      continuations += 1
      step = 0
      consecutiveErrors = 0
      // Re-base the blast-radius step counter alongside the loop's own step
      // counter: both budgets are per continuation. Without this, the
      // continuation's first tool call threw AutonomousLimitExceededError
      // once cumulative tool calls passed caps.steps — killing goal and
      // Super-Long runs at a small fraction of their advertised step
      // budgets, via consecutive-error churn instead of a clean stop.
      // Files/lines caps intentionally stay cumulative.
      BlastRadius.resetSteps(sessionID)
      consecutiveToolOnlyTurns = 0
      toolOnlyNudges = 0
      consecutiveAxEngineReadOnlyTurns = 0
      axEngineReadOnlyNudged = false
      axEngineReadOnlyHasEvidence = false
      axEngineLargeEvidenceGraceUsed = false
      forceTextOnlyTurn = false
      forceTextReason = undefined
      lastTurnWasForceTextOnly = false
      lastTurnForceTextReason = undefined
      unexecutableToolTextRecoveries = 0
      pendingAxEngineTurnInstruction = undefined
      pendingMaxOutputTokens = undefined
      activeTurnProfile = undefined
      fallbackModelOverride = undefined
      failedFallbackProviderIDs.clear()
      cachedMsgs = undefined
      cachedAgent = undefined
      cachedModel = undefined
      completionGateRetries = 0
      lastCompletionGateSignature = undefined
      if (resetTodoDeadlineSignature) {
        lastTodoDeadlineSignature = undefined
      }
      // Todo progress tracking (todoRetries / stagnantTodoRetries /
      // lastPendingTodoSignature) deliberately survives continuation
      // boundaries: pendingTodoContinuationDecision refreshes the budgets
      // itself whenever the pending-todo content set actually changes, so a
      // continuation must not hand a stalled model a fresh retry budget.

      log.info(event, {
        command: "session.prompt.loop",
        status: "ok",
        sessionID,
        continuation: continuations,
        maxContinuations,
        ...logExtras,
      })
      // Reuse the in-loop message list: createAutonomousTextContinuation only
      // needs the last user (agent/model). Avoid a full Session.messages()
      // reload of the entire history on every auto-continuation.
      await createAutonomousTextContinuation({
        sessionID,
        messages: msgs,
        text,
      })
    }

    // Counter for consecutive compaction "busy" returns. Reset on any
    // non-busy compaction outcome (or any other task type) so the cap
    // only triggers on a genuinely stuck in-flight compaction, not on
    // accumulated busy events across unrelated turns.
    let compactionBusyRetries = 0
    let consecutiveContextOverflowCompactions = 0
    while (true) {
      await markPromptLoopBusy({ sessionID, step, maxSteps: sessionStepLimit, consecutiveErrors })
      if (abort.aborted) {
        reason = "aborted"
        break
      }

      // Goal continuation is autonomous continuation. The goal stays active
      // when autonomous mode is off, but the next turn must be user-driven.
      const activeGoal = await SessionGoal.get(sessionID)
      // Re-read the flag every iteration: Super-Long state is already
      // observed live (the routes flip env-backed state mid-run), so
      // autonomous must be too — otherwise a mid-run "Manual" toggle has no
      // effect on continuations while still silently retightening the
      // Super-Long ceiling, an inconsistent half-applied state.
      const effectivelyAutonomous = ScopedFlag.autonomous()

      // On step 0 or after compaction, load full history. Otherwise only fetch new messages.
      ;({ msgs, cached: cachedMsgs } = await loopMessages({ sessionID, cached: cachedMsgs }))

      let { lastUser, lastUserParts, lastAssistant, lastFinished, tasks } = scanLoopMessages(msgs)

      if (!lastUser) throw new Error("No user message found in stream. This should never happen.")
      if (fallbackModelOverride) {
        lastUser = {
          ...lastUser,
          model: fallbackModelOverride,
        }
      }
      // Deadline check runs BEFORE the step-cap gates so `superLongActive`
      // reflects THIS iteration when selecting the cumulative ceiling and
      // continuation cap (it was previously one iteration stale).
      const superLongDeadline = await enforceSuperLongDeadline({
        sessionID,
        lastUser,
        lastAssistant,
        autonomous: effectivelyAutonomous,
        config: SuperLongPolicy.fromConfig(cfg.super_long),
        stepsSinceLastCheck: totalSteps - reportedSuperLongSteps,
      })
      if (superLongDeadline.action === "stop") {
        if (superLongDeadline.invalidatedMessages) cachedMsgs = undefined
        // The deadline ends the long run, not the user's goal. Pause an
        // active goal so it is explicitly resumable instead of being left
        // "active" forever in a session that will not auto-continue. The
        // pause can reject (e.g. the goal was cleared concurrently over the
        // server API between the loop-top fetch and here) — that must not
        // convert this graceful deadline stop into an error path, and the
        // "was paused" notice is only published when the pause actually took.
        if (activeGoal?.status === "active") {
          const paused = await SessionGoal.pause(sessionID).then(
            () => true,
            (error) => {
              log.warn("failed to pause goal at Super-Long deadline", {
                command: "session.prompt.loop",
                status: "error",
                sessionID,
                error,
              })
              return false
            },
          )
          if (paused) {
            Session.publishError({
              sessionID,
              message:
                `The session goal "${activeGoal.objective}" was paused because the Super-Long runtime ceiling was reached. ` +
                `Resume it with /goal resume in a new supervised run.`,
            })
          }
        }
        reason = superLongDeadline.reason
        break
      }
      superLongActive = superLongDeadline.enabled
      if (superLongDeadline.durableTotalSteps !== undefined) {
        reportedSuperLongSteps = totalSteps
        durableSuperLongSteps = superLongDeadline.durableTotalSteps
      }

      // Cumulative ceiling first: `totalSteps` is never reset by
      // continueAutonomousLoop, so this is the one bound that active goals
      // (no continuation cap) and Super-Long (continuation cap lifted)
      // cannot bypass. For Super-Long the durable cross-invocation count is
      // used, so a crash/restart cannot reset the budget. The
      // per-continuation limit below governs pacing; this governs the run.
      // Goal runs select the long-run ceiling: they lift the continuation
      // cap like Super-Long, and the plain-autonomous default ended
      // legitimate goal runs with a step-limit error (the goal's own budget,
      // verification gate, and the breakers below remain the working bounds).
      // The in-run budget wrap-up phase (budget_limited, wrap-up not yet
      // concluded) keeps the long-run ceiling — dropping back to the plain
      // ceiling when the status flips mid-run would step-limit-stop the run
      // before the wrap-up turn ever executes.
      const goalLongRun = goalLongRunActive({ goalStatus: activeGoal?.status, budgetWrapUp: goalBudgetWrapUp })
      const effectiveTotalSteps = superLongActive ? Math.max(totalSteps, durableSuperLongSteps) : totalSteps
      const totalStepCeiling = effectiveTotalStepLimit({
        superLongActive,
        goalLongRun,
        maxTotalSteps,
        maxTotalStepsSuperLong,
        maxTotalStepsGoal,
      })
      const totalStepLimit = await handlePromptLoopTotalStepLimit({
        sessionID,
        totalSteps: effectiveTotalSteps,
        totalStepLimit: totalStepCeiling,
        continuations,
        goal: activeGoal,
      })
      if (totalStepLimit.action === "stop") {
        // lastUser already scanned from the in-loop message list — no full DB reload.
        await createSyntheticFailureAssistant({
          sessionID,
          lastUser,
          message: totalStepLimit.message,
        })
        reason = totalStepLimit.reason
        break
      }

      // Per-continuation pacing limit. NOTE: `step` resets to 0 on every
      // continuation, so this alone does not bound the run — the cumulative
      // check above does. Active goals and Super-Long lift the ordinary
      // continuation cap so they are not starved at this gate.
      const effectiveMaxContinuations = effectiveContinuationCap({
        maxContinuations,
        superLongActive,
        goalStatus: activeGoal?.status,
      })
      const globalStepLimit = handlePromptLoopGlobalStepLimit({
        sessionID,
        step,
        stepLimit: sessionStepLimit,
        autonomous: effectivelyAutonomous,
        continuations,
        maxContinuations: effectiveMaxContinuations,
      })
      if (globalStepLimit.action === "continue_autonomous") {
        await continueAutonomousLoop({
          event: "autonomous auto-continue",
          text: globalStepLimit.text,
        })
        continue
      }
      if (globalStepLimit.action === "stop") {
        // Create a synthetic failure message so the transcript ends with a
        // clear explanation rather than just a Bus event / toast.
        await createSyntheticFailureAssistant({
          sessionID,
          lastUser,
          message: globalStepLimit.message,
        })
        reason = globalStepLimit.reason
        break
      }

      // One-shot convergence warning before the cumulative ceiling ends an
      // active-goal run: give the model a bounded wrap-up window (verify and
      // complete the goal, or summarize a hand-off) instead of letting the
      // hard stop above kill the run mid-edit. Checked at the loop top rather
      // than in the goal-continuation prompt because todo-driven continuations
      // preempt goal continuations while todos are pending and would starve
      // the warning there.
      if (
        effectivelyAutonomous &&
        activeGoal?.status === "active" &&
        goalCeilingWarnedFor !== activeGoal.time.created &&
        Number.isFinite(totalStepCeiling)
      ) {
        const remainingTotalSteps = totalStepCeiling - effectiveTotalSteps
        if (remainingTotalSteps > 0 && remainingTotalSteps <= GOAL_CEILING_CONVERGENCE_STEPS) {
          goalCeilingWarnedFor = activeGoal.time.created
          log.info("goal ceiling convergence warning", {
            command: "session.prompt.loop",
            status: "nudge",
            sessionID,
            remainingTotalSteps,
            totalStepLimit: totalStepCeiling,
          })
          await createAutonomousTextContinuation({
            sessionID,
            messages: msgs,
            text: AutonomousContinuationPrompt.goalCeilingApproach({
              objective: activeGoal.objective,
              remainingTotalSteps,
              totalStepLimit: totalStepCeiling,
            }),
          })
          continue
        }
      }
      const assistantExit = resolvePromptLoopAssistantExit({
        sessionID,
        lastUserID: lastUser.id,
        lastUserCreatedAt: lastUser.time.created,
        lastAssistant,
        hasPendingSubtask: tasks.some((t) => t.type === "subtask"),
        // An unknown-finish turn must not end an autonomous session that
        // still has pending todos or an active goal as "completed" — the
        // loop continues instead, bounded by the tool-only-turn breaker and
        // the step ceilings.
        hasPendingAutonomousWork:
          effectivelyAutonomous && (activeGoal?.status === "active" || Todo.active(sessionID).length > 0),
      })
      if (assistantExit.action === "stop") {
        reason = assistantExit.reason
        break
      }

      step++
      totalSteps++
      if (!sessionStarted) {
        deferredCodeGraphAutoIndex.set(
          recordPromptSessionStart({
            sessionID,
            session,
            lastUser,
            messages: msgs,
            abort,
            isResumingActiveLoop,
          }),
        )
        sessionStarted = true
      }

      const modelKey = providerModelKey(lastUser.model)
      const resolvedModel = await resolvePromptCache({
        cache: cachedModel,
        key: modelKey,
        load: () =>
          modelInfo({
            sessionID,
            providerID: lastUser.model.providerID,
            modelID: lastUser.model.modelID,
          }).catch((e) => {
            reason = "error"
            throw e
          }),
      })
      const model = resolvedModel.value
      cachedModel = resolvedModel.cache
      const task = tasks.pop()

      // pending subtask
      if (task?.type === "subtask") {
        await executeSubtask(task, { sessionID, lastUser, model, abort, msgs, session })
        continue
      }

      // pending compaction
      if (task?.type === "compaction") {
        const compaction = await processPendingCompaction({
          task,
          messages: msgs,
          parentID: lastUser.id,
          abort,
          sessionID,
          busyRetries: compactionBusyRetries,
        })
        if (compaction.action === "break") {
          reason = compaction.reason
          break
        }
        compactionBusyRetries = compaction.busyRetries
        if (compaction.action === "retry") {
          cachedMsgs = undefined
          continue
        }
        cachedMsgs = undefined // invalidate cache after compaction
        continue
      }

      // context overflow, needs compaction
      if (
        await maybeScheduleUsageCompaction({
          sessionID,
          agent: lastUser.agent,
          userModel: lastUser.model,
          model,
          lastFinished,
          superLong: superLongActive,
          latestUserParts: lastUserParts ?? [],
        })
      ) {
        cachedMsgs = undefined // invalidate cache after compaction
        continue
      }

      // normal processing
      const resolvedAgent = await resolvePromptCache({
        cache: cachedAgent,
        key: lastUser.agent,
        load: () =>
          agentInfo({ sessionID, name: lastUser.agent }).catch((error) => {
            reason = "error"
            throw error
          }),
      })
      const agent = resolvedAgent.value
      cachedAgent = resolvedAgent.cache
      const maxSteps = agent.steps ?? Infinity
      // Overwrite the loop-top busy emit so the TUI denominator is the
      // effective pacing cap (min of finite agent.steps and session max),
      // not always session.max_steps (ADR-051 budget honesty).
      await markPromptLoopBusy({
        sessionID,
        step,
        maxSteps: effectivePacingMaxSteps({ agentSteps: maxSteps, sessionStepLimit }),
        consecutiveErrors,
      })
      const agentStepLimit = handlePromptLoopAgentStepLimit({
        sessionID,
        agentName: agent.name,
        step,
        maxSteps,
        autonomous: effectivelyAutonomous,
        continuations,
        maxContinuations: effectiveMaxContinuations,
      })
      if (agentStepLimit.action === "stop") {
        // End the transcript with an explicit explanation, mirroring the
        // global step-limit stop — a bare break left no trace of why the
        // session ended.
        await createSyntheticFailureAssistant({
          sessionID,
          lastUser,
          message: agentStepLimit.message,
        })
        reason = agentStepLimit.reason
        break
      }
      if (agentStepLimit.action === "continue") {
        await continueAutonomousLoop({
          event: "autonomous agent step-limit auto-continue",
          resetTodoDeadlineSignature: true,
          text: agentStepLimit.text,
          logExtras: agentStepLimit.logExtras,
        })
        continue
      }
      const isLastStep = step >= maxSteps

      if (activeTurnProfile?.kind === "response-only" && activeTurnProfile.currentUserID !== lastUser.id) {
        activeTurnProfile = undefined
      }
      if (
        !activeTurnProfile &&
        model.providerID === AX_ENGINE_PROVIDER_ID &&
        step === 1 &&
        continuations === 0 &&
        tasks.length === 0 &&
        (activeGoal === undefined || activeGoal.status === "complete") &&
        Todo.active(sessionID).length === 0 &&
        !pendingAxEngineTurnInstruction
      ) {
        const profile = detectTurnExecutionProfile({ messages: msgs, currentUser: lastUser })
        if (profile.kind === "response-only") {
          activeTurnProfile = profile
          armForceTextOnlyTurn("response_only")
          log.info("turn execution profile selected", {
            command: "session.prompt.profile",
            status: "ok",
            sessionID,
            profile: profile.kind,
            intent: profile.intent,
            reason: profile.reason,
            providerID: model.providerID,
            modelID: model.id,
            sourceAssistantID: profile.sourceAssistantID,
            historyMessages: msgs.length,
            requestMessages: profile.requestMessages.length,
            sourceTextChars: profile.sourceTextChars,
            promptTextChars: profile.promptTextChars,
          })
        }
      }

      const responseOnlyProfile = activeTurnProfile?.kind === "response-only" ? activeTurnProfile : undefined
      const responseOnlyFastReasoning = responseOnlyProfile ? responseOnlyUsesFastReasoning(lastUser) : false
      const pendingInstructionForRequest =
        lastUser.format?.type === "json_schema" ? undefined : pendingAxEngineTurnInstruction

      msgs = await insertReminders({
        messages: msgs,
        agent,
        session,
      })

      if (step === 1 && continuations === 0) {
        scheduleFirstTurnSummary({ sessionID, messageID: lastUser.id, messages: msgs })
      }

      const request = await preparePromptRequest({
        sessionID,
        messages: msgs,
        lastUser,
        lastFinished,
        step,
        isLastStep,
        agent,
        model,
        cache: cachedSystemPrompt,
        structuredPrompt: STRUCTURED_OUTPUT_SYSTEM_PROMPT,
        requestMessagesSource: responseOnlyProfile?.requestMessages,
        systemOverride: responseOnlyProfile ? [RESPONSE_ONLY_SYSTEM_PROMPT] : undefined,
        ephemeralSystem: pendingInstructionForRequest ? [pendingInstructionForRequest] : undefined,
      })
      msgs = request.messages
      // Text-only recovery / response-only rewrite / last finite agent step
      // omit tool schemas on the provider wire (ADR-051 D3). Preflight must
      // budget the same way — `tools: {}` means "no overrides" (all tools
      // still counted), not "zero tools".
      const omitToolSchemas =
        Boolean(responseOnlyProfile) ||
        ((forceTextOnlyTurn || isLastStep) && lastUser.format?.type !== "json_schema")
      const preflightCompaction = await maybeSchedulePreflightCompaction({
        sessionID,
        agent: lastUser.agent,
        agentInfo: agent,
        userModel: lastUser.model,
        model,
        userParts: lastUserParts ?? [],
        system: SystemPrompt.request({
          agent,
          model,
          system: request.system,
          userSystem: lastUser.system,
        }),
        requestMessages: request.requestMessages,
        tools: lastUser.tools,
        omitToolSchemas,
        sessionPermission: session.permission,
      })
      if (preflightCompaction.action === "compact") {
        cachedMsgs = undefined
        continue
      }
      if (preflightCompaction.action === "block") {
        log.warn("prompt preflight blocked an unfit model/tool setup", {
          command: "session.prompt.preflight",
          status: "error",
          errorCode: "FIXED_CONTEXT_BUDGET_EXCEEDED",
          sessionID,
          fixedTokens: preflightCompaction.fixedTokens,
          usableTokens: preflightCompaction.usableTokens,
          compactableHistoryTokens: preflightCompaction.compactableHistoryTokens,
          modelID: model.id,
          providerID: model.providerID,
        })
        const assistant = await createSyntheticFailureAssistant({
          sessionID,
          lastUser,
          message: preflightCompaction.message,
        })
        // The synthetic transcript message is useful in every client, but
        // headless and `run` clients determine failure from this event.
        Session.publishError({ sessionID, error: assistant.error })
        reason = "error"
        break
      }

      const processor = await createPromptProcessor({
        sessionID,
        lastUser,
        agent,
        model,
        abort,
        messages: msgs,
      })
      lastProducedAssistantID = processor.message.id
      using _ = defer(() => clearPromptProcessorInstructions(processor))

      const structuredOutput = createStructuredOutputTurn(request.format)

      // Consume the one-shot forced-text-only turn (see the
      // toolOnlyFinalCheckpointHits/forceTextOnlyTurn declarations above) —
      // but only when it was actually applied. If structuredOutput wins this
      // turn, forceTextOnlyTurn stays pending for a later turn instead of
      // being silently dropped (see resolveTurnToolChoice).
      const toolChoiceResolution = resolveTurnToolChoice({
        structuredOutputChoice: structuredOutput.toolChoice,
        forceTextOnlyTurn,
        isLastStep,
      })
      const toolChoice = toolChoiceResolution.toolChoice
      lastTurnWasForceTextOnly = toolChoiceResolution.consumedForceTextOnlyTurn
      lastTurnForceTextReason = toolChoiceResolution.consumedForceTextOnlyTurn ? forceTextReason : undefined
      if (toolChoiceResolution.consumedForceTextOnlyTurn) {
        forceTextOnlyTurn = false
        forceTextReason = undefined
      }

      // Forced text-only synthesis must not pay for registry/MCP schema
      // materialization either — only structured-output-required turns need
      // tools while toolChoice is otherwise "none".
      const needsTools = toolChoice !== "none" || structuredOutput.toolChoice === "required"
      const tools = needsTools
        ? await resolveTools({
            agent,
            session,
            model,
            tools: lastUser.tools,
            processor,
            bypassAgentCheck: shouldBypassAgentCheck(lastUserParts),
            messages: msgs,
            isolation: resolvePromptIsolationPolicy({
              config: cfg.isolation,
              policy: lastUser.isolation,
              directory: Instance.directory,
              worktree: Instance.worktree,
            }),
          })
        : {}
      if (needsTools) structuredOutput.attachTool(tools)

      const maxOutputTokensForRequest = pendingMaxOutputTokens
      const result = await processor.process({
        user: lastUser,
        agent,
        permission: session.permission,
        abort,
        sessionID,
        system: request.system,
        messages: request.requestMessages,
        tools,
        model,
        toolChoice,
        small: responseOnlyFastReasoning,
        config: cfg,
        maxOutputTokens: maxOutputTokensForRequest,
      })

      if (
        shouldRestoreForcedTextOnlyTurn({
          consumed: toolChoiceResolution.consumedForceTextOnlyTurn,
          errored: Boolean(processor.message.error),
        })
      ) {
        // Restore the same force reason that was just consumed.
        armForceTextOnlyTurn(lastTurnForceTextReason ?? "other")
      }

      if (!processor.message.error) {
        if (pendingInstructionForRequest && pendingAxEngineTurnInstruction === pendingInstructionForRequest) {
          pendingAxEngineTurnInstruction = undefined
        }
        if (maxOutputTokensForRequest !== undefined && pendingMaxOutputTokens === maxOutputTokensForRequest) {
          pendingMaxOutputTokens = undefined
        }
        if (responseOnlyProfile && activeTurnProfile === responseOnlyProfile) {
          activeTurnProfile = undefined
        }
      }

      if (await structuredOutput.saveCaptured(processor.message)) {
        reason = "completed"
        break
      }

      const modelFinished = modelTurnFinished(processor.message.finish)
      const emptyModelTurn = isEmptyModelTurn({
        finish: processor.message.finish,
        tokens: processor.message.tokens,
      })
      const truncatedModelTurn = isTruncatedModelTurn({
        finish: processor.message.finish,
      })
      if (!emptyModelTurn) emptyModelTurnRetries = 0
      if (!truncatedModelTurn) {
        truncatedModelTurnRetries = 0
        previousTruncatedModelOutputPrefix = undefined
      }
      // Reset the tool-only streak HERE, not in the tracking block further
      // down: a turn that finished with a text response but is immediately
      // followed by a todo/gate/convergence continuation `continue`s past
      // that block, and the streak would otherwise keep accumulating across
      // completed text turns — making the checkpoint messages factually
      // wrong ("N consecutive turns ended in tool calls") and eventually
      // hard-stopping a healthy session.
      if (modelFinished) {
        consecutiveToolOnlyTurns = 0
        toolOnlyNudges = 0
        consecutiveAxEngineReadOnlyTurns = 0
        axEngineReadOnlyNudged = false
        axEngineReadOnlyHasEvidence = false
        axEngineLargeEvidenceGraceUsed = false
      }

      // A provider turn that returns finish="other" with zero tokens is a
      // failed response, not a completed one. The autonomous branch below has
      // its own recover/stop handling; in supervised mode, stop with an
      // explicit failure instead of letting the next iteration treat the
      // empty turn as a clean assistant exit and mark the session completed.
      if (!effectivelyAutonomous && emptyModelTurn && !processor.message.error && !abort.aborted) {
        const message = emptyModelTurnIncompleteMessage(describeStreamErrorCause(processor.streamError))
        log.warn("empty model turn in supervised mode", {
          command: "session.prompt.loop",
          status: "error",
          errorCode: "EMPTY_MODEL_TURN",
          sessionID,
        })
        await publishPromptFailure({
          sessionID,
          assistant: processor.message,
          message,
        })
        reason = "stalled"
        break
      }

      let completionGateAllowedComplete = false

      if (modelFinished && !processor.message.error) {
        if (await structuredOutput.failIfMissing(processor.message)) {
          reason = "error"
          break
        }
      }
      const updatedGoal = await addPromptGoalUsage({ sessionID, message: processor.message })

      // When autonomous (explicitly or via active goal), when the model ends
      // a turn cleanly but leaves todos pending, inject a continuation user
      // message and keep the loop running. This is the runtime guarantee —
      // complements the system-prompt reminder injected per turn. Capped by
      // maxTodoRetries to prevent infinite loops when the model genuinely
      // cannot finish a todo (blocked tool, missing data, etc.).
      if (effectivelyAutonomous && !processor.message.error) {
        // Append only messages written this step (the new assistant + parts)
        // instead of re-streaming the full history via Session.messages().
        const latestMessages = await appendNewerMessages(sessionID, msgs)
        if (cachedMsgs && latestMessages !== msgs && latestMessages.length > msgs.length) {
          const added = latestMessages.slice(msgs.length)
          cachedMsgs.push(...added)
        }
        msgs = latestMessages
        const pendingTodos = Todo.active(sessionID)
        const completionGate = AutonomousCompletionGate.evaluate({
          messages: latestMessages,
          pendingTodos,
        })
        // Gated on modelFinished like the sibling gate paths (unexecutable
        // text, todo continuation): retries are consumed only when the model
        // actually tries to end its turn. Without the guard, a model that
        // reacted to an empty subagent result by taking over the work itself
        // (tool-call turns, no completion claim) burned the small retry
        // budget mid-work and was stopped as "stalled" while making
        // progress. The telemetry emit below still fires every step for
        // empty subagent results — only recovery/stop is completion-scoped.
        const shouldRecoverEmptySubagentResult =
          modelFinished && completionGate.status === "blocked" && completionGate.reason === "empty_subagent_result"

        emitPromptLoopCompletionGateDecision({
          sessionID,
          messageID: processor.message.id,
          step,
          modelFinished,
          gate: completionGate,
          todoRetries,
          maxTodoRetries,
          completionGateRetries,
          maxCompletionGateRetries,
        })

        const emptyTurnTransition = await handlePromptLoopEmptyTurn({
          sessionID,
          assistant: processor.message,
          emptyModelTurn,
          emptyModelTurnRetries,
          maxEmptyModelTurnRetries,
          todoRetries,
          pendingCount: pendingTodos.length,
          cause: emptyModelTurn ? describeStreamErrorCause(processor.streamError) : undefined,
        })
        emptyModelTurnRetries = emptyTurnTransition.emptyModelTurnRetries
        todoRetries = emptyTurnTransition.todoRetries

        if (emptyTurnTransition.action === "stop") {
          reason = emptyTurnTransition.reason
          break
        }

        if (emptyTurnTransition.action === "recover") {
          await createAutonomousTextContinuation({
            sessionID,
            messages: latestMessages,
            text: emptyTurnTransition.text,
          })
          continue
        }

        const truncatedOutputText = truncatedModelTurn
          ? modelOutputText(latestMessages, processor.message.id)
          : undefined
        const currentTruncatedModelOutputPrefix = truncatedModelTurn
          ? truncatedModelOutputPrefix(truncatedOutputText)
          : undefined
        // Local engines pay ~minutes per full output window. Cap recovery
        // attempts so a soft-ignored "keep it short" instruction cannot burn
        // three full 2k generations on a single user prompt.
        const effectiveMaxTruncatedModelTurnRetries =
          model.providerID === AX_ENGINE_PROVIDER_ID
            ? Math.min(maxTruncatedModelTurnRetries, AX_ENGINE_MAX_TRUNCATED_MODEL_TURN_RETRIES)
            : maxTruncatedModelTurnRetries
        const truncatedTurnTransition = await handlePromptLoopTruncatedTurn({
          sessionID,
          assistant: processor.message,
          truncatedModelTurn,
          truncatedModelTurnRetries,
          maxTruncatedModelTurnRetries: effectiveMaxTruncatedModelTurnRetries,
          pendingCount: pendingTodos.length,
          previousOutputPrefix: previousTruncatedModelOutputPrefix,
          currentOutputPrefix: currentTruncatedModelOutputPrefix,
        })
        truncatedModelTurnRetries = truncatedTurnTransition.truncatedModelTurnRetries

        if (truncatedTurnTransition.action === "stop") {
          reason = truncatedTurnTransition.reason
          break
        }

        if (truncatedTurnTransition.action === "recover") {
          previousTruncatedModelOutputPrefix = currentTruncatedModelOutputPrefix
          const axEngineRecovery = model.providerID === AX_ENGINE_PROVIDER_ID
          if (axEngineRecovery) {
            const largeCodePaste = isLargeTruncatedCodePaste(truncatedOutputText)
            if (largeCodePaste) {
              // Keep tools so the model can finish via write/edit instead of
              // another multi-minute in-chat re-paste of the same program.
              forceTextOnlyTurn = false
              forceTextReason = undefined
              pendingAxEngineTurnInstruction = AutonomousContinuationPrompt.axEngineTruncatedCodeWorkRecovery({
                attempt: truncatedTurnTransition.truncatedModelTurnRetries,
                maxAttempts: effectiveMaxTruncatedModelTurnRetries,
              })
              pendingMaxOutputTokens = AX_ENGINE_TRUNCATED_CODE_RECOVERY_MAX_OUTPUT_TOKENS
            } else {
              armForceTextOnlyTurn("truncated_recovery")
              pendingAxEngineTurnInstruction = AutonomousContinuationPrompt.axEngineTruncatedModelTurnRecovery()
              pendingMaxOutputTokens = AX_ENGINE_TRUNCATED_RECOVERY_MAX_OUTPUT_TOKENS
            }
            log.info("ax-engine truncated turn recovery armed", {
              command: "session.prompt.loop",
              status: "retry",
              errorCode: "TRUNCATED_MODEL_TURN",
              sessionID,
              largeCodePaste,
              maxOutputTokens: pendingMaxOutputTokens,
              toolsEnabled: largeCodePaste,
              attempt: truncatedTurnTransition.truncatedModelTurnRetries,
              maxAttempts: effectiveMaxTruncatedModelTurnRetries,
            })
          } else {
            await createAutonomousTextContinuation({
              sessionID,
              messages: latestMessages,
              text: truncatedTurnTransition.text,
            })
          }
          continue
        }

        if (
          modelFinished &&
          completionGate.status === "blocked" &&
          completionGate.reason === "unexecutable_tool_text"
        ) {
          const unexecutableRecovery = unexecutableToolTextRecoveryDecision({
            lastTurnWasForceTextOnly,
            recoveriesUsed: unexecutableToolTextRecoveries,
            maxRecoveries: MAX_UNEXECUTABLE_TOOL_TEXT_RECOVERIES,
            forceReason: lastTurnForceTextReason,
          })
          if (unexecutableRecovery.action === "recover") {
            unexecutableToolTextRecoveries += 1
            forceTextOnlyTurn = false
            forceTextReason = undefined
            lastTurnWasForceTextOnly = false
            lastTurnForceTextReason = undefined
            consecutiveAxEngineReadOnlyTurns = 0
            axEngineReadOnlyNudged = false
            axEngineReadOnlyHasEvidence = false
            axEngineLargeEvidenceGraceUsed = false
            pendingAxEngineTurnInstruction = undefined
            pendingMaxOutputTokens = undefined
            log.info("autonomous completion gate recovery after forced text-only turn", {
              command: "session.prompt.loop",
              status: "recover",
              errorCode: "UNEXECUTABLE_TOOL_TEXT",
              sessionID,
              recoveries: unexecutableToolTextRecoveries,
              maxRecoveries: MAX_UNEXECUTABLE_TOOL_TEXT_RECOVERIES,
            })
            await createAutonomousTextContinuation({
              sessionID,
              messages: latestMessages,
              text: AutonomousContinuationPrompt.unexecutableToolTextRecovery(),
            })
            continue
          }
          log.warn("autonomous completion gate stopped session", {
            command: "session.prompt.loop",
            status: "stopped",
            errorCode: "UNEXECUTABLE_TOOL_TEXT",
            sessionID,
            reason: completionGate.reason,
            message: completionGate.message,
          })
          await publishPromptFailure({
            sessionID,
            assistant: processor.message,
            message: completionGate.message,
          })
          reason = "stalled"
          break
        }

        if (shouldRecoverEmptySubagentResult) {
          const gateRetryTransition = await handlePromptLoopCompletionGateRetry({
            sessionID,
            assistant: processor.message,
            gate: completionGate,
            previousSignature: lastCompletionGateSignature,
            retries: completionGateRetries,
            maxRetries: maxCompletionGateRetries,
            isLastStep,
          })

          if (gateRetryTransition.action === "stop") {
            reason = gateRetryTransition.reason
            break
          }

          lastCompletionGateSignature = gateRetryTransition.signature
          completionGateRetries = gateRetryTransition.retries
          await createAutonomousTextContinuation({
            sessionID,
            messages: latestMessages,
            text: gateRetryTransition.text,
          })
          continue
        }

        if (completionGate.status === "allow") {
          completionGateRetries = 0
          lastCompletionGateSignature = undefined
        }

        const remainingAgentSteps = Number.isFinite(maxSteps) ? Math.max(0, maxSteps - step) : Infinity
        const todoConvergence = handlePromptLoopTodoConvergence({
          sessionID,
          pendingTodos,
          inputTokens: processor.message.tokens.input,
          modelFinished: Boolean(modelFinished),
          remainingAgentSteps,
          maxSteps,
          lastTodoContextSignature,
          lastTodoDeadlineSignature,
        })
        lastTodoContextSignature = todoConvergence.lastTodoContextSignature
        lastTodoDeadlineSignature = todoConvergence.lastTodoDeadlineSignature
        if (todoConvergence.action === "continue") {
          await createAutonomousTextContinuation({
            sessionID,
            messages: latestMessages,
            text: todoConvergence.text,
          })
          continue
        }

        if (modelFinished && pendingTodos.length > 0) {
          const todoContinuation = await handlePromptLoopTodoContinuation({
            sessionID,
            assistant: processor.message,
            isLastStep,
            todoRetries,
            maxTodoRetries,
            pendingTodos,
            lastPendingTodoSignature,
            stagnantTodoRetries,
            maxSteps,
          })

          if (todoContinuation.action === "stop") {
            reason = todoContinuation.reason
            break
          }

          lastPendingTodoSignature = todoContinuation.lastPendingTodoSignature
          todoRetries = todoContinuation.todoRetries
          stagnantTodoRetries = todoContinuation.stagnantTodoRetries
          await createAutonomousTextContinuation({
            sessionID,
            messages: latestMessages,
            text: todoContinuation.text,
          })
          continue
        }

        completionGateAllowedComplete = modelFinished && completionGate.status === "allow" && pendingTodos.length === 0
      }

      // Goal auto-continuation runs only when autonomous mode is enabled.
      // Without autonomy, active goals persist for the next user-driven turn.
      if (effectivelyAutonomous && modelFinished && !processor.message.error) {
        // `updatedGoal` is undefined when the goal row no longer exists
        // (cleared mid-turn) OR when the usage update transiently failed.
        // Re-fetch rather than falling back to the loop-top snapshot, so a
        // goal cleared during the turn cannot trigger one spurious
        // continuation for an objective that no longer exists.
        const goal = updatedGoal ?? (await SessionGoal.get(sessionID).catch(() => activeGoal))
        // A budget-limited goal whose wrap-up turn ended with a gate-approved,
        // todo-free completion is a successful stop — report "completed"
        // instead of converting it into the budget-stall error below.
        if (goal?.status === "budget_limited" && goalBudgetWrapUp !== "none" && completionGateAllowedComplete) {
          reason = "completed"
          break
        }
        const goalTransition = handlePromptLoopGoalContinuation({
          sessionID,
          goal,
          continuations,
          budgetWrapUp: goalBudgetWrapUp,
        })
        goalBudgetWrapUp = goalTransition.budgetWrapUp

        if (goalTransition.action === "continue") {
          await continueAutonomousLoop({
            event: goalTransition.event,
            text: goalTransition.text,
          })
          continue
        }

        if (goalTransition.action === "stop") {
          reason = goalTransition.reason
          break
        }
      }

      if (completionGateAllowedComplete) {
        reason = "completed"
        break
      }

      // Tool-only turn convergence: when the model's last step was tool
      // calls (finish="tool-calls"), modelFinished is false and none of
      // the above completion paths fire. The loop would otherwise keep
      // calling the model indefinitely if the model never produces a
      // final text response (common when stuck in a read-only exploration
      // loop — e.g. repeatedly listing directories or running shell
      // commands). Track consecutive tool-only outer-loop turns and break
      // when the count exceeds MAX_TOOL_ONLY_TURNS.
      // Streak reset for finished turns happens earlier (right after
      // modelFinished is computed) so autonomous continuations cannot skip
      // it. Errored turns neither reset nor count: the error transition
      // below owns that path, and injecting a nudge on an errored turn
      // would defer error recovery by a turn.
      if (!modelFinished && !processor.message.error) {
        // #381: a successful update_goal(status=complete) that ends the turn
        // with tool-calls must force a final text summary, not climb toward
        // the tool-only circuit breaker after the goal is already done.
        // Autonomous mode refreshes `msgs` above, while supervised tool turns
        // intentionally defer that history refresh until the next iteration.
        // Read the just-written parts directly in the latter case so both the
        // goal-complete and local read-only convergence guards see this turn.
        const currentParts =
          msgs.find((item) => item.info.id === processor.message.id)?.parts ??
          (await MessageV2.parts(processor.message.id))
        const goalForce = goalCompleteForceTextDecision({
          modelFinished,
          goalCompletedThisTurn: hasSuccessfulGoalCompleteTool(currentParts),
        })
        if (goalForce.action === "force_text") {
          armForceTextOnlyTurn("goal_complete")
          consecutiveToolOnlyTurns = 0
          toolOnlyNudges = 0
          consecutiveAxEngineReadOnlyTurns = 0
          axEngineReadOnlyNudged = false
          axEngineReadOnlyHasEvidence = false
          axEngineLargeEvidenceGraceUsed = false
          log.info("goal complete forces text-only final turn", {
            command: "session.prompt.loop",
            status: "force_text",
            sessionID,
          })
          await createAutonomousTextContinuation({
            sessionID,
            messages: msgs,
            text: AutonomousContinuationPrompt.goalCompleteForceText(),
          })
          continue
        }

        consecutiveToolOnlyTurns += 1
        const axEngineReadOnlyTurn =
          model.providerID === AX_ENGINE_PROVIDER_ID && isReadOnlyExplorationTurn(currentParts)
        if (axEngineReadOnlyTurn) {
          consecutiveAxEngineReadOnlyTurns += 1
          if (hasUsableReadOnlyEvidence(currentParts)) axEngineReadOnlyHasEvidence = true
          const freshLargeEvidence = hasLargeSuccessfulReadOnlyOutput(
            currentParts,
            AX_ENGINE_LARGE_TOOL_OUTPUT_CHARS,
          )
          const readOnlyTransition = readOnlyExplorationDecision({
            consecutiveTurns: consecutiveAxEngineReadOnlyTurns,
            nudged: axEngineReadOnlyNudged,
            nudgeThreshold: AX_ENGINE_READ_ONLY_TURN_NUDGE,
            forceThreshold: AX_ENGINE_READ_ONLY_TURN_FORCE,
            hasUsableEvidence: axEngineReadOnlyHasEvidence,
            freshLargeEvidence,
            largeEvidenceGraceUsed: axEngineLargeEvidenceGraceUsed,
          })
          if (readOnlyTransition.action !== "ignore") {
            const forced = readOnlyTransition.action === "force_text"
            if (forced) {
              armForceTextOnlyTurn("ax_engine_read_only")
            } else {
              axEngineReadOnlyNudged = true
              // Grace: force deferred because a large tool payload just landed.
              if (
                freshLargeEvidence &&
                !axEngineLargeEvidenceGraceUsed &&
                consecutiveAxEngineReadOnlyTurns >= AX_ENGINE_READ_ONLY_TURN_FORCE &&
                axEngineReadOnlyHasEvidence
              ) {
                axEngineLargeEvidenceGraceUsed = true
              }
            }
            log.info("ax-engine read-only turn checkpoint", {
              command: "session.prompt.loop",
              status: forced ? "force_text" : "nudge",
              sessionID,
              consecutiveTurns: consecutiveAxEngineReadOnlyTurns,
              forced,
              hasUsableEvidence: axEngineReadOnlyHasEvidence,
              freshLargeEvidence,
              largeEvidenceGraceUsed: axEngineLargeEvidenceGraceUsed,
            })
            pendingAxEngineTurnInstruction = AutonomousContinuationPrompt.axEngineReadOnlyCheckpoint({
              consecutiveTurns: consecutiveAxEngineReadOnlyTurns,
              forceThreshold: AX_ENGINE_READ_ONLY_TURN_FORCE,
              forced,
            })
            continue
          }
        } else {
          consecutiveAxEngineReadOnlyTurns = 0
          axEngineReadOnlyNudged = false
          axEngineReadOnlyHasEvidence = false
          axEngineLargeEvidenceGraceUsed = false
        }
        const toolOnlyTransition = toolOnlyTurnDecision({
          consecutiveToolOnlyTurns,
          toolOnlyNudges,
          nudgeThreshold: toolOnlyNudgeThreshold,
          finalNudgeThreshold: toolOnlyFinalNudgeThreshold,
          maxToolOnlyTurns,
          finalCheckpointHits: toolOnlyFinalCheckpointHits,
        })
        if (toolOnlyTransition.action === "nudge") {
          // See the toolOnlyFinalCheckpointHits declaration above: a repeat
          // final checkpoint means the model already spent its one advisory
          // grace period and resumed tool-only calling anyway, so this time
          // force the next turn to be text-only instead of nudging again.
          if (toolOnlyTransition.final) toolOnlyFinalCheckpointHits += 1
          if (toolOnlyTransition.forced) armForceTextOnlyTurn("tool_only_breaker")
          log.info("tool-only turn nudge", {
            command: "session.prompt.loop",
            status: "nudge",
            sessionID,
            consecutiveToolOnlyTurns,
            finalNudge: toolOnlyTransition.final,
            forced: toolOnlyTransition.forced,
          })
          // msgs already holds the loop history (and any this-step appends);
          // continuation only needs last-user agent/model metadata.
          await createAutonomousTextContinuation({
            sessionID,
            messages: msgs,
            text: AutonomousContinuationPrompt.toolOnlyTurnNudge({
              consecutiveToolOnlyTurns,
              maxToolOnlyTurns,
              final: toolOnlyTransition.final,
              forced: toolOnlyTransition.forced,
            }),
          })
          toolOnlyNudges += 1
          continue
        }
        if (toolOnlyTransition.action === "stop") {
          log.warn("tool-only turn convergence limit", {
            command: "session.prompt.loop",
            status: "stopped",
            errorCode: "TOOL_ONLY_TURN_LIMIT",
            sessionID,
            consecutiveToolOnlyTurns,
            maxToolOnlyTurns,
          })
          // This circuit breaker runs in both supervised and autonomous
          // sessions, so the message must not claim "autonomous mode", and
          // the reminder count is derived rather than hard-coded so it stays
          // truthful if the thresholds are ever retuned.
          const reminderClause =
            toolOnlyNudges > 0
              ? `, despite ${toolOnlyNudges} checkpoint reminder${toolOnlyNudges === 1 ? "" : "s"}`
              : ""
          await publishPromptFailure({
            sessionID,
            assistant: processor.message,
            message:
              `Agent loop stopped: ${consecutiveToolOnlyTurns} consecutive turns each ended in further ` +
              `tool calls without a completed text response${reminderClause}. ` +
              `The loop was halted as a circuit breaker; work done so far is preserved in the transcript. ` +
              `Resume with a more specific request, or break the task into smaller steps.`,
          })
          reason = "stalled"
          break
        }
      }

      const errorTransition = await resolvePromptLoopErrorTransition({
        sessionID,
        currentModel: lastUser.model,
        error: processor.message.error,
        consecutiveErrors,
        fallbackModelOverride,
        step,
        failedProviderIDs: failedFallbackProviderIDs,
      })
      consecutiveErrors = errorTransition.consecutiveErrors
      fallbackModelOverride = errorTransition.fallbackModelOverride
      if (errorTransition.resetCachedModel) {
        cachedModel = undefined
      }
      if (errorTransition.action === "retry") {
        failedFallbackProviderIDs.add(lastUser.model.providerID)
        continue
      }
      if (errorTransition.action === "stop") {
        reason = errorTransition.reason
        break
      }
      if (processor.message.error) {
        const delay = SessionRetry.delay(Math.max(1, consecutiveErrors))
        log.info("backing off before outer prompt retry", {
          sessionID,
          consecutiveErrors,
          delay,
        })
        try {
          await SessionRetry.sleep(delay, abort)
        } catch (error) {
          if (abort.aborted) {
            reason = "aborted"
            break
          }
          log.warn("outer prompt retry sleep failed", { sessionID, error })
        }
        continue
      }

      const processorDecision = processorLoopDecision({
        result,
        messageFinish: processor.message.finish,
        hasError: false,
        priorContextOverflowCompactions: consecutiveContextOverflowCompactions,
      })
      if (processorDecision.action === "stop") {
        if (processorDecision.message) {
          await publishPromptFailure({
            sessionID,
            assistant: processor.message,
            message: processorDecision.message,
          })
        }
        reason = processorDecision.reason
        break
      }
      if (processorDecision.action === "continue") {
        consecutiveContextOverflowCompactions = 0
      }

      if (processorDecision.action === "compact") {
        consecutiveContextOverflowCompactions = processorDecision.overflow
          ? consecutiveContextOverflowCompactions + 1
          : 0
        await SessionCompaction.create({
          sessionID,
          agent: lastUser.agent,
          model: lastUser.model,
          auto: true,
          overflow: processorDecision.overflow,
          triggerReason: processorDecision.triggerReason,
        })
      }
      continue
    }
    return resolvePromptLoopResult({
      sessionID,
      abort,
      expectedMessageID: lastProducedAssistantID,
      shiftQueuedCallback: runState.shiftQueuedCallback,
    })
  })

  export const ShellInput = ShellInputSchema
  export type ShellInput = ShellInputType
  export async function shell(input: ShellInput) {
    return executeShellCommand(input, {
      start,
      queuedCallbacks: runState.queuedCallbacks,
      cancel,
      resumeLoop: loop,
    })
  }

  export const CommandInput = CommandInputSchema
  export type CommandInput = CommandInputType

  export async function command(input: CommandInput) {
    return executePromptCommand(input, prompt)
  }
}
