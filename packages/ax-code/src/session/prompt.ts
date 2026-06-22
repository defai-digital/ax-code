import os from "os"
import { SessionID } from "./schema"
import { MessageV2 } from "./message-v2"
import { Log } from "../util/log"
import { SessionRevert } from "./revert"
import { Session } from "."
import { Agent } from "../agent/agent"
import { providerModelKey } from "../provider/model-key"
import { Provider } from "../provider/provider"
import { ModelID, ProviderID } from "../provider/schema"
import { SessionCompaction } from "./compaction"
import { AutonomousCompletionGate } from "../control-plane/autonomous-completion-gate"
import { Instance } from "../project/instance"
import { defer } from "../util/defer"
import { NotFoundError } from "@/storage/db"
import { Flag } from "../flag/flag"
import { Todo } from "./todo"
import { SessionGoal } from "./goal"
import { Config } from "@/config/config"
import { fn } from "@/util/fn"
import { LLM } from "./llm"
import { iife } from "@/util/iife"
import { agentInfo, modelInfo } from "./prompt-agent-model-info"
import { processorLoopDecision, assistantRespondedAfterUser } from "./prompt-loop-decisions"
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
import { handlePromptLoopTruncatedTurn } from "./prompt-loop-truncated-turn"
import { handlePromptLoopTodoConvergence } from "./prompt-loop-todo-convergence"
import { handlePromptLoopTodoContinuation } from "./prompt-loop-todo-continuation"
import { loopMessages, scanLoopMessages } from "./prompt-loop-messages"
import { finishPromptLoopQueue } from "./prompt-loop-queue"
import { beginPromptLoopRecording, finishPromptLoopRecording, type PromptLoopEndReason } from "./prompt-loop-recording"
import { resolvePromptLoopResult } from "./prompt-loop-result"
import { markPromptLoopBusy } from "./prompt-loop-status"
import { handlePromptLoopGlobalStepLimit } from "./prompt-loop-step-limit"
import { preparePromptRequest, type PromptRequestCache } from "./prompt-request-build"
import { createStructuredOutputTurn } from "./prompt-structured-output"
import { publishPromptFailure } from "./prompt-loop-failure"
import { executeSubtask, type SubtaskContext } from "./prompt-subtask"
import { resolveTools, shouldBypassAgentCheck } from "./prompt-tools"
import { clearPromptProcessorInstructions, createPromptProcessor } from "./prompt-processor"
import { addPromptGoalUsage } from "./prompt-goal-usage"
import { isEmptyModelTurn, isTruncatedModelTurn, modelTurnFinished } from "./prompt-autonomous-decisions"
import { toErrorMessage } from "../util/error-message"
import { insertReminders } from "./prompt-reminders"
import { executeShellCommand } from "./prompt-shell-command"
import { executePromptCommand } from "./prompt-command-execution"
import { createDeferredCodeGraphAutoIndex } from "./prompt-code-graph"
import { recordPromptSessionStart } from "./prompt-session-start"
import { scheduleFirstTurnSummary } from "./prompt-session-summary"
import { enforceSuperLongDeadline } from "./prompt-super-long"
import { SuperLongPolicy } from "./super-long-policy"
import { createAutonomousTextContinuation, createUserMessage } from "./prompt-user-message"
import { permissionRulesetFromLegacyTools } from "./prompt-permission"
import { resolvePromptIsolationPolicy } from "./prompt-runtime-policy"
import { createPromptRunState } from "./prompt-run-state"
import { resolvePromptCache, type PromptCacheEntry } from "./prompt-cache"
import { promptLoopLimits } from "./prompt-loop-config"
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
    let reason: PromptLoopEndReason = "error"
    let consecutiveErrors = 0
    let continuations = 0
    let goalBudgetLimitContinuationSent = false
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
    const {
      sessionStepLimit,
      maxContinuations,
      maxTodoRetries,
      maxCompletionGateRetries,
      maxEmptyModelTurnRetries,
      maxTruncatedModelTurnRetries,
    } = promptLoopLimits(cfg)
    const autonomous = Flag.AX_CODE_AUTONOMOUS
    let todoRetries = 0
    let completionGateRetries = 0
    let lastCompletionGateSignature: string | undefined
    let lastPendingTodoSignature: string | undefined
    let lastTodoDeadlineSignature: string | undefined
    let lastTodoContextSignature: string | undefined
    let stagnantTodoRetries = 0
    let emptyModelTurnRetries = 0
    let truncatedModelTurnRetries = 0
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

    async function continueAutonomousLoop({
      text,
      event,
      logExtras = {},
      resetTodoDeadlineSignature = false,
      resetTodoProgressTracking = false,
    }: {
      text: string
      event: string
      logExtras?: Record<string, unknown>
      resetTodoDeadlineSignature?: boolean
      resetTodoProgressTracking?: boolean
    }) {
      continuations += 1
      step = 0
      consecutiveErrors = 0
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
      if (resetTodoProgressTracking) {
        lastPendingTodoSignature = undefined
        stagnantTodoRetries = 0
        todoRetries = 0
        lastTodoContextSignature = undefined
      }

      log.info(event, {
        command: "session.prompt.loop",
        status: "ok",
        sessionID,
        continuation: continuations,
        maxContinuations,
        ...logExtras,
      })
      const latestMessages = await Session.messages({ sessionID })
      await createAutonomousTextContinuation({
        sessionID,
        messages: latestMessages,
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
      const effectivelyAutonomous = autonomous

      // Safety: prevent infinite loops
      const effectiveMaxContinuations = superLongActive ? Number.POSITIVE_INFINITY : maxContinuations
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
          resetTodoProgressTracking: true,
          text: globalStepLimit.text,
        })
        continue
      }
      if (globalStepLimit.action === "stop") {
        reason = globalStepLimit.reason
        break
      }
      // On step 0 or after compaction, load full history. Otherwise only fetch new messages.
      let msgs: MessageV2.WithParts[]
      ;({ msgs, cached: cachedMsgs } = await loopMessages({ sessionID, cached: cachedMsgs }))

      let { lastUser, lastUserParts, lastAssistant, lastFinished, tasks } = scanLoopMessages(msgs)

      if (!lastUser) throw new Error("No user message found in stream. This should never happen.")
      if (fallbackModelOverride) {
        lastUser = {
          ...lastUser,
          model: fallbackModelOverride,
        }
      }
      const superLongDeadline = await enforceSuperLongDeadline({
        sessionID,
        lastUser,
        lastAssistant,
        autonomous: effectivelyAutonomous,
        config: SuperLongPolicy.fromConfig(cfg.super_long),
      })
      if (superLongDeadline.action === "stop") {
        if (superLongDeadline.invalidatedMessages) cachedMsgs = undefined
        reason = superLongDeadline.reason
        break
      }
      superLongActive = superLongDeadline.enabled
      const assistantExit = resolvePromptLoopAssistantExit({
        sessionID,
        lastUserID: lastUser.id,
        lastUserCreatedAt: lastUser.time.created,
        lastAssistant,
        hasPendingSubtask: tasks.some((t) => t.type === "subtask"),
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
      const agentStepLimit = handlePromptLoopAgentStepLimit({
        agentName: agent.name,
        step,
        maxSteps,
        autonomous: effectivelyAutonomous,
        continuations,
        maxContinuations: superLongActive ? Number.POSITIVE_INFINITY : maxContinuations,
      })
      if (agentStepLimit.action === "stop") {
        reason = agentStepLimit.reason
        break
      }
      if (agentStepLimit.action === "continue") {
        await continueAutonomousLoop({
          event: "autonomous agent step-limit auto-continue",
          resetTodoDeadlineSignature: true,
          resetTodoProgressTracking: true,
          text: agentStepLimit.text,
          logExtras: agentStepLimit.logExtras,
        })
        continue
      }
      const isLastStep = step >= maxSteps
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
      })
      msgs = request.messages
      if (
        await maybeSchedulePreflightCompaction({
          sessionID,
          agent: lastUser.agent,
          agentInfo: agent,
          userModel: lastUser.model,
          model,
          userParts: lastUserParts ?? [],
          system: request.system,
          requestMessages: request.requestMessages,
          tools: lastUser.tools,
          sessionPermission: session.permission,
        })
      ) {
        cachedMsgs = undefined
        continue
      }

      const processor = await createPromptProcessor({
        sessionID,
        lastUser,
        agent,
        model,
        abort,
        messages: msgs,
      })
      using _ = defer(() => clearPromptProcessorInstructions(processor))

      const tools = await resolveTools({
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

      const structuredOutput = createStructuredOutputTurn(request.format)
      structuredOutput.attachTool(tools)

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
        toolChoice: structuredOutput.toolChoice,
        config: cfg,
      })

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
      if (!truncatedModelTurn) truncatedModelTurnRetries = 0
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
        const latestMessages = await Session.messages({ sessionID })
        const pendingTodos = Todo.active(sessionID)
        const completionGate = AutonomousCompletionGate.evaluate({
          messages: latestMessages,
          pendingTodos,
        })
        const shouldRecoverEmptySubagentResult =
          completionGate.status === "blocked" && completionGate.reason === "empty_subagent_result"

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

        const truncatedTurnTransition = await handlePromptLoopTruncatedTurn({
          sessionID,
          assistant: processor.message,
          truncatedModelTurn,
          truncatedModelTurnRetries,
          maxTruncatedModelTurnRetries,
          pendingCount: pendingTodos.length,
        })
        truncatedModelTurnRetries = truncatedTurnTransition.truncatedModelTurnRetries

        if (truncatedTurnTransition.action === "stop") {
          reason = truncatedTurnTransition.reason
          break
        }

        if (truncatedTurnTransition.action === "recover") {
          await createAutonomousTextContinuation({
            sessionID,
            messages: latestMessages,
            text: truncatedTurnTransition.text,
          })
          continue
        }

        if (
          modelFinished &&
          completionGate.status === "blocked" &&
          completionGate.reason === "unexecutable_tool_text"
        ) {
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
        const goal = updatedGoal ?? activeGoal
        const goalTransition = handlePromptLoopGoalContinuation({
          sessionID,
          goal,
          continuations,
          maxContinuations,
          budgetLimitContinuationSent: goalBudgetLimitContinuationSent,
        })
        goalBudgetLimitContinuationSent = goalTransition.budgetLimitContinuationSent

        if (goalTransition.action === "continue") {
          await continueAutonomousLoop({
            event: goalTransition.event,
            resetTodoProgressTracking: true,
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
