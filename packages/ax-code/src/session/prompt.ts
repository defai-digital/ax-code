import os from "os"
import { SessionID } from "./schema"
import { MessageV2 } from "./message-v2"
import { Log } from "../util/log"
import { SessionRevert } from "./revert"
import { Session } from "."
import { Agent } from "../agent/agent"
import { Provider } from "../provider/provider"
import { ModelID, ProviderID } from "../provider/schema"
import { SessionCompaction } from "./compaction"
import { AgentControlEvents } from "../control-plane/agent-control-events"
import { AutonomousCompletionGate } from "../control-plane/autonomous-completion-gate"
import { Instance } from "../project/instance"
import { defer } from "../util/defer"
import { NotFoundError } from "@/storage/db"
import { Flag } from "../flag/flag"
import { Recorder } from "../replay/recorder"
import { Todo } from "./todo"
import { SessionGoal } from "./goal"
import { Config } from "@/config/config"
import { Isolation } from "@/isolation"
import { fn } from "@/util/fn"
import { LLM } from "./llm"
import { iife } from "@/util/iife"
import { agentInfo, modelInfo } from "./prompt-agent-model-info"
import {
  processorLoopDecision,
  assistantLoopExitDecision,
  assistantRespondedAfterUser,
} from "./prompt-loop-decisions"
import {
  maybeSchedulePreflightCompaction,
  maybeScheduleUsageCompaction,
  processPendingCompaction,
} from "./prompt-loop-compaction"
import { handlePromptLoopError } from "./prompt-loop-errors"
import { loopMessages, scanLoopMessages } from "./prompt-loop-messages"
import {
  beginPromptLoopRecording,
  finishPromptLoopRecording,
  type PromptLoopEndReason,
} from "./prompt-loop-recording"
import { resolvePromptLoopResult } from "./prompt-loop-result"
import { markPromptLoopBusy } from "./prompt-loop-status"
import { preparePromptRequest, type PromptRequestCache } from "./prompt-request-build"
import { createStructuredOutputTurn } from "./prompt-structured-output"
import { executeSubtask, type SubtaskContext } from "./prompt-subtask"
import { resolveTools } from "./prompt-tools"
import { clearPromptProcessorInstructions, createPromptProcessor } from "./prompt-processor"
import { addPromptGoalUsage } from "./prompt-goal-usage"
import {
  pendingTodoContinuationDecision,
  pendingTodoSignature,
  todoContextConvergenceDecision,
  todoDeadlineConvergenceDecision,
} from "./prompt-todo-continuation"
import { AutonomousContinuationPrompt } from "./prompt-autonomous-continuations"
import {
  agentStepLimitContinuationDecision,
  completionGateEventState,
  completionGateRetryDecision,
  emptyModelTurnDecision,
  globalStepLimitDecision,
  goalContinuationDecision,
  isEmptyModelTurn,
  modelTurnFinished,
} from "./prompt-autonomous-decisions"
import { insertReminders } from "./prompt-reminders"
import { executeShellCommand } from "./prompt-shell-command"
import { executePromptCommand } from "./prompt-command-execution"
import { publishPromptFailure } from "./prompt-loop-failure"
import { createDeferredCodeGraphAutoIndex } from "./prompt-code-graph"
import { recordPromptSessionStart } from "./prompt-session-start"
import { scheduleFirstTurnSummary } from "./prompt-session-summary"
import { enforceSuperLongDeadline } from "./prompt-super-long"
import { createAutonomousTextContinuation, createUserMessage } from "./prompt-user-message"
import { permissionRulesetFromLegacyTools } from "./prompt-permission"
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

// @ts-ignore
globalThis.AI_SDK_LOG_WARNINGS = false

const STRUCTURED_OUTPUT_SYSTEM_PROMPT = `IMPORTANT: The user has requested structured output. You MUST use the StructuredOutput tool to provide your final response. Do NOT respond with plain text - you MUST call the StructuredOutput tool with your answer formatted according to the schema.`

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
    if (permissions.length > 0) {
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
      if (reason !== "completed") {
        return cancel(sessionID)
      }
      const callbacks = runState.queuedCallbacks(sessionID)
      if (callbacks.length === 0) {
        return cancel(sessionID)
      }
      runState.markIdle(sessionID)
      // Queued messages are waiting — re-enter the loop to process them.
      // Mirrors the pattern in shell() at lines 1681-1692.
      loop({ sessionID, resume_existing: true }).catch((error) => {
        log.error("session loop failed to resume for queued messages", {
          command: "session.prompt.loop",
          status: "error",
          sessionID,
          error,
        })
        cancel(sessionID)
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
    const cachedSystemPrompt: PromptRequestCache = {
      environment: undefined,
      environmentModelKey: undefined,
      instructions: undefined,
    }
    // Cache agent/model info per loop to avoid repeated async lookups
    let cachedAgent: PromptCacheEntry<Agent.Info>
    let cachedModel: PromptCacheEntry<Provider.Model>
    let fallbackModelOverride: MessageV2.User["model"] | undefined
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
      cachedMsgs = undefined
      cachedAgent = undefined
      cachedModel = undefined
      if (resetTodoDeadlineSignature) {
        lastTodoDeadlineSignature = undefined
      }
      if (resetTodoProgressTracking) {
        lastPendingTodoSignature = undefined
        stagnantTodoRetries = 0
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
    while (true) {
      await markPromptLoopBusy({ sessionID, step, maxSteps: sessionStepLimit, consecutiveErrors })
      if (abort.aborted) {
        reason = "aborted"
        break
      }

      // Safety: prevent infinite loops
      const globalStepLimit = globalStepLimitDecision({
        step,
        stepLimit: sessionStepLimit,
        autonomous,
        continuations,
        maxContinuations,
      })
      if (globalStepLimit.action === "continue") {
        await continueAutonomousLoop({
          event: "autonomous auto-continue",
          resetTodoProgressTracking: true,
          text: AutonomousContinuationPrompt.stepLimit({
            stepLimit: sessionStepLimit,
            continuation: globalStepLimit.continuation,
            maxContinuations,
          }),
        })
        continue
      }
      if (globalStepLimit.action === "stop") {
        log.warn("global step limit reached", {
          command: "session.prompt.loop",
          status: "error",
          errorCode: globalStepLimit.errorCode,
          step,
          sessionID,
          continuations,
        })
        Session.publishError({
          sessionID,
          message: globalStepLimit.message,
        })
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
        autonomous,
        config: { enabled: cfg.super_long },
      })
      if (superLongDeadline.action === "stop") {
        if (superLongDeadline.invalidatedMessages) cachedMsgs = undefined
        reason = superLongDeadline.reason
        break
      }
      const assistantExit = assistantLoopExitDecision({
        lastUserID: lastUser.id,
        lastAssistant,
        hasPendingSubtask: tasks.some((t) => t.type === "subtask"),
      })
      if (assistantExit.action === "complete") {
        log.info("exiting loop", { command: "session.prompt.loop", status: "ok", sessionID })
        reason = "completed"
        break
      }
      if (assistantExit.action === "complete_unknown_finish") {
        log.warn(assistantExit.logMessage, {
          command: "session.prompt.loop",
          sessionID,
        })
        reason = "completed"
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

      const modelKey = `${lastUser.model.providerID}/${lastUser.model.modelID}`
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
      const agentStepLimit = agentStepLimitContinuationDecision({
        step,
        maxSteps,
        autonomous,
        continuations,
        maxContinuations,
      })
      if (agentStepLimit.action === "continue") {
        await continueAutonomousLoop({
          event: "autonomous agent step-limit auto-continue",
          resetTodoDeadlineSignature: true,
          resetTodoProgressTracking: true,
          text: AutonomousContinuationPrompt.agentStepLimit({
            agentName: agent.name,
            maxSteps,
            continuation: agentStepLimit.continuation,
            maxContinuations,
          }),
          logExtras: { agent: agent.name, maxSteps },
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
          userModel: lastUser.model,
          model,
          userParts: lastUserParts ?? [],
          system: request.system,
          requestMessages: request.requestMessages,
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

      // Check if user explicitly invoked an agent via @ in this turn
      const bypassAgentCheck = lastUserParts?.some((p) => p.type === "agent") ?? false

      const tools = await resolveTools({
        agent,
        session,
        model,
        tools: lastUser.tools,
        processor,
        bypassAgentCheck,
        messages: msgs,
        isolation: Isolation.resolve(cfg.isolation, Instance.directory, Instance.worktree),
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
      if (!emptyModelTurn) emptyModelTurnRetries = 0

      if (modelFinished && !processor.message.error) {
        if (await structuredOutput.failIfMissing(processor.message)) {
          reason = "error"
          break
        }
      }
      const updatedGoal = await addPromptGoalUsage({ sessionID, message: processor.message })

      // In autonomous mode, when the model ends a turn cleanly but leaves todos
      // pending, inject a continuation user message and keep the loop running.
      // This is the runtime guarantee — complements the system-prompt reminder
      // injected per turn. Capped by maxTodoRetries to prevent infinite loops when
      // the model genuinely cannot finish a todo (blocked tool, missing data, etc.).
      if (autonomous && !processor.message.error) {
        const latestMessages = await Session.messages({ sessionID })
        const pendingTodos = Todo.get(sessionID).filter((t) => t.status === "pending" || t.status === "in_progress")
        const completionGate = AutonomousCompletionGate.evaluate({
          messages: latestMessages,
          pendingTodos,
        })
        const shouldRecoverEmptySubagentResult =
          completionGate.status === "blocked" && completionGate.reason === "empty_subagent_result"

        if (modelFinished || shouldRecoverEmptySubagentResult) {
          const gateEventState = completionGateEventState({
            gate: completionGate,
            todoRetries,
            maxTodoRetries,
            completionGateRetries,
            maxCompletionGateRetries,
          })
          Recorder.emit(
            AgentControlEvents.completionGateDecided({
              sessionID,
              messageID: processor.message.id,
              stepIndex: step,
              status: completionGate.status,
              reason: gateEventState.reason,
              message: gateEventState.message,
              retryCount: gateEventState.retryCount,
              maxRetries: gateEventState.maxRetries,
            }),
          )
        }

        const emptyTurnDecision = emptyModelTurnDecision({
          emptyModelTurn,
          emptyModelTurnRetries,
          maxEmptyModelTurnRetries,
          todoRetries,
        })

        if (emptyTurnDecision.action === "stop") {
          log.warn("autonomous stopped after repeated empty model turn", {
            command: "session.prompt.loop",
            status: "stopped",
            errorCode: emptyTurnDecision.errorCode,
            sessionID,
            attempts: emptyModelTurnRetries,
            maxAttempts: maxEmptyModelTurnRetries,
            pendingCount: pendingTodos.length,
          })
          await publishPromptFailure({ sessionID, assistant: processor.message, message: emptyTurnDecision.message })
          reason = emptyTurnDecision.reason
          break
        }

        emptyModelTurnRetries = emptyTurnDecision.emptyModelTurnRetries

        if (emptyTurnDecision.action === "recover") {
          todoRetries = emptyTurnDecision.todoRetries
          log.warn("autonomous empty model turn recovery", {
            command: "session.prompt.loop",
            status: "retry",
            errorCode: "EMPTY_MODEL_TURN",
            sessionID,
            attempt: emptyTurnDecision.attempt,
            maxAttempts: maxEmptyModelTurnRetries,
            pendingCount: pendingTodos.length,
          })
          await createAutonomousTextContinuation({
            sessionID,
            messages: latestMessages,
            text: AutonomousContinuationPrompt.emptyModelTurnRecovery({
              attempt: emptyTurnDecision.attempt,
              maxAttempts: maxEmptyModelTurnRetries,
            }),
          })
          continue
        }

        if (shouldRecoverEmptySubagentResult) {
          const gateRetryDecision = completionGateRetryDecision({
            gate: completionGate,
            previousSignature: lastCompletionGateSignature,
            retries: completionGateRetries,
            maxRetries: maxCompletionGateRetries,
            isLastStep,
          })

          if (gateRetryDecision.action === "stop") {
            log.warn("autonomous completion gate stopped session", {
              command: "session.prompt.loop",
              status: "stopped",
              errorCode: gateRetryDecision.errorCode,
              sessionID,
              reason: completionGate.reason,
              message: completionGate.message,
              attempts: gateRetryDecision.attempts,
              maxAttempts: maxCompletionGateRetries,
            })
            await publishPromptFailure({ sessionID, assistant: processor.message, message: gateRetryDecision.message })
            reason = gateRetryDecision.reason
            break
          }

          lastCompletionGateSignature = gateRetryDecision.signature
          completionGateRetries = gateRetryDecision.retries

          log.info("autonomous completion gate continuation", {
            command: "session.prompt.loop",
            status: "ok",
            sessionID,
            reason: completionGate.reason,
            message: completionGate.message,
            attempt: gateRetryDecision.attempt,
            maxAttempts: maxCompletionGateRetries,
          })
          await createAutonomousTextContinuation({
            sessionID,
            messages: latestMessages,
            text: AutonomousContinuationPrompt.completionGateRetry({
              message: completionGate.message,
              attempt: gateRetryDecision.attempt,
              maxAttempts: maxCompletionGateRetries,
            }),
          })
          continue
        }

        if (completionGate.status === "allow") {
          completionGateRetries = 0
          lastCompletionGateSignature = undefined
        }

        const remainingAgentSteps = Number.isFinite(maxSteps) ? Math.max(0, maxSteps - step) : Infinity
        const contextConvergence = todoContextConvergenceDecision({
          pendingTodos,
          inputTokens: processor.message.tokens.input,
        })
        if (!modelFinished && contextConvergence.converge) {
          const signature = pendingTodoSignature(pendingTodos)
          if (signature !== lastTodoContextSignature) {
            lastTodoContextSignature = signature
            log.info("autonomous todo context convergence", {
              command: "session.prompt.loop",
              status: "ok",
              sessionID,
              pendingCount: pendingTodos.length,
              inputTokens: processor.message.tokens.input ?? 0,
              threshold: contextConvergence.threshold,
            })
            await createAutonomousTextContinuation({
              sessionID,
              messages: latestMessages,
              text: AutonomousContinuationPrompt.contextConvergence({ pendingTodos }),
            })
            continue
          }
        }

        const deadlineConvergence = todoDeadlineConvergenceDecision({
          modelFinished: Boolean(modelFinished),
          pendingTodos,
          remainingAgentSteps,
        })
        if (deadlineConvergence.converge) {
          const signature = pendingTodoSignature(pendingTodos)
          if (signature !== lastTodoDeadlineSignature) {
            lastTodoDeadlineSignature = signature
            log.info("autonomous todo deadline convergence", {
              command: "session.prompt.loop",
              status: "ok",
              sessionID,
              pendingCount: pendingTodos.length,
              remainingAgentSteps,
              maxSteps,
            })
            await createAutonomousTextContinuation({
              sessionID,
              messages: latestMessages,
              text: AutonomousContinuationPrompt.deadlineConvergence({
                remainingAgentSteps,
                pendingTodos,
                includeReportClosureGuidance: deadlineConvergence.includeReportClosureGuidance,
              }),
            })
            continue
          }
        }

        if (modelFinished && pendingTodos.length > 0) {
          const todoContinuation = pendingTodoContinuationDecision({
            isLastStep,
            todoRetries,
            maxTodoRetries,
            pendingTodos,
            lastPendingTodoSignature,
            stagnantTodoRetries,
          })

          if (todoContinuation.action === "stop_step_limit") {
            log.warn("autonomous todo continuation stopped at agent step limit", {
              command: "session.prompt.loop",
              status: "stopped",
              errorCode: todoContinuation.errorCode,
              sessionID,
              pendingCount: pendingTodos.length,
              attempts: todoRetries,
              maxAttempts: maxTodoRetries,
              maxSteps,
            })
            await publishPromptFailure({ sessionID, assistant: processor.message, message: todoContinuation.message })
            reason = todoContinuation.reason
            break
          }

          if (todoContinuation.action === "stop_retry_budget") {
            log.warn("autonomous todo continuation stopped after retry budget", {
              command: "session.prompt.loop",
              status: "stopped",
              sessionID,
              pendingCount: pendingTodos.length,
              attempts: todoRetries,
              maxAttempts: maxTodoRetries,
            })
            await publishPromptFailure({ sessionID, assistant: processor.message, message: todoContinuation.message })
            reason = todoContinuation.reason
            break
          }

          lastPendingTodoSignature = todoContinuation.lastPendingTodoSignature
          stagnantTodoRetries = todoContinuation.stagnantTodoRetries
          todoRetries = todoContinuation.todoRetries

          if (todoContinuation.stagnant) {
            log.warn("autonomous todo continuation is stagnant", {
              command: "session.prompt.loop",
              status: "retry",
              sessionID,
              pendingCount: pendingTodos.length,
              attempts: todoRetries,
              stagnantAttempts: stagnantTodoRetries,
              maxStagnantAttempts: todoContinuation.maxStagnantAttempts,
            })
          }

          log.info("autonomous todo continuation", {
            command: "session.prompt.loop",
            status: "ok",
            sessionID,
            pendingCount: pendingTodos.length,
            attempt: todoRetries,
            maxAttempts: maxTodoRetries,
            stagnantAttempts: stagnantTodoRetries,
          })
          await createAutonomousTextContinuation({
            sessionID,
            messages: latestMessages,
            text: AutonomousContinuationPrompt.todoContinuation({
              pendingTodos,
              attempt: todoRetries,
              maxAttempts: maxTodoRetries,
              includeReportClosureGuidance: todoContinuation.includeReportClosureGuidance,
              stagnantTodoRetries: todoContinuation.stagnant ? stagnantTodoRetries : undefined,
            }),
          })
          continue
        }
      }

      if (modelFinished && !processor.message.error) {
        const goal = updatedGoal ?? (await SessionGoal.get(sessionID))
        const goalDecision = goalContinuationDecision({
          goal,
          continuations,
          maxContinuations,
          budgetLimitContinuationSent: goalBudgetLimitContinuationSent,
        })

        if (goalDecision.action === "continue_active") {
          await continueAutonomousLoop({
            event: "goal auto-continuation",
            resetTodoProgressTracking: true,
            text: AutonomousContinuationPrompt.goal({
              objective: goalDecision.objective,
              continuation: goalDecision.continuation,
              maxContinuations,
            }),
          })
          continue
        }

        if (goalDecision.action === "continue_budget_wrapup") {
          goalBudgetLimitContinuationSent = true
          await continueAutonomousLoop({
            event: "goal budget-limit wrap-up",
            resetTodoProgressTracking: true,
            text: AutonomousContinuationPrompt.goalBudgetLimit({
              objective: goalDecision.objective,
              tokensUsed: goalDecision.tokensUsed,
              tokenBudget: goalDecision.tokenBudget,
              timeUsedSeconds: goalDecision.timeUsedSeconds,
            }),
          })
          continue
        }

        if (goalDecision.action === "stop_active_limit" || goalDecision.action === "stop_budget_limit") {
          Session.publishError({ sessionID, message: goalDecision.message })
          reason = goalDecision.reason
          break
        }
      }

      const processorDecision = processorLoopDecision({
        result,
        messageFinish: processor.message.finish,
        hasError: Boolean(processor.message.error),
      })
      if (processorDecision.action === "stop") {
        reason = processorDecision.reason
        break
      }

      // Track consecutive errors — break if agent is stuck
      if (processor.message.error) {
        consecutiveErrors++
        const errorResult = await handlePromptLoopError({
          sessionID,
          currentModel: lastUser.model,
          error: processor.message.error,
          consecutiveErrors,
          step,
        })
        consecutiveErrors = errorResult.consecutiveErrors
        if (errorResult.action === "fallback") {
          fallbackModelOverride = errorResult.fallbackModel
          cachedModel = undefined
          continue
        }
        if (errorResult.action === "stop") {
          reason = errorResult.reason
          break
        }
      } else {
        consecutiveErrors = 0 // Reset on success
        if (fallbackModelOverride) {
          fallbackModelOverride = undefined
          cachedModel = undefined
        }
      }

      if (processorDecision.action === "compact") {
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
