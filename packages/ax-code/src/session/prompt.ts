import os from "os"
import z from "zod"
import { Env } from "../util/env"
import { SessionID, MessageID } from "./schema"
import { MessageV2 } from "./message-v2"
import { Log } from "../util/log"
import { SessionRevert } from "./revert"
import { Session } from "."
import { Agent } from "../agent/agent"
import { Provider } from "../provider/provider"
import { ModelID, ProviderID } from "../provider/schema"
import { type ModelMessage } from "ai"
import { SessionCompaction } from "./compaction"
import { SessionRetry } from "./retry"
import { MAX_CONSECUTIVE_ERRORS, GLOBAL_STEP_LIMIT } from "@/constants/session"
import { AgentControlEvents } from "../control-plane/agent-control-events"
import { AutonomousCompletionGate } from "../control-plane/autonomous-completion-gate"
import { Instance } from "../project/instance"
import { Bus } from "../bus"
import { SystemPrompt } from "./system"
import { InstructionPrompt } from "./instruction"
import { Plugin } from "../plugin"
import MAX_STEPS from "../session/prompt/max-steps.txt"
import { defer } from "../util/defer"
import { NotFoundError } from "@/storage/db"
import { Flag } from "../flag/flag"
import { Recorder } from "../replay/recorder"
import { BlastRadius } from "./blast-radius"
import { CodeIntelligence } from "../code-intelligence"
import { AutoIndex } from "../code-intelligence/auto-index"
import type { ProjectID } from "../project/schema"
import { Todo } from "./todo"
import { SessionGoal } from "./goal"
import { spawn } from "child_process"
import { Command } from "../command"
import { pathToFileURL } from "url"
import { Config } from "@/config/config"
import { Isolation } from "@/isolation"
import { SessionSummary } from "./summary"
import { NamedError } from "@ax-code/util/error"
import { fn } from "@/util/fn"
import { SessionProcessor } from "./processor"
import { Permission } from "@/permission"
import { SessionStatus } from "./status"
import { LLM } from "./llm"
import { iife } from "@/util/iife"
import { Shell } from "@/shell/shell"
import { appendShellOutputChunk, shellArgs, shellOutputMetadata } from "./prompt-shell-runtime"
import {
  commandModel,
  commandSetup,
  agentInfo,
  assistantLoopExitDecision,
  assistantRespondedAfterUser,
  consecutiveErrorDecision,
  providerFallbackLookupDecision,
  providerFallbackSwitchState,
  processorLoopDecision,
  remindQueuedMessages,
  scanLoopMessages,
  loopMessages,
  modelInfo,
  pendingCompactionDecision,
  parseGoalArguments,
  shouldScheduleUsageCompaction,
  sessionAssistantPath,
  systemPrompt as getSystemPrompt,
  textPart,
  zeroTokenUsage,
  createStructuredOutputTool,
  lastModel,
  findFallbackModel,
  ensureTitle,
} from "./prompt-helpers"
import { executeSubtask, type SubtaskContext } from "./prompt-subtask"
import { resolveTools } from "./prompt-tools"
import {
  pendingTodoContinuationDecision,
  pendingTodoSignature,
  todoContextConvergenceDecision,
  todoDeadlineConvergenceDecision,
} from "./prompt-todo-continuation"
import { estimateRequestTokens, getLastUserInfo } from "./prompt-request"
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
import { resolveUserMessageRouting } from "./prompt-routing"
import { validateUserMessageForSave } from "./prompt-message-validation"
import { resolveUserMessageParts } from "./prompt-message-parts"
import { createShellTurnMessages } from "./prompt-shell-turn"
import { FilePartInput, PromptPartInput } from "./prompt-part-input"
import { createStoppedAssistantTextResponse } from "./prompt-assistant-response"
import { resolveCommandForExecution } from "./prompt-command"
import { SuperLongPolicy } from "./super-long-policy"
import { SuperLongRuntime } from "./super-long-runtime"

// @ts-ignore
globalThis.AI_SDK_LOG_WARNINGS = false

const MAX_EMPTY_MODEL_TURN_RETRIES = 1

const STRUCTURED_OUTPUT_SYSTEM_PROMPT = `IMPORTANT: The user has requested structured output. You MUST use the StructuredOutput tool to provide your final response. Do NOT respond with plain text - you MUST call the StructuredOutput tool with your answer formatted according to the schema.`

export namespace SessionPrompt {
  const log = Log.create({ service: "session.prompt" })

  const state = Instance.state(
    () => {
      const data: Record<
        string,
        {
          abort: AbortController
          running: boolean
          callbacks: {
            resolve(input: MessageV2.WithParts): void
            reject(reason?: unknown): void
          }[]
        }
      > = {}
      return data
    },
    async (current) => {
      for (const item of Object.values(current)) {
        item.abort.abort()
      }
    },
  )

  export function assertNotBusy(sessionID: SessionID) {
    const match = state()[sessionID]
    if (match) throw new Session.BusyError(sessionID)
  }

  export const PromptInput = z.object({
    sessionID: SessionID.zod,
    messageID: MessageID.zod.optional(),
    model: z
      .object({
        providerID: ProviderID.zod,
        modelID: ModelID.zod,
      })
      .optional(),
    agent: z.string().optional(),
    userSelectedAgent: z
      .boolean()
      .optional()
      .describe("@deprecated Agent auto-routing was removed. Field accepted for backwards compatibility but ignored."),
    agentRouting: z
      .enum(["auto", "preserve"])
      .optional()
      .describe("Controls specialist agent auto-routing. Use preserve for synthetic continuation prompts."),
    noReply: z.boolean().optional(),
    tools: z
      .record(z.string(), z.boolean())
      .optional()
      .describe(
        "@deprecated tools and permissions have been merged, you can set permissions on the session itself now",
      ),
    format: MessageV2.Format.optional(),
    system: z.string().optional(),
    variant: z.string().optional(),
    parts: z.array(PromptPartInput),
  })
  export type PromptInput = z.infer<typeof PromptInput>

  function permissionRulesetFromLegacyTools(tools: Record<string, boolean> | undefined): Permission.Ruleset {
    return Object.entries(tools ?? {}).map(([tool, enabled]) => ({
      permission: tool,
      action: enabled ? "allow" : "deny",
      pattern: "*",
    }))
  }

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
    const s = state()
    const existing = s[sessionID]
    if (existing?.running) return
    const controller = new AbortController()
    s[sessionID] = {
      abort: controller,
      running: true,
      callbacks: existing?.callbacks ?? [],
    }
    return controller.signal
  }

  function resume(sessionID: SessionID) {
    const s = state()
    if (!s[sessionID]?.running) return

    return s[sessionID].abort.signal
  }

  export async function cancel(sessionID: SessionID) {
    log.info("cancel", { command: "session.prompt.cancel", status: "started", sessionID })
    const s = state()
    const match = s[sessionID]
    if (!match) {
      await SessionStatus.set(sessionID, { type: "idle" })
      return
    }
    // Snapshot the callbacks list and delete the state entry BEFORE
    // iterating. A concurrent loop() re-entry that ran between zeroing
    // `match.callbacks.length = 0` and `delete s[sessionID]` could
    // otherwise observe a partially-cleared state. Now any re-entry
    // either sees the original state (and gets rejected via the
    // snapshot) or a fresh start with no leftover callbacks.
    const callbacks = match.callbacks.slice()
    match.callbacks.length = 0
    match.abort.abort()
    delete s[sessionID]
    for (const cb of callbacks) {
      cb.reject(new Error("Session ended"))
    }
    await SessionStatus.set(sessionID, { type: "idle" })
    return
  }

  export const LoopInput = z.object({
    sessionID: SessionID.zod,
    resume_existing: z.boolean().optional(),
  })
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
        const entry = state()[sessionID]
        if (!entry) {
          reject(new Error("Session was cancelled"))
          return
        }
        entry.callbacks.push({ resolve, reject })
      })
    }

    await using _ = defer(() => {
      if (reason !== "completed") {
        return cancel(sessionID)
      }
      const callbacks = state()[sessionID]?.callbacks ?? []
      if (callbacks.length === 0) {
        return cancel(sessionID)
      }
      const entry = state()[sessionID]
      if (entry) entry.running = false
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
    let deferredAutoIndexProjectID: ProjectID | undefined
    await using _autoIndex = defer(() => {
      if (!deferredAutoIndexProjectID || abort.aborted) return
      const projectID = deferredAutoIndexProjectID
      const timer = setTimeout(() => {
        try {
          AutoIndex.maybeStart(projectID)
        } catch (error) {
          log.warn("deferred auto-index scheduling failed", {
            command: "session.prompt.codeGraph",
            status: "error",
            sessionID,
            error,
          })
        }
      }, 0)
      timer.unref?.()
    })
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

    async function createSyntheticStopAssistant(input: { lastUser: MessageV2.User; message: string }) {
      const result = await createStoppedAssistantTextResponse({
        sessionID,
        parent: input.lastUser,
        text: input.message,
        synthetic: true,
        error: new NamedError.Unknown({ message: input.message }).toObject(),
      })
      return result.info
    }

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
      const now = Date.now()
      await SessionStatus.set(sessionID, {
        type: "busy",
        step,
        maxSteps: sessionStepLimit,
        startedAt: now,
        lastActivityAt: now,
        waitState: "llm",
      })
      log.info("loop", { command: "session.prompt.loop", status: "started", step, sessionID, consecutiveErrors })
      if (step > 0 && step % 10 === 0) {
        log.warn("long-running task", {
          command: "session.prompt.loop",
          status: "ok",
          step,
          sessionID,
          message: `Agent has been working for ${step} steps`,
        })
      }
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
          await createSyntheticStopAssistant({ lastUser, message: superLongDeadlineStop.message })
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
        ensureTitle({
          session,
          modelID: lastUser.model.modelID,
          providerID: lastUser.model.providerID,
          history: msgs,
          abort,
        }).catch((error) => {
          log.debug("failed to ensure title", { sessionID, error })
        })
        if (!isResumingActiveLoop) {
          Recorder.emit({
            type: "session.start",
            sessionID,
            agent: lastUser.agent,
            model: `${lastUser.model.providerID}/${lastUser.model.modelID}`,
            directory: Instance.directory,
          })
        }
        // Snapshot the Code Intelligence graph state alongside session.start
        // so deterministic replay can see what the agent "knew" about the
        // code at the moment it began this session, and start the watcher
        // so file edits during the session are reflected in the graph.
        // Both are gated behind the experimental flag so users who have
        // not opted in don't pay any cost for this feature.
        //
        // Defensive: if the code_* tables are missing (e.g. an old DB
        // before v3) or the watcher fails to subscribe, swallow and
        // skip — we never want this to take down a session.
        if (!isResumingActiveLoop && Flag.AX_CODE_EXPERIMENTAL_CODE_INTELLIGENCE) {
          try {
            const s = CodeIntelligence.status(Instance.project.id)
            Recorder.emit({
              type: "code.graph.snapshot",
              sessionID,
              projectID: s.projectID,
              commitSha: s.lastCommitSha,
              nodeCount: s.nodeCount,
              edgeCount: s.edgeCount,
              lastIndexedAt: s.lastUpdated,
            })
            CodeIntelligence.startWatcher(Instance.project.id)
            if (s.nodeCount === 0) {
              try {
                AutoIndex.maybeStart(Instance.project.id)
              } catch (error) {
                log.warn("auto-index scheduling failed during code graph init", {
                  command: "session.prompt.codeGraph",
                  status: "error",
                  sessionID,
                  error,
                })
              }
            }
            // Start auto-index from the same reliable path that starts
            // the graph watcher. maybeStart() is fire-and-forget and
            // self-gates on empty-graph state, in-flight runs, and the
            // explicit auto-index opt-out flag. The deferred callback
            // below remains a second chance for sessions that initialized
            // before the graph became observable.
            deferredAutoIndexProjectID = Instance.project.id
          } catch (e) {
            log.warn("code.graph init skipped", {
              command: "session.prompt.codeGraph",
              status: "error",
              errorCode: "GRAPH_INIT_SKIPPED",
              sessionID,
              e: e instanceof Error ? e.message : String(e),
            })
          }
        }
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
        const result = await SessionCompaction.process({
          messages: msgs,
          parentID: lastUser.id,
          abort,
          sessionID,
          auto: task.auto,
          overflow: task.overflow,
        })
        const decision = pendingCompactionDecision({
          result,
          overflow: task.overflow,
          busyRetries: compactionBusyRetries,
        })
        if (decision.type === "break") {
          reason = decision.reason
          break
        }
        if (decision.type === "retry") {
          compactionBusyRetries += 1
          try {
            // Honor cancel: the previous setTimeout slept regardless of
            // abort state, so a busy-retry chain could stall a session
            // cancel for up to delayMs × remaining attempts.
            await SessionRetry.sleep(decision.delayMs, abort)
          } catch {
            reason = "error"
            break
          }
          cachedMsgs = undefined
          continue
        }
        compactionBusyRetries = 0
        cachedMsgs = undefined // invalidate cache after compaction
        continue
      }

      // context overflow, needs compaction
      if (
        shouldScheduleUsageCompaction({
          lastFinished,
          overflow: lastFinished ? await SessionCompaction.isOverflow({ tokens: lastFinished.tokens, model }) : false,
        })
      ) {
        await SessionCompaction.create({
          sessionID,
          agent: lastUser.agent,
          model: lastUser.model,
          auto: true,
          triggerReason: "provider_usage",
        })
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
      const tokenBudget = await SessionCompaction.budget(model)
      const currentUserParts = lastUserParts ?? []
      const syntheticContinuation =
        currentUserParts.length > 0 &&
        currentUserParts.every((part) => (part as { synthetic?: boolean }).synthetic === true)
      if (tokenBudget && !syntheticContinuation) {
        const estimatedTokens = estimateRequestTokens({ system, messages: requestMessages })
        if (estimatedTokens >= tokenBudget.usable) {
          log.info("prompt preflight scheduled compaction", {
            command: "session.prompt.preflight",
            status: "ok",
            sessionID,
            estimatedTokens,
            usableTokens: tokenBudget.usable,
            modelID: model.id,
            providerID: model.providerID,
          })
          await SessionCompaction.create({
            sessionID,
            agent: lastUser.agent,
            model: lastUser.model,
            auto: true,
            triggerReason: "prompt_preflight",
          })
          cachedMsgs = undefined
          continue
        }
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

      const publishAutonomousFailure = async (message: string) => {
        const error = new NamedError.Unknown({ message }).toObject()
        processor.message.error = error
        await Session.updateMessage(processor.message)
        Session.publishError({ sessionID, error })
      }

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
          await publishAutonomousFailure(emptyTurnDecision.message)
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
            await publishAutonomousFailure(gateRetryDecision.message)
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
            await publishAutonomousFailure(todoContinuation.message)
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
            await publishAutonomousFailure(todoContinuation.message)
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

        // Provider fallback: if the error is a provider API failure (rate limit,
        // no credit, auth error), try switching to another available provider
        // instead of retrying the same broken one.
        const err = processor.message.error
        const fallbackLookup = providerFallbackLookupDecision({
          consecutiveErrors,
          error: err,
        })
        if (fallbackLookup.action === "lookup") {
          const fallback = await findFallbackModel(lastUser.model.providerID).catch(() => null)
          if (fallback) {
            const fallbackSwitch = providerFallbackSwitchState({
              current: lastUser.model,
              fallback,
              errorMessage: fallbackLookup.errorMessage,
              consecutiveErrors,
            })
            log.warn("switching to fallback provider", {
              command: "session.prompt.loop",
              from: fallbackSwitch.from,
              to: fallbackSwitch.to,
              reason: fallbackSwitch.reason,
            })
            Session.publishError({
              sessionID,
              message: fallbackSwitch.message,
            })
            fallbackModelOverride = fallback
            cachedModel = undefined
            consecutiveErrors = fallbackSwitch.nextConsecutiveErrors
            continue
          }
        }

        log.warn("consecutive error", {
          command: "session.prompt.loop",
          status: "error",
          errorCode: "CONSECUTIVE_ERROR",
          consecutiveErrors,
          step,
          sessionID,
          error: processor.message.error,
        })
        const errorDecision = consecutiveErrorDecision({
          consecutiveErrors,
          maxConsecutiveErrors: MAX_CONSECUTIVE_ERRORS,
          step,
        })
        if (errorDecision.action === "stop") {
          log.warn("too many consecutive errors, stopping", {
            command: "session.prompt.loop",
            status: "error",
            errorCode: "MAX_CONSECUTIVE_ERRORS",
            consecutiveErrors,
            sessionID,
          })
          Session.publishError({
            sessionID,
            message: errorDecision.message,
          })
          reason = errorDecision.reason
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
      const queued = state()[sessionID]?.callbacks ?? []
      if (queued.length > 0) {
        queued.shift()!.resolve(item)
      }
      return item
    }
    if (abort.aborted) throw new DOMException("Aborted", "AbortError")
    throw new Error("Impossible")
  })

  async function createAutonomousUserContinuation(args: {
    sessionID: SessionID
    messages: readonly MessageV2.WithParts[]
    parts: PromptInput["parts"]
  }) {
    const lastUserInfo = getLastUserInfo(args.messages)
    await createUserMessage({
      sessionID: args.sessionID,
      agentRouting: "preserve",
      parts: args.parts,
      agent: lastUserInfo?.agent,
      model: lastUserInfo?.model,
    })
  }

  async function createUserMessage(input: PromptInput) {
    const messageID = input.messageID ?? MessageID.ascending()
    let agentName = input.agent || (await Agent.defaultAgent())
    const messageText = input.parts
      .filter((p): p is typeof p & { type: "text" } => p.type === "text")
      .map((p) => p.text)
      .join(" ")

    const route = await resolveUserMessageRouting({
      sessionID: input.sessionID,
      messageID,
      agentName,
      messageText,
      parts: input.parts,
      agentRouting: input.agentRouting,
      requestedModel: input.model,
    })
    agentName = route.agentName
    const agent = route.agent
    const complexityModel = route.complexityModel

    const model = complexityModel ?? input.model ?? agent.model ?? (await lastModel(input.sessionID))
    const variant = input.variant ?? (!input.model && !complexityModel && agent.variant ? agent.variant : undefined)

    const info: MessageV2.User = {
      id: messageID,
      role: "user",
      sessionID: input.sessionID,
      time: {
        created: Date.now(),
      },
      tools: input.tools,
      agent: agent.name,
      model,
      system: input.system,
      format: input.format,
      variant,
    }
    using _ = defer(() => InstructionPrompt.clear(info.id))

    const parts = await resolveUserMessageParts({
      sessionID: input.sessionID,
      messageID: info.id,
      agentName,
      agentPermission: agent.permission,
      parts: input.parts,
    })

    await Plugin.trigger(
      "chat.message",
      {
        sessionID: input.sessionID,
        agent: input.agent,
        model: input.model,
        messageID: input.messageID,
        variant: input.variant,
      },
      {
        message: info,
        parts,
      },
    )

    validateUserMessageForSave({ sessionID: input.sessionID, info, parts })
    await Session.updateMessageWithParts(info, parts)

    return {
      info,
      parts,
    }
  }

  export const ShellInput = z.object({
    sessionID: SessionID.zod,
    agent: z.string(),
    model: z
      .object({
        providerID: ProviderID.zod,
        modelID: ModelID.zod,
      })
      .optional(),
    command: z.string(),
  })
  export type ShellInput = z.infer<typeof ShellInput>
  export async function shell(input: ShellInput) {
    const abort = start(input.sessionID)
    if (!abort) {
      throw new Session.BusyError(input.sessionID)
    }

    using _ = defer(() => {
      // If no queued callbacks, cancel (the default)
      const callbacks = state()[input.sessionID]?.callbacks ?? []
      if (callbacks.length === 0) {
        cancel(input.sessionID)
      } else {
        // Otherwise, trigger the session loop to process queued items
        loop({ sessionID: input.sessionID, resume_existing: true }).catch((error) => {
          log.error("session loop failed to resume after shell command", {
            command: "session.prompt.shell",
            status: "error",
            sessionID: input.sessionID,
            error,
          })
        })
      }
    })

    if (abort.aborted) return
    const session = await Session.get(input.sessionID)
    if (session.revert) {
      await SessionRevert.cleanup(session)
    }
    const agent = await agentInfo({ sessionID: input.sessionID, name: input.agent })
    const model = input.model ?? agent.model ?? (await lastModel(input.sessionID))
    const { msg, part } = await createShellTurnMessages({
      sessionID: input.sessionID,
      agent: input.agent,
      model,
      command: input.command,
    })
    const shell = Shell.preferred()
    const args = shellArgs(shell, input.command)

    const cwd = Instance.directory
    const shellEnv = await Plugin.trigger(
      "shell.env",
      { cwd, sessionID: input.sessionID, callID: part.callID },
      { env: {} },
    )
    // Strip secrets (provider keys, tokens, passwords) before forwarding
    // the environment to the session shell. Without this, an LLM-invoked
    // command like `env | curl …` or `echo $OPENAI_API_KEY` would
    // exfiltrate the parent process credentials. See Env.sanitize.
    const proc = spawn(shell, args, {
      cwd,
      detached: process.platform !== "win32",
      windowsHide: process.platform === "win32",
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...Env.sanitize({
          ...process.env,
          ...shellEnv.env,
        }),
        TERM: "dumb",
      },
    })

    const OUTPUT_HARD_CAP = 10 * 1024 * 1024
    let shellOutput = {
      output: "",
      outputBytes: 0,
      outputTruncated: false,
    }
    let flushDirty = false
    let flushRunning = false
    let pending = Promise.resolve()

    const appendOutput = (chunk: Buffer | string) => {
      shellOutput = appendShellOutputChunk(shellOutput, chunk, OUTPUT_HARD_CAP)
    }

    const drainFlush = async () => {
      while (flushDirty) {
        flushDirty = false
        if (part.state.status !== "running") break
        part.state.metadata = shellOutputMetadata(shellOutput)
        await Session.updatePart(part).catch((e) =>
          log.warn("shell metadata write failed", {
            command: "session.prompt.shell",
            status: "error",
            errorCode: "METADATA_WRITE",
            error: e,
          }),
        )
      }
      flushRunning = false
    }

    const flush = () => {
      if (part.state.status !== "running") return
      flushDirty = true
      if (flushRunning) return
      flushRunning = true
      pending = drainFlush()
    }

    const onStdoutData = (chunk: Buffer | string) => {
      appendOutput(chunk)
      flush()
    }
    const onStderrData = (chunk: Buffer | string) => {
      appendOutput(chunk)
      flush()
    }
    proc.stdout?.on("data", onStdoutData)
    proc.stdout?.on("error", (error) => {
      log.warn("shell stdout stream error", {
        command: "session.prompt.shell",
        status: "error",
        errorCode: "STDOUT_STREAM_ERROR",
        error,
      })
    })

    proc.stderr?.on("data", onStderrData)
    proc.stderr?.on("error", (error) => {
      log.warn("shell stderr stream error", {
        command: "session.prompt.shell",
        status: "error",
        errorCode: "STDERR_STREAM_ERROR",
        error,
      })
    })

    let aborted = false
    let exited = false
    let exitCode = 0

    const kill = () => Shell.killTree(proc, { exited: () => exited })

    if (abort.aborted) {
      aborted = true
      await kill()
    }

    const abortHandler = () => {
      aborted = true
      void kill().catch((error) => {
        log.warn("shell abort kill failed", {
          command: "session.prompt.shell",
          status: "error",
          errorCode: "SHELL_ABORT_KILL_FAILED",
          shell,
          args,
          error,
        })
      })
    }

    abort.addEventListener("abort", abortHandler, { once: true })

    // Default shell timeout to prevent hung commands from blocking forever
    const SHELL_TIMEOUT = 300_000 // 5 minutes
    const shellTimer = setTimeout(() => {
      if (!exited) {
        log.warn("shell command timed out", {
          command: "session.prompt.shell",
          status: "error",
          errorCode: "SHELL_TIMEOUT",
          shell,
          args,
        })
        void kill().catch((error) => {
          log.warn("shell timeout kill failed", {
            command: "session.prompt.shell",
            status: "error",
            errorCode: "SHELL_TIMEOUT_KILL_FAILED",
            shell,
            args,
            error,
          })
        })
      }
    }, SHELL_TIMEOUT)
    let abortTimer: ReturnType<typeof setTimeout> | undefined

    await new Promise<void>((resolve, reject) => {
      const abortTimeoutHandler = () => {
        abortTimer = setTimeout(() => {
          if (!exited) reject(new Error("Shell abort timed out while waiting for process to exit"))
        }, 5_000)
      }
      if (abort.aborted) {
        abortTimeoutHandler()
      }
      proc.once("close", (code) => {
        exited = true
        exitCode = code ?? 0
        clearTimeout(shellTimer)
        if (abortTimer) clearTimeout(abortTimer)
        abort.removeEventListener("abort", abortHandler)
        abort.removeEventListener("abort", abortTimeoutHandler)
        proc.stdout?.off("data", onStdoutData)
        proc.stderr?.off("data", onStderrData)
        resolve()
      })
      proc.once("error", (err) => {
        exited = true
        clearTimeout(shellTimer)
        if (abortTimer) clearTimeout(abortTimer)
        abort.removeEventListener("abort", abortHandler)
        abort.removeEventListener("abort", abortTimeoutHandler)
        proc.stdout?.off("data", onStdoutData)
        proc.stderr?.off("data", onStderrData)
        reject(err)
      })
      abort.addEventListener("abort", abortTimeoutHandler, { once: true })
    })

    if (aborted) {
      shellOutput = {
        ...shellOutput,
        output: shellOutput.output + "\n\n" + ["<metadata>", "User aborted the command", "</metadata>"].join("\n"),
      }
    }
    await pending
    msg.time.completed = Date.now()
    await Session.updateMessage(msg)
    if (part.state.status === "running") {
      part.state =
        exitCode !== 0 && !aborted
          ? {
              status: "error",
              time: {
                ...part.state.time,
                end: Date.now(),
              },
              input: part.state.input,
              error: `Process exited with code ${exitCode}`,
              metadata: shellOutputMetadata(shellOutput),
            }
          : {
              status: "completed",
              time: {
                ...part.state.time,
                end: Date.now(),
              },
              input: part.state.input,
              title: "",
              metadata: shellOutputMetadata(shellOutput),
              output: shellOutput.output,
            }
      await Session.updatePart(part)
    }
    return { info: msg, parts: [part] }
  }

  export const CommandInput = z.object({
    messageID: MessageID.zod.optional(),
    sessionID: SessionID.zod,
    agent: z.string().optional(),
    model: z.string().optional(),
    arguments: z.string(),
    command: z.string(),
    variant: z.string().optional(),
    parts: z.array(FilePartInput).optional(),
  })
  export type CommandInput = z.infer<typeof CommandInput>

  async function goalControlMessage(input: CommandInput, text: string) {
    const model = await commandModel({ model: input.model, sessionID: input.sessionID })
    const user = await createUserMessage({
      sessionID: input.sessionID,
      messageID: input.messageID,
      agent: input.agent,
      model,
      agentRouting: "preserve",
      noReply: true,
      parts: [
        {
          type: "text",
          text: `/goal ${input.arguments}`.trim(),
        },
      ],
    })
    return createStoppedAssistantTextResponse({
      sessionID: input.sessionID,
      parent: user.info,
      text,
      tokenTotal: 0,
    })
  }

  async function goalCommand(input: CommandInput) {
    const parsed = parseGoalArguments(input.arguments)
    if (parsed.action === "view") {
      return goalControlMessage(input, SessionGoal.format(await SessionGoal.get(input.sessionID)))
    }
    if (parsed.action === "pause") {
      return goalControlMessage(input, SessionGoal.format(await SessionGoal.pause(input.sessionID)))
    }
    if (parsed.action === "resume") {
      return goalControlMessage(input, SessionGoal.format(await SessionGoal.resume(input.sessionID)))
    }
    if (parsed.action === "clear") {
      await SessionGoal.clear(input.sessionID)
      return goalControlMessage(input, "Goal cleared for this session.")
    }

    if (parsed.action !== "create") {
      throw new Error(`Unhandled goal action: ${parsed.action}`)
    }

    const goal = await SessionGoal.create({
      sessionID: input.sessionID,
      objective: parsed.objective,
      tokenBudget: parsed.tokenBudget,
      replace: false,
    })
    return prompt({
      sessionID: input.sessionID,
      messageID: input.messageID,
      agent: input.agent,
      model: await commandModel({ model: input.model, sessionID: input.sessionID }),
      variant: input.variant,
      parts: [
        {
          type: "text",
          text:
            `Goal set: ${goal.objective}\n\n` +
            `Work toward this goal until it is complete, blocked, paused, cleared, or budget-limited. ` +
            `Use get_goal to inspect current goal state and update_goal when the goal is complete or genuinely blocked.`,
        },
        ...(input.parts ?? []),
      ],
    })
  }

  export async function command(input: CommandInput) {
    log.info("command", {
      command: "session.prompt.command",
      status: "started",
      sessionID: input.sessionID,
      commandName: input.command,
    })
    if (input.command === Command.Default.GOAL) {
      return goalCommand(input)
    }
    const command = await resolveCommandForExecution({ sessionID: input.sessionID, name: input.command })
    const prepared = await commandSetup({
      command,
      name: input.command,
      arguments: input.arguments,
      sessionID: input.sessionID,
      agent: input.agent,
      model: input.model,
      parts: input.parts,
    })

    await Plugin.trigger(
      "command.execute.before",
      {
        command: input.command,
        sessionID: input.sessionID,
        arguments: input.arguments,
      },
      { parts: prepared.parts },
    )

    const result = (await prompt({
      sessionID: input.sessionID,
      messageID: input.messageID,
      model: prepared.user.model,
      agent: prepared.user.agent,
      parts: prepared.parts,
      variant: input.variant,
    })) as MessageV2.WithParts

    Bus.publishDetached(Command.Event.Executed, {
      name: input.command,
      sessionID: input.sessionID,
      arguments: input.arguments,
      messageID: result.info.id,
    })

    return result
  }
}
