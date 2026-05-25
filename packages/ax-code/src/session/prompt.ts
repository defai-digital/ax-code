import os from "os"
import { MessageID, SessionID } from "./schema"
import { MessageV2 } from "./message-v2"
import { Log } from "../util/log"
import { SessionRevert } from "./revert"
import { Session } from "."
import { Agent } from "../agent/agent"
import { Provider } from "../provider/provider"
import { ModelID, ProviderID } from "../provider/schema"
import { type ModelMessage } from "ai"
import { SessionCompaction } from "./compaction"
import { GLOBAL_STEP_LIMIT } from "@/constants/session"
import { AgentControlEvents } from "../control-plane/agent-control-events"
import { AutonomousCompletionGate } from "../control-plane/autonomous-completion-gate"
import { Instance } from "../project/instance"
import { SystemPrompt } from "./system"
import { InstructionPrompt } from "./instruction"
import { Plugin } from "../plugin"
import MAX_STEPS from "../session/prompt/max-steps.txt"
import { defer } from "../util/defer"
import { NotFoundError } from "@/storage/db"
import { Flag } from "../flag/flag"
import { Recorder } from "../replay/recorder"
import { BlastRadius } from "./blast-radius"
import { Todo } from "./todo"
import { SessionGoal } from "./goal"
import { Config } from "@/config/config"
import { Isolation } from "@/isolation"
import { SessionSummary } from "./summary"
import { fn } from "@/util/fn"
import { SessionProcessor } from "./processor"
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
import { loopMessages, remindQueuedMessages, scanLoopMessages } from "./prompt-loop-messages"
import { markPromptLoopBusy } from "./prompt-loop-status"
import { systemPrompt as getSystemPrompt } from "./prompt-system"
import { createStructuredOutputTool } from "./prompt-structured-output"
import { sessionAssistantPath, textPart, zeroTokenUsage } from "./prompt-message-builders"
import { executeSubtask, type SubtaskContext } from "./prompt-subtask"
import { resolveTools } from "./prompt-tools"
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
import { createSyntheticFailureAssistant, publishPromptFailure } from "./prompt-loop-failure"
import { createDeferredCodeGraphAutoIndex } from "./prompt-code-graph"
import { recordPromptSessionStart } from "./prompt-session-start"
import { createAutonomousUserContinuation, createUserMessage } from "./prompt-user-message"
import { permissionRulesetFromLegacyTools } from "./prompt-permission"
import { createPromptRunState } from "./prompt-run-state"
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
import { SuperLongPolicy } from "./super-long-policy"
import { SuperLongRuntime } from "./super-long-runtime"

// @ts-ignore
globalThis.AI_SDK_LOG_WARNINGS = false

const MAX_EMPTY_MODEL_TURN_RETRIES = 1

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
      if (sessionStarted && !isResumingActiveLoop) {
        Recorder.emit({
          type: "session.end",
          sessionID,
          reason,
          totalSteps,
        })
      }
      await Recorder.end(sessionID)
      // Release the autonomous-mode per-session counters and the
      // BlastRadius cap state. Without this the module-level Map grows
      // unbounded across the process lifetime — small per-session, but
      // accumulates over hundreds of sessions.
      BlastRadius.reset(sessionID)
    })
    Recorder.begin(sessionID)
    // Idempotent — primary warmup happens in InstanceBootstrap so providers
    // load in the background while the UI renders. This is a fallback in
    // case the prompt loop is entered without a full bootstrap.
    Provider.warmup()

    // Structured output state
    // Note: On session resumption, state is reset but outputFormat is preserved
    // on the user message and will be retrieved from lastUser below
    let structuredOutput: unknown | undefined

    let step = 0
    let totalSteps = 0
    let reason: "completed" | "aborted" | "error" | "step_limit" | "stalled" = "error"
    let consecutiveErrors = 0
    let continuations = 0
    let goalBudgetLimitContinuationSent = false
    const deferredCodeGraphAutoIndex = createDeferredCodeGraphAutoIndex({ sessionID, abort })
    await using _autoIndex = defer(deferredCodeGraphAutoIndex.flush)
    const session = await Session.get(sessionID)
    // Pre-load expensive resources once before the loop
    const cfg = await Config.get()
    const sessionStepLimit = cfg.session?.max_steps ?? GLOBAL_STEP_LIMIT
    const autonomous = Flag.AX_CODE_AUTONOMOUS
    const maxContinuations = cfg.session?.max_continuations ?? 3
    const maxTodoRetries = cfg.session?.max_todo_retries ?? 10
    const maxCompletionGateRetries = Math.min(maxTodoRetries, 2)
    let todoRetries = 0
    let completionGateRetries = 0
    let lastCompletionGateSignature: string | undefined
    let lastPendingTodoSignature: string | undefined
    let lastTodoDeadlineSignature: string | undefined
    let lastTodoContextSignature: string | undefined
    let stagnantTodoRetries = 0
    let emptyModelTurnRetries = 0
    const cachedSystemPrompt: Parameters<typeof getSystemPrompt>[0]["cache"] = {
      environment: undefined,
      environmentModelKey: undefined,
      instructions: undefined,
    }
    // Cache agent/model info per loop to avoid repeated async lookups
    let cachedAgent: { key: string; value: Agent.Info } | undefined
    let cachedModel: { key: string; value: Provider.Model } | undefined
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
      await createAutonomousUserContinuation({
        sessionID,
        messages: latestMessages,
        parts: [{ type: "text", text }],
      })
    }

    // Counter for consecutive compaction "busy" returns. Reset on any
    // non-busy compaction outcome (or any other task type) so the cap
    // only triggers on a genuinely stuck in-flight compaction, not on
    // accumulated busy events across unrelated turns.
    let compactionBusyRetries = 0
    while (true) {
      // Reset structured output state at the start of each iteration so
      // a stale value from a prior step cannot cause the loop to save
      // old output and break out prematurely. `structuredOutput` is
      // populated via the onSuccess callback only when the current step
      // is actually using structured output mode.
      structuredOutput = undefined
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
      const superLongState = SuperLongPolicy.runtimeState({
        modelID: lastUser.model.modelID,
        config: { enabled: cfg.super_long },
      })
      const superLongEnabled = autonomous && superLongState.enabled
      const superLongNow = Date.now()
      const superLongStartedAt = superLongEnabled
        ? await SuperLongRuntime.sessionStartedAt({ sessionID, now: superLongNow }).catch((error) => {
            log.warn("failed to load durable super-long session start; using current loop start", {
              sessionID,
              error,
            })
            return superLongNow
          })
        : superLongNow
      const superLongDeadline = SuperLongPolicy.deadline({
        enabled: superLongEnabled,
        startedAt: superLongStartedAt,
        now: superLongNow,
      })
      const superLongDeadlineStop = SuperLongPolicy.deadlineStopDecision({
        deadline: superLongDeadline,
        source: superLongState.source,
      })
      if (superLongDeadlineStop.action === "stop") {
        log.warn(superLongDeadlineStop.logMessage, {
          command: "session.prompt.loop",
          status: superLongDeadlineStop.status,
          errorCode: superLongDeadlineStop.errorCode,
          sessionID,
          ...superLongDeadlineStop.details,
        })
        if (!assistantRespondedAfterUser({ lastUserID: lastUser.id, lastAssistant })) {
          await createSyntheticFailureAssistant({ sessionID, lastUser, message: superLongDeadlineStop.message })
          cachedMsgs = undefined
        }
        Session.publishError({
          sessionID,
          message: superLongDeadlineStop.message,
        })
        reason = superLongDeadlineStop.reason
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
      const model =
        cachedModel?.key === modelKey
          ? cachedModel.value
          : await modelInfo({
              sessionID,
              providerID: lastUser.model.providerID,
              modelID: lastUser.model.modelID,
            }).catch((e) => {
              reason = "error"
              throw e
            })
      cachedModel = { key: modelKey, value: model }
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
      const agent =
        cachedAgent?.key === lastUser.agent
          ? cachedAgent.value
          : await agentInfo({ sessionID, name: lastUser.agent }).catch((error) => {
              reason = "error"
              throw error
            })
      cachedAgent = { key: lastUser.agent, value: agent }
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
        SessionSummary.summarize(
          {
            sessionID: sessionID,
            messageID: lastUser.id,
          },
          msgs,
        ).catch(async (e) => {
          log.warn("summarize failed, setting fallback title", {
            command: "session.prompt.summarize",
            status: "error",
            sessionID,
            error: e,
          })
          await Session.setTitle({ sessionID, title: "Untitled session" }).catch((e) => {
            log.warn("fallback setTitle also failed", { sessionID, error: e })
          })
        })
      }

      // Ephemerally wrap queued user messages with a reminder to stay on track
      if (step > 1) msgs = remindQueuedMessages(msgs, lastFinished)

      await Plugin.trigger("experimental.chat.messages.transform", {}, { messages: msgs })

      // Build system prompt and convert messages to model format in parallel —
      // both walk the same msgs/model independently with no side effects on
      // each other, so awaiting them sequentially wastes wall-clock time on
      // long sessions where toModelMessages can run 10-30ms.
      const format = lastUser.format ?? { type: "text" }
      const [system, modelMessages] = await Promise.all([
        getSystemPrompt({
          agent,
          model,
          format,
          cache: cachedSystemPrompt,
          messages: msgs,
          sessionID,
          structuredPrompt: STRUCTURED_OUTPUT_SYSTEM_PROMPT,
        }),
        MessageV2.toModelMessages(msgs, model),
      ])
      const requestMessages: ModelMessage[] = [
        ...modelMessages,
        ...(isLastStep
          ? [
              {
                role: "assistant" as const,
                content: MAX_STEPS,
              },
            ]
          : []),
      ]
      if (
        await maybeSchedulePreflightCompaction({
          sessionID,
          agent: lastUser.agent,
          userModel: lastUser.model,
          model,
          userParts: lastUserParts ?? [],
          system,
          requestMessages,
        })
      ) {
        cachedMsgs = undefined
        continue
      }

      const processor = SessionProcessor.create({
        assistantMessage: (await Session.updateMessage({
          id: MessageID.ascending(),
          parentID: lastUser.id,
          role: "assistant",
          mode: agent.name,
          agent: agent.name,
          variant: lastUser.variant,
          path: sessionAssistantPath(),
          tokens: zeroTokenUsage(),
          modelID: model.id,
          providerID: model.providerID,
          time: {
            created: Date.now(),
          },
          sessionID,
        })) as MessageV2.Assistant,
        sessionID: sessionID,
        model,
        abort,
        messages: msgs,
      })
      using _ = defer(() => InstructionPrompt.clear(processor.message.id))

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

      // Inject StructuredOutput tool if JSON schema mode enabled
      if (lastUser.format?.type === "json_schema") {
        tools["StructuredOutput"] = createStructuredOutputTool({
          schema: lastUser.format.schema,
          onSuccess(output) {
            structuredOutput = output
          },
        })
      }

      const result = await processor.process({
        user: lastUser,
        agent,
        permission: session.permission,
        abort,
        sessionID,
        system,
        messages: requestMessages,
        tools,
        model,
        toolChoice: format.type === "json_schema" ? "required" : undefined,
        config: cfg,
      })

      // If structured output was captured, save it and exit immediately
      // This takes priority because the StructuredOutput tool was called successfully
      if (structuredOutput !== undefined) {
        processor.message.structured = structuredOutput
        processor.message.finish = processor.message.finish ?? "stop"
        await Session.updateMessage(processor.message)
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
        if (format.type === "json_schema") {
          // Model stopped without calling StructuredOutput tool
          processor.message.error = new MessageV2.StructuredOutputError({
            message: "Model did not produce structured output",
            retries: 0,
          }).toObject()
          await Session.updateMessage(processor.message)
          reason = "error"
          break
        }
      }
      const updatedGoal = await SessionGoal.addUsage({ sessionID, message: processor.message }).catch((error) => {
        log.warn("goal usage update failed", {
          command: "session.goal.usage",
          status: "error",
          sessionID,
          error,
        })
        return undefined
      })

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
          maxEmptyModelTurnRetries: MAX_EMPTY_MODEL_TURN_RETRIES,
          todoRetries,
        })

        if (emptyTurnDecision.action === "stop") {
          log.warn("autonomous stopped after repeated empty model turn", {
            command: "session.prompt.loop",
            status: "stopped",
            errorCode: emptyTurnDecision.errorCode,
            sessionID,
            attempts: emptyModelTurnRetries,
            maxAttempts: MAX_EMPTY_MODEL_TURN_RETRIES,
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
            maxAttempts: MAX_EMPTY_MODEL_TURN_RETRIES,
            pendingCount: pendingTodos.length,
          })
          await createAutonomousUserContinuation({
            sessionID,
            messages: latestMessages,
            parts: [
              {
                type: "text",
                text: AutonomousContinuationPrompt.emptyModelTurnRecovery({
                  attempt: emptyTurnDecision.attempt,
                  maxAttempts: MAX_EMPTY_MODEL_TURN_RETRIES,
                }),
              },
            ],
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
          await createAutonomousUserContinuation({
            sessionID,
            messages: latestMessages,
            parts: [
              {
                type: "text",
                text: AutonomousContinuationPrompt.completionGateRetry({
                  message: completionGate.message,
                  attempt: gateRetryDecision.attempt,
                  maxAttempts: maxCompletionGateRetries,
                }),
              },
            ],
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
            await createAutonomousUserContinuation({
              sessionID,
              messages: latestMessages,
              parts: [
                {
                  type: "text",
                  text: AutonomousContinuationPrompt.contextConvergence({ pendingTodos }),
                },
              ],
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
            await createAutonomousUserContinuation({
              sessionID,
              messages: latestMessages,
              parts: [
                {
                  type: "text",
                  text: AutonomousContinuationPrompt.deadlineConvergence({
                    remainingAgentSteps,
                    pendingTodos,
                    includeReportClosureGuidance: deadlineConvergence.includeReportClosureGuidance,
                  }),
                },
              ],
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
          await createAutonomousUserContinuation({
            sessionID,
            messages: latestMessages,
            parts: [
              {
                type: "text",
                text: AutonomousContinuationPrompt.todoContinuation({
                  pendingTodos,
                  attempt: todoRetries,
                  maxAttempts: maxTodoRetries,
                  includeReportClosureGuidance: todoContinuation.includeReportClosureGuidance,
                  stagnantTodoRetries: todoContinuation.stagnant ? stagnantTodoRetries : undefined,
                }),
              },
            ],
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
    SessionCompaction.prune({ sessionID }).catch((e) =>
      log.warn("prune failed", { command: "session.prompt.prune", status: "error", sessionID, error: e }),
    )
    for await (const item of MessageV2.stream(sessionID)) {
      if (item.info.role === "user") continue
      runState.shiftQueuedCallback(sessionID)?.resolve(item)
      return item
    }
    if (abort.aborted) throw new DOMException("Aborted", "AbortError")
    throw new Error("Impossible")
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
