import path from "path"
import os from "os"
import fs from "fs/promises"
import z from "zod"
import { Filesystem } from "../util/filesystem"
import { Env } from "../util/env"
import { SessionID, MessageID, PartID } from "./schema"
import { MessageV2 } from "./message-v2"
import { Log } from "../util/log"
import { SessionRevert } from "./revert"
import { Session } from "."
import { Agent } from "../agent/agent"
import { Provider } from "../provider/provider"
import { ModelID, ProviderID } from "../provider/schema"
import { type Tool as AITool, tool, jsonSchema, type ToolCallOptions, asSchema } from "ai"
import { SessionCompaction } from "./compaction"
import {
  MAX_CONSECUTIVE_ERRORS as _MAX_CONSECUTIVE_ERRORS,
  GLOBAL_STEP_LIMIT as _GLOBAL_STEP_LIMIT,
} from "@/constants/session"
import { AgentControlEvents } from "../control-plane/agent-control-events"
import { AutonomousCompletionGate } from "../control-plane/autonomous-completion-gate"
import { Instance } from "../project/instance"
import { Bus } from "../bus"
import { ProviderTransform } from "../provider/transform"
import { SystemPrompt } from "./system"
import { InstructionPrompt } from "./instruction"
import { Plugin } from "../plugin"
import PROMPT_PLAN from "../session/prompt/plan.txt"
import BUILD_SWITCH from "../session/prompt/build-switch.txt"
import MAX_STEPS from "../session/prompt/max-steps.txt"
import { defer } from "../util/defer"
import { ToolRegistry } from "../tool/registry"
import { MCP } from "../mcp"
import { route as routeAgent, classifyComplexity } from "../agent/router"
import { TuiEvent } from "../cli/cmd/tui/event"
import { LSP } from "../lsp"
import { ReadTool } from "../tool/read"
import { FileTime } from "../file/time"
import { NotFoundError } from "@/storage/db"
import { Flag } from "../flag/flag"
import { Recorder } from "../replay/recorder"
import { BlastRadius } from "./blast-radius"
import { CodeIntelligence } from "../code-intelligence"
import { AutoIndex } from "../code-intelligence/auto-index"
import type { ProjectID } from "../project/schema"
import { Todo } from "./todo"
import { ulid } from "ulid"
import { spawn } from "child_process"
import { Command } from "../command"
import { pathToFileURL, fileURLToPath } from "url"
import { Config } from "@/config/config"
import { Isolation } from "@/isolation"
import { SessionSummary } from "./summary"
import { NamedError } from "@ax-code/util/error"
import { fn } from "@/util/fn"
import { SessionProcessor } from "./processor"
import { TaskTool } from "@/tool/task"
import { Tool } from "@/tool/tool"
import { Permission } from "@/permission"
import { SessionStatus } from "./status"
import { LLM } from "./llm"
import { iife } from "@/util/iife"
import { Shell } from "@/shell/shell"
import { Truncate } from "@/tool/truncate"
import { decodeDataUrl } from "@/util/data-url"
import {
  commandSetup,
  shellArgs,
  agentInfo,
  remindQueuedMessages,
  resolvePromptParts as _resolvePromptParts,
  scanLoopMessages,
  loopMessages,
  modelInfo,
  systemPrompt as getSystemPrompt,
  createStructuredOutputTool as _createStructuredOutputTool,
  lastModel as _lastModel,
  findFallbackModel,
  ensureTitle as _ensureTitle,
} from "./prompt-helpers"

// @ts-ignore
globalThis.AI_SDK_LOG_WARNINGS = false

const MAX_STAGNANT_TODO_RETRIES = 2

function pendingTodoSignature(todos: { content: string; status: string; priority: string }[]) {
  return todos.map((todo) => `${todo.status}\u0000${todo.priority}\u0000${todo.content}`).join("\u0001")
}

const STRUCTURED_OUTPUT_DESCRIPTION = `Use this tool to return your final response in the requested structured format.

IMPORTANT:
- You MUST call this tool exactly once at the end of your response
- The input must be valid JSON matching the required schema
- Complete all necessary research and tool calls BEFORE calling this tool
- This tool provides your final answer - no further actions are taken after calling it`

const STRUCTURED_OUTPUT_SYSTEM_PROMPT = `IMPORTANT: The user has requested structured output. You MUST use the StructuredOutput tool to provide your final response. Do NOT respond with plain text - you MUST call the StructuredOutput tool with your answer formatted according to the schema.`

export namespace SessionPrompt {
  const log = Log.create({ service: "session.prompt" })

  async function documentSymbolsForRangeExpansion(
    uri: string,
  ): Promise<Awaited<ReturnType<typeof LSP.documentSymbolEnvelope>>["data"]> {
    return (
      (
        (await LSP.documentSymbolCachedEnvelope(uri).catch(() => undefined)) ??
        (await LSP.documentSymbolEnvelope(uri, { cache: true }).catch(() => undefined))
      )?.data ?? []
    )
  }

  const state = Instance.state(
    () => {
      const data: Record<
        string,
        {
          abort: AbortController
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

  interface SubtaskContext {
    sessionID: SessionID
    lastUser: MessageV2.User
    model: Provider.Model
    abort: AbortSignal
    msgs: MessageV2.WithParts[]
    session: Awaited<ReturnType<typeof Session.get>>
  }

  async function executeSubtask(task: MessageV2.SubtaskPart, ctx: SubtaskContext) {
    const { sessionID, lastUser, abort, msgs, session } = ctx
    const now = Date.now()
    await SessionStatus.set(sessionID, {
      type: "busy",
      startedAt: now,
      lastActivityAt: now,
      waitState: "llm",
    })
    const taskTool = await TaskTool.init()
    const taskModel = task.model ? await Provider.getModel(task.model.providerID, task.model.modelID) : ctx.model
    const assistantMessage = (await Session.updateMessage({
      id: MessageID.ascending(),
      role: "assistant",
      parentID: lastUser.id,
      sessionID,
      mode: task.agent,
      agent: task.agent,
      variant: lastUser.variant,
      path: {
        cwd: Instance.directory,
        root: Instance.worktree,
      },
      tokens: {
        input: 0,
        output: 0,
        reasoning: 0,
        cache: { read: 0, write: 0 },
      },
      modelID: taskModel.id,
      providerID: taskModel.providerID,
      time: {
        created: Date.now(),
      },
    })) as MessageV2.Assistant
    const taskArgs = {
      prompt: task.prompt,
      description: task.description,
      subagent_type: task.agent,
      command: task.command,
    }
    let part = (await Session.updatePart({
      id: PartID.ascending(),
      messageID: assistantMessage.id,
      sessionID: assistantMessage.sessionID,
      type: "tool",
      callID: ulid(),
      tool: TaskTool.id,
      state: {
        status: "running",
        input: taskArgs,
        time: {
          start: Date.now(),
        },
      },
    })) as MessageV2.ToolPart
    await Plugin.trigger(
      "tool.execute.before",
      {
        tool: "task",
        sessionID,
        callID: part.id,
      },
      { args: taskArgs },
    )
    let executionError: Error | undefined
    const taskAgent = await agentInfo({ sessionID, name: task.agent })
    const taskCtx: Tool.Context = {
      agent: task.agent,
      messageID: assistantMessage.id,
      sessionID,
      abort,
      callID: part.callID,
      extra: { bypassAgentCheck: true },
      messages: msgs,
      async metadata(input) {
        part = (await Session.updatePart({
          ...part,
          type: "tool",
          state: {
            ...part.state,
            ...input,
          },
        } satisfies MessageV2.ToolPart)) as MessageV2.ToolPart
      },
      async ask(req) {
        await Permission.ask({
          ...req,
          sessionID,
          ruleset: Permission.merge(taskAgent.permission, session.permission ?? []),
        })
      },
    }
    const result = await taskTool.execute(taskArgs, taskCtx).catch((error) => {
      executionError = error
      log.error("subtask execution failed", {
        command: "session.prompt.subtask",
        status: "error",
        error,
        agent: task.agent,
        description: task.description,
        sessionID,
      })
      return undefined
    })
    const attachments = result?.attachments?.map((attachment) => ({
      ...attachment,
      id: PartID.ascending(),
      sessionID,
      messageID: assistantMessage.id,
    }))
    await Plugin.trigger(
      "tool.execute.after",
      {
        tool: "task",
        sessionID,
        callID: part.id,
        args: taskArgs,
      },
      result,
    )
    assistantMessage.finish = "tool-calls"
    assistantMessage.time.completed = Date.now()
    await Session.updateMessage(assistantMessage)
    if (result && part.state.status === "running") {
      await Session.updatePart({
        ...part,
        state: {
          status: "completed",
          input: part.state.input,
          title: result.title,
          metadata: result.metadata,
          output: result.output,
          attachments,
          time: {
            ...part.state.time,
            end: Date.now(),
          },
        },
      } satisfies MessageV2.ToolPart)
    }
    if (!result) {
      await Session.updatePart({
        ...part,
        state: {
          status: "error",
          error: executionError ? `Tool execution failed: ${executionError.message}` : "Tool execution failed",
          time: {
            start: part.state.status === "running" ? part.state.time.start : Date.now(),
            end: Date.now(),
          },
          metadata: "metadata" in part.state ? part.state.metadata : undefined,
          input: part.state.input,
        },
      } satisfies MessageV2.ToolPart)
    }

    if (task.command) {
      const summaryUserMsg: MessageV2.User = {
        id: MessageID.ascending(),
        sessionID,
        role: "user",
        time: {
          created: Date.now(),
        },
        agent: lastUser.agent,
        model: lastUser.model,
      }
      await Session.updateMessage(summaryUserMsg)
      await Session.updatePart({
        id: PartID.ascending(),
        messageID: summaryUserMsg.id,
        sessionID,
        type: "text",
        text: "Summarize the task tool output above and continue with your task.",
        synthetic: true,
      } satisfies MessageV2.TextPart)
    }
  }

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
    parts: z.array(
      z.discriminatedUnion("type", [
        MessageV2.TextPart.omit({
          messageID: true,
          sessionID: true,
        })
          .partial({
            id: true,
          })
          .meta({
            ref: "TextPartInput",
          }),
        MessageV2.FilePart.omit({
          messageID: true,
          sessionID: true,
        })
          .partial({
            id: true,
          })
          .meta({
            ref: "FilePartInput",
          }),
        MessageV2.AgentPart.omit({
          messageID: true,
          sessionID: true,
        })
          .partial({
            id: true,
          })
          .meta({
            ref: "AgentPartInput",
          }),
        MessageV2.SubtaskPart.omit({
          messageID: true,
          sessionID: true,
        })
          .partial({
            id: true,
          })
          .meta({
            ref: "SubtaskPartInput",
          }),
      ]),
    ),
  })
  export type PromptInput = z.infer<typeof PromptInput>

  export const prompt = fn(PromptInput, async (input) => {
    const session = await Session.get(input.sessionID)
    await SessionRevert.cleanup(session)

    const message = await createUserMessage(input)
    await Session.touch(input.sessionID)

    // this is backwards compatibility for allowing `tools` to be specified when
    // prompting
    const permissions: Permission.Ruleset = []
    for (const [tool, enabled] of Object.entries(input.tools ?? {})) {
      permissions.push({
        permission: tool,
        action: enabled ? "allow" : "deny",
        pattern: "*",
      })
    }
    if (permissions.length > 0) {
      session.permission = permissions
      await Session.setPermission({ sessionID: session.id, permission: permissions })
    }

    if (input.noReply === true) {
      return message
    }

    return loop({ sessionID: input.sessionID })
  })

  export const resolvePromptParts = _resolvePromptParts

  function start(sessionID: SessionID) {
    const s = state()
    if (s[sessionID]) return
    const controller = new AbortController()
    s[sessionID] = {
      abort: controller,
      callbacks: [],
    }
    return controller.signal
  }

  function resume(sessionID: SessionID) {
    const s = state()
    if (!s[sessionID]) return

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
    for (const cb of match.callbacks) {
      cb.reject(new Error("Session ended"))
    }
    match.callbacks.length = 0
    match.abort.abort()
    delete s[sessionID]
    await SessionStatus.set(sessionID, { type: "idle" })
    return
  }

  export const LoopInput = z.object({
    sessionID: SessionID.zod,
    resume_existing: z.boolean().optional(),
  })
  export const loop = fn(LoopInput, async (input) => {
    const { sessionID, resume_existing } = input

    const abort = resume_existing ? (resume(sessionID) ?? start(sessionID)) : start(sessionID)
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
      if (sessionStarted) {
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
    const MAX_CONSECUTIVE_ERRORS = _MAX_CONSECUTIVE_ERRORS
    const session = await Session.get(sessionID)
    // Pre-load expensive resources once before the loop
    const cfg = await Config.get()
    const GLOBAL_STEP_LIMIT = cfg.session?.max_steps ?? _GLOBAL_STEP_LIMIT
    const autonomous = process.env["AX_CODE_AUTONOMOUS"] === "true"
    const maxContinuations = cfg.session?.max_continuations ?? 3
    const maxTodoRetries = cfg.session?.max_todo_retries ?? 10
    const maxCompletionGateRetries = Math.min(maxTodoRetries, 2)
    let todoRetries = 0
    let completionGateRetries = 0
    let lastCompletionGateSignature: string | undefined
    let lastPendingTodoSignature: string | undefined
    let stagnantTodoRetries = 0
    const cachedSystemPrompt: import("./prompt-helpers").SystemCache = {
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
        maxSteps: GLOBAL_STEP_LIMIT,
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
      if (step >= GLOBAL_STEP_LIMIT) {
        // In autonomous mode, auto-continue by injecting a synthetic
        // continuation message so the model picks up where it left off.
        // Capped by maxContinuations to prevent truly infinite runs.
        if (autonomous && continuations < maxContinuations) {
          continuations++
          step = 0
          consecutiveErrors = 0
          cachedMsgs = undefined
          cachedAgent = undefined
          cachedModel = undefined
          log.info("autonomous auto-continue", {
            command: "session.prompt.loop",
            status: "ok",
            sessionID,
            continuation: continuations,
            maxContinuations,
          })
          const lastMsgs = await Session.messages({ sessionID })
          const lastUserInfo = lastMsgs.filter((m) => m.info.role === "user").pop()?.info as MessageV2.User | undefined
          await createUserMessage({
            sessionID,
            agentRouting: "preserve",
            parts: [
              {
                type: "text",
                text: `Continue from where you left off. You have used ${GLOBAL_STEP_LIMIT} steps. This is auto-continuation ${continuations}/${maxContinuations}. Prioritize completing the most important remaining work. Avoid over-engineering: prefer the simplest common-practice change that solves the task, avoid new abstractions unless there are 3+ concrete use cases, and verify before expanding scope.`,
              },
            ],
            agent: lastUserInfo?.agent,
            model: lastUserInfo?.model,
          })
          continue
        }
        log.warn("global step limit reached", {
          command: "session.prompt.loop",
          status: "error",
          errorCode: "STEP_LIMIT",
          step,
          sessionID,
          continuations,
        })
        Bus.publishDetached(Session.Event.Error, {
          sessionID,
          error: new NamedError.Unknown({
            message:
              `Agent reached maximum step limit (${GLOBAL_STEP_LIMIT} steps${continuations > 0 ? ` after ${continuations} auto-continuations` : ""}). ` +
              `To increase, set "session.max_steps" in ax-code.json. ` +
              `Try breaking the task into smaller parts or increase the limit for complex autonomous tasks.`,
          }).toObject(),
        })
        reason = "step_limit"
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
      if (
        lastAssistant?.finish &&
        !["tool-calls", "unknown"].includes(lastAssistant.finish) &&
        lastUser.id < lastAssistant.id
      ) {
        log.info("exiting loop", { command: "session.prompt.loop", status: "ok", sessionID })
        reason = "completed"
        break
      }
      // Stop on "unknown" finish with no tool calls to prevent infinite empty-response loop
      if (
        lastAssistant?.finish === "unknown" &&
        !tasks.some((t) => t.type === "subtask") &&
        lastUser.id < lastAssistant.id
      ) {
        log.warn("model returned unknown finish with no actionable output", {
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
        Recorder.emit({
          type: "session.start",
          sessionID,
          agent: lastUser.agent,
          model: `${lastUser.model.providerID}/${lastUser.model.modelID}`,
          directory: Instance.directory,
        })
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
        if (Flag.AX_CODE_EXPERIMENTAL_CODE_INTELLIGENCE) {
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
        if (result === "stop") {
          reason = task.overflow ? "error" : "completed"
          break
        }
        cachedMsgs = undefined // invalidate cache after compaction
        continue
      }

      // context overflow, needs compaction
      if (
        lastFinished &&
        lastFinished.summary !== true &&
        (await SessionCompaction.isOverflow({ tokens: lastFinished.tokens, model }))
      ) {
        await SessionCompaction.create({
          sessionID,
          agent: lastUser.agent,
          model: lastUser.model,
          auto: true,
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
      const isLastStep = step >= maxSteps
      msgs = await insertReminders({
        messages: msgs,
        agent,
        session,
      })

      const processor = SessionProcessor.create({
        assistantMessage: (await Session.updateMessage({
          id: MessageID.ascending(),
          parentID: lastUser.id,
          role: "assistant",
          mode: agent.name,
          agent: agent.name,
          variant: lastUser.variant,
          path: {
            cwd: Instance.directory,
            root: Instance.worktree,
          },
          tokens: {
            input: 0,
            output: 0,
            reasoning: 0,
            cache: { read: 0, write: 0 },
          },
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

      const result = await processor.process({
        user: lastUser,
        agent,
        permission: session.permission,
        abort,
        sessionID,
        system,
        messages: [
          ...modelMessages,
          ...(isLastStep
            ? [
                {
                  role: "assistant" as const,
                  content: MAX_STEPS,
                },
              ]
            : []),
        ],
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

      // Check if model finished (finish reason is not "tool-calls" or "unknown")
      const modelFinished = processor.message.finish && !["tool-calls", "unknown"].includes(processor.message.finish)

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

      const markAssistantIncomplete = async (message: string) => {
        processor.message.error = new NamedError.Unknown({ message }).toObject()
        await Session.updateMessage(processor.message)
      }

      // In autonomous mode, when the model ends a turn cleanly but leaves todos
      // pending, inject a continuation user message and keep the loop running.
      // This is the runtime guarantee — complements the system-prompt reminder
      // injected per turn. Capped by maxTodoRetries to prevent infinite loops when
      // the model genuinely cannot finish a todo (blocked tool, missing data, etc.).
      if (autonomous && !processor.message.error) {
        const latestMessages = await Session.messages({ sessionID })
        const pendingTodos = Todo.get(sessionID).filter(
          (t) => t.status === "pending" || t.status === "in_progress",
        )
        const completionGate = AutonomousCompletionGate.evaluate({
          messages: latestMessages,
          pendingTodos,
        })
        const shouldRecoverEmptySubagentResult =
          completionGate.status === "blocked" && completionGate.reason === "empty_subagent_result"

        if (modelFinished || shouldRecoverEmptySubagentResult) {
          Recorder.emit(
            AgentControlEvents.completionGateDecided({
              sessionID,
              messageID: processor.message.id,
              stepIndex: step,
              status: completionGate.status,
              reason: completionGate.status === "allow" ? "none" : completionGate.reason,
              message: completionGate.status === "allow" ? "Completion gate passed." : completionGate.message,
              retryCount: completionGateRetries,
              maxRetries: maxCompletionGateRetries,
            }),
          )
        }

        if (shouldRecoverEmptySubagentResult) {
          if (completionGate.signature !== lastCompletionGateSignature) {
            lastCompletionGateSignature = completionGate.signature
            completionGateRetries = 0
          }

          if (isLastStep || completionGateRetries >= maxCompletionGateRetries) {
            const incompleteMessage =
              `Autonomous mode stopped because the control-plane completion gate found incomplete subagent evidence. ` +
              `${completionGate.message} ` +
              `The session is stopped, but the task should not be treated as complete.`
            log.warn("autonomous completion gate stopped session", {
              command: "session.prompt.loop",
              status: "stopped",
              errorCode: isLastStep ? "STEP_LIMIT" : "COMPLETION_GATE_BLOCKED",
              sessionID,
              reason: completionGate.reason,
              message: completionGate.message,
              attempts: completionGateRetries,
              maxAttempts: maxCompletionGateRetries,
            })
            await markAssistantIncomplete(incompleteMessage)
            Bus.publishDetached(Session.Event.Error, {
              sessionID,
              error: new NamedError.Unknown({
                message: incompleteMessage,
              }).toObject(),
            })
            reason = isLastStep ? "step_limit" : "stalled"
            break
          }

          completionGateRetries++
          log.info("autonomous completion gate continuation", {
            command: "session.prompt.loop",
            status: "ok",
            sessionID,
            reason: completionGate.reason,
            message: completionGate.message,
            attempt: completionGateRetries,
            maxAttempts: maxCompletionGateRetries,
          })
          const lastUserInfo = latestMessages.filter((m) => m.info.role === "user").pop()?.info as
            | MessageV2.User
            | undefined
          await createUserMessage({
            sessionID,
            agentRouting: "preserve",
            parts: [
              {
                type: "text",
                text:
                  `Control-plane completion gate blocked completion: ${completionGate.message}\n` +
                  `Retry the subagent task, resume the task_id if available, or explicitly explain why no usable result can be recovered. ` +
                  `Do not mark the work complete until the missing subagent evidence is resolved. ` +
                  `This is completion-gate auto-continuation ${completionGateRetries}/${maxCompletionGateRetries}.`,
              },
            ],
            agent: lastUserInfo?.agent,
            model: lastUserInfo?.model,
          })
          continue
        }

        if (completionGate.status === "allow") {
          completionGateRetries = 0
          lastCompletionGateSignature = undefined
        }

        if (modelFinished && pendingTodos.length > 0) {
          if (isLastStep) {
            const incompleteMessage =
              `Autonomous mode reached the agent step limit with ${pendingTodos.length} unfinished todo` +
              `${pendingTodos.length === 1 ? "" : "s"}. ` +
              `No further todo auto-continuation was scheduled because the maximum-step reminder may disable tools. ` +
              `Increase the agent/session step budget or resume the session to finish the remaining work.`
            log.warn("autonomous todo continuation stopped at agent step limit", {
              command: "session.prompt.loop",
              status: "stopped",
              errorCode: "STEP_LIMIT",
              sessionID,
              pendingCount: pendingTodos.length,
              attempts: todoRetries,
              maxAttempts: maxTodoRetries,
              maxSteps,
            })
            await markAssistantIncomplete(incompleteMessage)
            Bus.publishDetached(Session.Event.Error, {
              sessionID,
              error: new NamedError.Unknown({
                message: incompleteMessage,
              }).toObject(),
            })
            reason = "step_limit"
            break
          }

          if (todoRetries >= maxTodoRetries) {
            const incompleteMessage =
              `Autonomous mode stopped because ${pendingTodos.length} todo` +
              `${pendingTodos.length === 1 ? "" : "s"} remained unfinished after ${maxTodoRetries} ` +
              `auto-continuation attempt${maxTodoRetries === 1 ? "" : "s"}. ` +
              `The session is stopped, but the remaining todos are not complete.`
            log.warn("autonomous todo continuation stopped after retry budget", {
              command: "session.prompt.loop",
              status: "stopped",
              sessionID,
              pendingCount: pendingTodos.length,
              attempts: todoRetries,
              maxAttempts: maxTodoRetries,
            })
            await markAssistantIncomplete(incompleteMessage)
            Bus.publishDetached(Session.Event.Error, {
              sessionID,
              error: new NamedError.Unknown({
                message: incompleteMessage,
              }).toObject(),
            })
            reason = "stalled"
            break
          }

          const signature = pendingTodoSignature(pendingTodos)
          if (signature === lastPendingTodoSignature) {
            stagnantTodoRetries++
          } else {
            lastPendingTodoSignature = signature
            stagnantTodoRetries = 0
          }

          if (stagnantTodoRetries >= MAX_STAGNANT_TODO_RETRIES) {
            const incompleteMessage =
              `Autonomous mode stopped because ${pendingTodos.length} todo${pendingTodos.length === 1 ? "" : "s"} ` +
              `remained unchanged after ${stagnantTodoRetries} retry attempts. ` +
              `The session is stopped, but the remaining todos are not complete.`
            log.warn("autonomous todo continuation stopped on unchanged pending todos", {
              command: "session.prompt.loop",
              status: "stopped",
              sessionID,
              pendingCount: pendingTodos.length,
              attempts: todoRetries,
              stagnantAttempts: stagnantTodoRetries,
              maxStagnantAttempts: MAX_STAGNANT_TODO_RETRIES,
            })
            await markAssistantIncomplete(incompleteMessage)
            Bus.publishDetached(Session.Event.Error, {
              sessionID,
              error: new NamedError.Unknown({
                message: incompleteMessage,
              }).toObject(),
            })
            reason = "stalled"
            break
          }

          todoRetries++
          log.info("autonomous todo continuation", {
            command: "session.prompt.loop",
            status: "ok",
            sessionID,
            pendingCount: pendingTodos.length,
            attempt: todoRetries,
            maxAttempts: maxTodoRetries,
            stagnantAttempts: stagnantTodoRetries,
          })
          const lastUserInfo = latestMessages.filter((m) => m.info.role === "user").pop()?.info as
            | MessageV2.User
            | undefined
          await createUserMessage({
            sessionID,
            agentRouting: "preserve",
            parts: [
              {
                type: "text",
                text: `You stopped with ${pendingTodos.length} todo${pendingTodos.length === 1 ? "" : "s"} still pending:\n${pendingTodos.map((t) => `- [${t.status}] ${t.content}`).join("\n")}\nContinue working until all todos are completed or cancelled. This is auto-continuation ${todoRetries}/${maxTodoRetries}.`,
              },
            ],
            agent: lastUserInfo?.agent,
            model: lastUserInfo?.model,
          })
          continue
        }
      }

      if (result === "stop") {
        reason = processor.message.error ? "error" : "completed"
        break
      }

      // Track consecutive errors — break if agent is stuck
      if (processor.message.error) {
        consecutiveErrors++

        // Provider fallback: if the error is a provider API failure (rate limit,
        // no credit, auth error), try switching to another available provider
        // instead of retrying the same broken one.
        const err = processor.message.error
        if (
          consecutiveErrors >= 2 &&
          err.name === "APIError" &&
          err.data?.statusCode &&
          [401, 402, 403, 429].includes(err.data.statusCode)
        ) {
          const fallback = await findFallbackModel(lastUser.model.providerID, lastUser.model.modelID).catch(() => null)
          if (fallback) {
            log.warn("switching to fallback provider", {
              command: "session.prompt.loop",
              from: `${lastUser.model.providerID}/${lastUser.model.modelID}`,
              to: `${fallback.providerID}/${fallback.modelID}`,
              reason: err.data?.message,
            })
            Bus.publishDetached(Session.Event.Error, {
              sessionID,
              error: new NamedError.Unknown({
                message: `Provider ${lastUser.model.providerID} failed: ${err.data?.message ?? "unknown error"}. Switching to ${fallback.providerID}/${fallback.modelID}.`,
              }).toObject(),
            })
            fallbackModelOverride = fallback
            cachedModel = undefined
            consecutiveErrors = 0
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
        if (consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
          log.warn("too many consecutive errors, stopping", {
            command: "session.prompt.loop",
            status: "error",
            errorCode: "MAX_CONSECUTIVE_ERRORS",
            consecutiveErrors,
            sessionID,
          })
          Bus.publishDetached(Session.Event.Error, {
            sessionID,
            error: new NamedError.Unknown({
              message: `Agent encountered ${consecutiveErrors} consecutive errors at step ${step}. Stopping to prevent retry loop. Try rephrasing your request or breaking it into smaller tasks.`,
            }).toObject(),
          })
          reason = "error"
          break
        }
      } else {
        consecutiveErrors = 0 // Reset on success
      }

      if (result === "compact") {
        await SessionCompaction.create({
          sessionID,
          agent: lastUser.agent,
          model: lastUser.model,
          auto: true,
          overflow: !processor.message.finish,
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

  const lastModel = _lastModel
  let _schemaCache: Map<string, any> | undefined

  /** @internal Exported for testing */
  export async function resolveTools(input: {
    agent: Agent.Info
    model: Provider.Model
    session: Session.Info
    tools?: Record<string, boolean>
    processor: SessionProcessor.Info
    bypassAgentCheck: boolean
    messages: MessageV2.WithParts[]
    isolation?: Isolation.State
  }) {
    using _ = log.time("resolveTools")
    const tools: Record<string, AITool> = {}
    const isolation =
      input.isolation ?? Isolation.resolve((await Config.get()).isolation, Instance.directory, Instance.worktree)
    // Cache transformed schemas across steps — key: "toolId:npm"
    if (!_schemaCache) _schemaCache = new Map()
    const schemaCacheKey = (toolId: string) => `${toolId}:${input.model.api.npm}:${input.model.providerID}`

    const context = (args: any, options: ToolCallOptions, isolationOverride?: Isolation.State): Tool.Context => ({
      sessionID: input.session.id,
      abort: options.abortSignal!,
      messageID: input.processor.message.id,
      callID: options.toolCallId,
      extra: {
        model: input.model,
        bypassAgentCheck: input.bypassAgentCheck,
        isolation: isolationOverride ?? isolation,
      },
      agent: input.agent.name,
      messages: input.messages,
      metadata: async (val: { title?: string; metadata?: any }) => {
        const match = input.processor.partFromToolCall(options.toolCallId)
        if (match && match.state.status === "running") {
          await Session.updatePart({
            ...match,
            state: {
              title: val.title,
              metadata: val.metadata,
              status: "running",
              input: args,
              time: {
                start: match.state.time?.start ?? Date.now(),
              },
            },
          })
        }
      },
      async ask(req) {
        await Permission.ask({
          ...req,
          sessionID: input.session.id,
          tool: { messageID: input.processor.message.id, callID: options.toolCallId },
          ruleset: Permission.merge(input.agent.permission, input.session.permission ?? []),
          agent: input.agent.name,
        })
      },
    })

    for (const item of await ToolRegistry.tools(
      { modelID: ModelID.make(input.model.api.id), providerID: input.model.providerID },
      input.agent,
    )) {
      const cacheKey = schemaCacheKey(item.id)
      const cached = _schemaCache!.get(cacheKey)
      const schema =
        cached !== undefined
          ? // LRU: move to end so recently-used entries survive eviction
            (_schemaCache!.delete(cacheKey), _schemaCache!.set(cacheKey, cached), cached)
          : (() => {
              const s = ProviderTransform.schema(input.model, z.toJSONSchema(item.parameters))
              // Bound the cache to avoid a slow memory leak in long-running
              // processes (TUI/daemon) that accumulate tool×model entries
              // across session lifetimes. LRU eviction: when we reach the
              // cap, drop the 100 least-recently-used entries. Maps preserve
              // insertion order, so `.keys()` iterates oldest first.
              const SCHEMA_CACHE_MAX = 500
              if (_schemaCache!.size >= SCHEMA_CACHE_MAX) {
                const drop = 100
                let dropped = 0
                for (const key of _schemaCache!.keys()) {
                  _schemaCache!.delete(key)
                  if (++dropped >= drop) break
                }
              }
              _schemaCache!.set(cacheKey, s)
              return s
            })()
      tools[item.id] = tool({
        id: item.id as any,
        description: item.description,
        inputSchema: jsonSchema(schema as any),
        async execute(args, options) {
          const ctx = context(args, options)
          await Plugin.trigger(
            "tool.execute.before",
            {
              tool: item.id,
              sessionID: ctx.sessionID,
              callID: ctx.callID,
            },
            {
              args,
            },
          )
          let result: Awaited<ReturnType<typeof item.execute>> | undefined
          // Per-path bypass: when the user approves an isolation_escalation
          // for one path inside a multi-path tool call (e.g. apply_patch
          // with several hunks), we must NOT exempt every other path in
          // the same call. Accumulate approved paths and re-run the tool;
          // if a later path also fails, ask again. Cap retries to bound
          // the loop in the rare case the tool is non-deterministic about
          // which path it touches first.
          //
          // Unscoped denials (network — `assertNetwork` has no `e.path`)
          // fall back to the legacy ask-once + full-bypass semantics so
          // tools like webfetch can still be escalated.
          const bypass: string[] = []
          let unscopedBypass = false
          let lastError: Isolation.DeniedError | undefined
          for (let attempt = 0; attempt < 16; attempt++) {
            let attemptCtx = ctx
            if (attempt > 0) {
              if (unscopedBypass) {
                attemptCtx = context(args, options, {
                  mode: "full-access",
                  network: true,
                  protected: [],
                })
              } else if (ctx.extra?.isolation) {
                attemptCtx = context(args, options, { ...ctx.extra.isolation, bypass: [...bypass] })
              }
            }
            try {
              result = await item.execute(args, attemptCtx)
              break
            } catch (e) {
              if (!(e instanceof Isolation.DeniedError)) throw e
              if (ctx.extra?.isolation?.mode === "read-only")
                throw new Error(`Tool denied in read-only mode: ${e.reason}`)
              if (!e.path) {
                if (unscopedBypass) {
                  lastError = e
                  throw e
                }
                await ctx.ask({
                  permission: "isolation_escalation",
                  patterns: [e.message],
                  always: [],
                  metadata: { reason: e.reason, requireInteractive: true },
                })
                unscopedBypass = true
                lastError = e
                continue
              }
              if (bypass.includes(e.path)) {
                lastError = e
                throw e
              }
              await ctx.ask({
                permission: "isolation_escalation",
                patterns: [e.message],
                always: [],
                metadata: { reason: e.reason, path: e.path, requireInteractive: true },
              })
              bypass.push(e.path)
              lastError = e
            }
          }
          if (result === undefined) throw lastError ?? new Error("Tool execution exhausted isolation retries")
          const output = {
            ...result,
            attachments: result.attachments?.map((attachment) => ({
              ...attachment,
              id: PartID.ascending(),
              sessionID: ctx.sessionID,
              messageID: input.processor.message.id,
            })),
          }
          await Plugin.trigger(
            "tool.execute.after",
            {
              tool: item.id,
              sessionID: ctx.sessionID,
              callID: ctx.callID,
              args,
            },
            output,
          )
          return output
        },
      })
    }

    for (const [key, item] of Object.entries(await MCP.tools())) {
      const execute = item.execute
      if (!execute) continue

      // `MCP.tools()` returns references to cached tool objects; mutating
      // `item.inputSchema` directly would re-transform the schema on every
      // loop iteration, double-wrapping the JSON schema and eventually
      // producing malformed input for the LLM. Clone to a fresh object so
      // the transformation is idempotent across iterations.
      const mcpTool = { ...item }
      const mcpCacheKey = schemaCacheKey(`mcp:${key}`)
      let transformed = _schemaCache!.get(mcpCacheKey)
      if (transformed !== undefined) {
        // LRU: move to end
        _schemaCache!.delete(mcpCacheKey)
        _schemaCache!.set(mcpCacheKey, transformed)
      } else {
        transformed = ProviderTransform.schema(
          input.model,
          await Promise.resolve(asSchema(mcpTool.inputSchema).jsonSchema),
        )
        _schemaCache!.set(mcpCacheKey, transformed)
      }
      mcpTool.inputSchema = jsonSchema(transformed)
      // Wrap execute to add plugin hooks and format output
      mcpTool.execute = async (args, opts) => {
        const ctx = context(args, opts)

        await Plugin.trigger(
          "tool.execute.before",
          {
            tool: key,
            sessionID: ctx.sessionID,
            callID: opts.toolCallId,
          },
          {
            args,
          },
        )

        await ctx.ask({
          permission: key,
          metadata: {},
          patterns: ["*"],
          always: ["*"],
        })

        const result = await execute(args, opts)

        await Plugin.trigger(
          "tool.execute.after",
          {
            tool: key,
            sessionID: ctx.sessionID,
            callID: opts.toolCallId,
            args,
          },
          result,
        )

        const textParts: string[] = []
        const attachments: Omit<MessageV2.FilePart, "id" | "sessionID" | "messageID">[] = []

        for (const contentItem of result.content) {
          if (contentItem.type === "text") {
            textParts.push(contentItem.text)
          } else if (contentItem.type === "image") {
            attachments.push({
              type: "file",
              mime: contentItem.mimeType,
              url: `data:${contentItem.mimeType};base64,${contentItem.data}`,
            })
          } else if (contentItem.type === "resource") {
            const { resource } = contentItem
            if (resource.text) {
              textParts.push(resource.text)
            }
            if (resource.blob) {
              attachments.push({
                type: "file",
                mime: resource.mimeType ?? "application/octet-stream",
                url: `data:${resource.mimeType ?? "application/octet-stream"};base64,${resource.blob}`,
                filename: resource.uri,
              })
            }
          }
        }

        const truncated = await Truncate.output(textParts.join("\n\n"), {}, input.agent)
        const metadata = {
          ...(result.metadata ?? {}),
          truncated: truncated.truncated,
          ...(truncated.truncated && { outputPath: truncated.outputPath }),
        }

        return {
          title: "",
          metadata,
          output: truncated.content,
          attachments: attachments.map((attachment) => ({
            ...attachment,
            id: PartID.ascending(),
            sessionID: ctx.sessionID,
            messageID: input.processor.message.id,
          })),
          content: result.content, // directly return content to preserve ordering when outputting to model
        }
      }
      tools[key] = mcpTool
    }

    return tools
  }

  /** @internal Exported for testing */
  export const createStructuredOutputTool = _createStructuredOutputTool

  async function createUserMessage(input: PromptInput) {
    const messageID = input.messageID ?? MessageID.ascending()
    let agentName = input.agent || (await Agent.defaultAgent())
    const messageText = input.parts
      .filter((p): p is typeof p & { type: "text" } => p.type === "text")
      .map((p) => p.text)
      .join(" ")

    // v2-style auto agent switching: simple sync keyword route, fires whenever
    // a topic keyword scores ≥ 0.4. Skipped when the user explicitly named an
    // agent (@-mention), routing.disable is set in config, or a synthetic
    // continuation prompt asks to preserve the current agent.
    const cfg = await Config.get()
    const hasAgentPart = input.parts.some((p) => p.type === "agent")
    const routingDisabled = cfg.routing?.disable === true
    const preserveAgent = input.agentRouting === "preserve"
    if (messageText && !preserveAgent && !hasAgentPart && !routingDisabled) {
      const routeResult = routeAgent(messageText, agentName)
      if (routeResult) {
        const routedAgent = await Agent.get(routeResult.agent).catch(() => undefined)
        if (routedAgent) {
          const routedLabel = routedAgent.displayName ?? routeResult.agent
          Recorder.emit({
            type: "agent.route",
            sessionID: input.sessionID,
            messageID,
            fromAgent: agentName,
            toAgent: routeResult.agent,
            confidence: routeResult.confidence,
            routeMode: "switch",
            matched: routeResult.matched,
          })
          agentName = routeResult.agent
          log.info("auto-routed to agent", {
            command: "session.prompt.route",
            status: "ok",
            sessionID: input.sessionID,
            agent: routeResult.agent,
            confidence: routeResult.confidence,
          })
          Bus.publishDetached(TuiEvent.ToastShow, {
            title: "Agent Auto-Switched",
            message: `Switched to "${routedLabel}" agent for this task`,
            variant: "info",
            duration: 5000,
          })
        } else {
          log.warn("auto-route target not found", { agent: routeResult.agent })
        }
      }
    }

    // Classify message complexity (independent of agent routing) so simple
    // queries can use a small/fast model.
    const messageComplexity = messageText ? (await classifyComplexity(messageText)).complexity : null

    const agent = await agentInfo({ sessionID: input.sessionID, name: agentName })

    // Use a small/fast model for simple tasks when the user/agent didn't pin one.
    let complexityModel: { providerID: ProviderID; modelID: ModelID } | undefined
    if (messageComplexity === "low" && !input.model && !agent.model) {
      const defaultM = await Provider.defaultModel().catch(() => undefined)
      if (defaultM) {
        const small = await Provider.getSmallModel(defaultM.providerID)
        if (small) {
          complexityModel = { providerID: small.providerID, modelID: small.id }
          log.info("complexity-route", {
            command: "session.prompt.complexity",
            status: "ok",
            sessionID: input.sessionID,
            model: small.id,
          })
          // Emit a dedicated event so the thread indicator can show the fast-model decision.
          Recorder.emit({
            type: "agent.route",
            sessionID: input.sessionID,
            messageID,
            fromAgent: agentName,
            toAgent: agentName,
            confidence: 0,
            routeMode: "complexity",
            complexity: messageComplexity,
          })
        }
      }
    }

    const model = complexityModel ?? input.model ?? agent.model ?? (await lastModel(input.sessionID))
    const variant = input.variant ?? (!input.model && !complexityModel && agent.variant ? agent.variant : undefined)

    const info: MessageV2.Info = {
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

    type Draft<T> = T extends MessageV2.Part ? Omit<T, "id"> & { id?: string } : never
    const assign = (part: Draft<MessageV2.Part>): MessageV2.Part => ({
      ...part,
      id: part.id ? PartID.make(part.id) : PartID.ascending(),
    })

    const parts = await Promise.all(
      input.parts.map(async (part): Promise<Draft<MessageV2.Part>[]> => {
        if (part.type === "file") {
          // before checking the protocol we check if this is an mcp resource because it needs special handling
          if (part.source?.type === "resource") {
            const { clientName, uri } = part.source
            log.info("mcp resource", {
              command: "session.prompt.mcpResource",
              status: "started",
              sessionID: input.sessionID,
              clientName,
              uri,
              mime: part.mime,
            })

            const pieces: Draft<MessageV2.Part>[] = [
              {
                messageID: info.id,
                sessionID: input.sessionID,
                type: "text",
                synthetic: true,
                text: `Reading MCP resource: ${part.filename} (${uri})`,
              },
            ]

            try {
              const resourceContent = await MCP.readResource(clientName, uri)
              if (!resourceContent) {
                throw new Error(`Resource not found: ${clientName}/${uri}`)
              }

              // Handle different content types
              const contents = Array.isArray(resourceContent.contents)
                ? resourceContent.contents
                : [resourceContent.contents]

              for (const content of contents) {
                if ("text" in content && content.text) {
                  pieces.push({
                    messageID: info.id,
                    sessionID: input.sessionID,
                    type: "text",
                    synthetic: true,
                    text: content.text as string,
                  })
                } else if ("blob" in content && content.blob) {
                  // Handle binary content if needed
                  const mimeType = "mimeType" in content ? content.mimeType : part.mime
                  pieces.push({
                    messageID: info.id,
                    sessionID: input.sessionID,
                    type: "text",
                    synthetic: true,
                    text: `[Binary content: ${mimeType}]`,
                  })
                }
              }

              pieces.push({
                ...part,
                messageID: info.id,
                sessionID: input.sessionID,
              })
            } catch (error: unknown) {
              log.error("failed to read MCP resource", {
                command: "session.prompt.mcpResource",
                status: "error",
                errorCode: "MCP_RESOURCE_READ",
                sessionID: input.sessionID,
                error,
                clientName,
                uri,
              })
              const message = NamedError.message(error)
              pieces.push({
                messageID: info.id,
                sessionID: input.sessionID,
                type: "text",
                synthetic: true,
                text: `Failed to read MCP resource ${part.filename}: ${message}`,
              })
            }

            return pieces
          }
          const url = new URL(part.url)
          switch (url.protocol) {
            case "data:":
              if (part.mime === "text/plain") {
                return [
                  {
                    messageID: info.id,
                    sessionID: input.sessionID,
                    type: "text",
                    synthetic: true,
                    text: `Called the Read tool with the following input: ${JSON.stringify({ filePath: part.filename })}`,
                  },
                  {
                    messageID: info.id,
                    sessionID: input.sessionID,
                    type: "text",
                    synthetic: true,
                    text: decodeDataUrl(part.url),
                  },
                  {
                    ...part,
                    messageID: info.id,
                    sessionID: input.sessionID,
                  },
                ]
              }
              break
            case "file:":
              log.info("file", {
                command: "session.prompt.fileAttach",
                status: "started",
                sessionID: input.sessionID,
                mime: part.mime,
              })
              // have to normalize, symbol search returns absolute paths
              // Decode the pathname since URL constructor doesn't automatically decode it
              const filepath = fileURLToPath(part.url)

              // Path containment: reject file:// paths outside the project directory
              // and resolve symlinks to prevent symlink escapes (BUG-001, BUG-002)
              if (!Instance.containsPath(filepath)) {
                log.warn("file attachment outside project", {
                  command: "session.prompt.fileAttach",
                  status: "denied",
                  sessionID: input.sessionID,
                  filepath,
                })
                return [
                  {
                    messageID: info.id,
                    sessionID: input.sessionID,
                    type: "text" as const,
                    synthetic: true,
                    text: `Access denied: file path is outside the project directory: ${filepath}`,
                  },
                ]
              }
              const realFilepath = await fs.realpath(filepath).catch(() => null)
              if (realFilepath && !Instance.containsPath(realFilepath)) {
                log.warn("file attachment symlink escapes project", {
                  command: "session.prompt.fileAttach",
                  status: "denied",
                  sessionID: input.sessionID,
                  filepath,
                  realFilepath,
                })
                return [
                  {
                    messageID: info.id,
                    sessionID: input.sessionID,
                    type: "text" as const,
                    synthetic: true,
                    text: `Access denied: symlink target is outside the project directory: ${filepath}`,
                  },
                ]
              }

              const s = Filesystem.stat(filepath)

              if (s?.isDirectory()) {
                part.mime = "application/x-directory"
              }

              if (part.mime === "text/plain") {
                let offset: number | undefined = undefined
                let limit: number | undefined = undefined
                const range = {
                  start: url.searchParams.get("start"),
                  end: url.searchParams.get("end"),
                }
                if (range.start != null) {
                  const filePathURI = part.url.split("?")[0]
                  let start = parseInt(range.start, 10)
                  if (isNaN(start)) start = 1
                  let end = range.end ? parseInt(range.end, 10) : undefined
                  if (end !== undefined && isNaN(end)) end = undefined
                  // some LSP servers (eg, gopls) don't give full range in
                  // workspace/symbol searches, so we'll try to find the
                  // symbol in the document to get the full range
                  if (start === end) {
                    const symbols = await documentSymbolsForRangeExpansion(filePathURI)
                    for (const symbol of symbols) {
                      let range: LSP.Range | undefined
                      if ("range" in symbol) {
                        range = symbol.range
                      } else if ("location" in symbol) {
                        range = symbol.location.range
                      }
                      if (range?.start?.line != null && range?.start?.line === start) {
                        start = range.start.line
                        end = range?.end?.line ?? start
                        break
                      }
                    }
                  }
                  // Convert LSP 0-indexed line numbers to the Read tool's
                  // 1-indexed offset. `Math.max(start, 1)` was wrong — it
                  // clamped 0 → 1 but left every other value unchanged,
                  // so 0-indexed line 5 became offset 5 instead of 6. The
                  // Read tool starts one line too early for every symbol.
                  offset = start + 1
                  if (end !== undefined) {
                    // `limit` counts lines starting from `offset`. For a
                    // symbol spanning 0-indexed lines [start, end], the
                    // number of lines is (end - start + 1), which
                    // simplifies to `end - offset + 2` in 1-indexed terms.
                    limit = end - start + 1
                  }
                }
                const args = { filePath: filepath, offset, limit }

                const pieces: Draft<MessageV2.Part>[] = [
                  {
                    messageID: info.id,
                    sessionID: input.sessionID,
                    type: "text",
                    synthetic: true,
                    text: `Called the Read tool with the following input: ${JSON.stringify(args)}`,
                  },
                ]

                await ReadTool.init()
                  .then(async (t) => {
                    const readCtx: Tool.Context = {
                      sessionID: input.sessionID,
                      abort: AbortSignal.timeout(30_000),
                      agent: agentName,
                      messageID: info.id,
                      extra: { bypassCwdCheck: true },
                      messages: [],
                      metadata: async () => {},
                      ask: async () => {},
                    }
                    const result = await t.execute(args, readCtx)
                    pieces.push({
                      messageID: info.id,
                      sessionID: input.sessionID,
                      type: "text",
                      synthetic: true,
                      text: result.output,
                    })
                    if (result.attachments?.length) {
                      pieces.push(
                        ...result.attachments.map((attachment) => ({
                          ...attachment,
                          synthetic: true,
                          filename: attachment.filename ?? part.filename,
                          messageID: info.id,
                          sessionID: input.sessionID,
                        })),
                      )
                    } else {
                      pieces.push({
                        ...part,
                        messageID: info.id,
                        sessionID: input.sessionID,
                      })
                    }
                  })
                  .catch((error) => {
                    log.error("failed to read file", {
                      command: "session.prompt.readFile",
                      status: "error",
                      errorCode: "FILE_READ",
                      sessionID: input.sessionID,
                      error,
                    })
                    const message = error instanceof Error ? error.message : error.toString()
                    Bus.publishDetached(Session.Event.Error, {
                      sessionID: input.sessionID,
                      error: new NamedError.Unknown({
                        message,
                      }).toObject(),
                    })
                    pieces.push({
                      messageID: info.id,
                      sessionID: input.sessionID,
                      type: "text",
                      synthetic: true,
                      text: `Read tool failed to read ${filepath} with the following error: ${message}`,
                    })
                  })

                return pieces
              }

              if (part.mime === "application/x-directory") {
                const args = { filePath: filepath }
                const listCtx: Tool.Context = {
                  sessionID: input.sessionID,
                  abort: AbortSignal.timeout(30_000),
                  agent: agentName,
                  messageID: info.id,
                  extra: { bypassCwdCheck: true },
                  messages: [],
                  metadata: async () => {},
                  ask: async () => {},
                }
                return await ReadTool.init()
                  .then(async (t) => {
                    const result = await t.execute(args, listCtx)
                    return [
                      {
                        messageID: info.id,
                        sessionID: input.sessionID,
                        type: "text" as const,
                        synthetic: true,
                        text: `Called the Read tool with the following input: ${JSON.stringify(args)}`,
                      },
                      {
                        messageID: info.id,
                        sessionID: input.sessionID,
                        type: "text" as const,
                        synthetic: true,
                        text: result.output,
                      },
                      {
                        ...part,
                        messageID: info.id,
                        sessionID: input.sessionID,
                      },
                    ]
                  })
                  .catch((error) => {
                    log.error("failed to read directory", {
                      command: "session.prompt.readDir",
                      status: "error",
                      errorCode: "DIR_READ",
                      sessionID: input.sessionID,
                      error,
                    })
                    const message = error instanceof Error ? error.message : error.toString()
                    Bus.publishDetached(Session.Event.Error, {
                      sessionID: input.sessionID,
                      error: new NamedError.Unknown({
                        message,
                      }).toObject(),
                    })
                    return [
                      {
                        messageID: info.id,
                        sessionID: input.sessionID,
                        type: "text" as const,
                        synthetic: true,
                        text: `Read tool failed to read ${filepath} with the following error: ${message}`,
                      },
                    ]
                  })
              }

              try {
                await FileTime.read(input.sessionID, filepath)
                return [
                  {
                    messageID: info.id,
                    sessionID: input.sessionID,
                    type: "text",
                    text: `Called the Read tool with the following input: {"filePath":"${filepath}"}`,
                    synthetic: true,
                  },
                  {
                    id: part.id,
                    messageID: info.id,
                    sessionID: input.sessionID,
                    type: "file",
                    url: await (async () => {
                      const buffer = await Filesystem.readBytes(filepath)
                      if (buffer.length > 50 * 1024 * 1024)
                        throw new Error(`Attachment too large: ${buffer.length} bytes`)
                      return `data:${part.mime};base64,` + buffer.toString("base64")
                    })(),
                    mime: part.mime,
                    filename: part.filename ?? path.basename(filepath),
                    source: part.source,
                  },
                ]
              } catch (error) {
                log.error("failed to read binary file", {
                  command: "session.prompt.readBinaryFile",
                  status: "error",
                  errorCode: "BINARY_READ",
                  sessionID: input.sessionID,
                  error,
                })
                const message = error instanceof Error ? error.message : String(error)
                Bus.publishDetached(Session.Event.Error, {
                  sessionID: input.sessionID,
                  error: new NamedError.Unknown({
                    message,
                  }).toObject(),
                })
                return [
                  {
                    messageID: info.id,
                    sessionID: input.sessionID,
                    type: "text" as const,
                    synthetic: true,
                    text: `Read tool failed to read ${filepath} with the following error: ${message}`,
                  },
                ]
              }
            default:
              return [
                {
                  messageID: info.id,
                  sessionID: input.sessionID,
                  type: "text" as const,
                  synthetic: true,
                  text: `Unsupported file protocol: ${url.protocol}`,
                },
              ]
          }
        }

        if (part.type === "agent") {
          // Check if this agent would be denied by task permission
          const perm = Permission.evaluate("task", part.name, agent.permission)
          const hint = perm.action === "deny" ? " . Invoked by user; guaranteed to exist." : ""
          return [
            {
              ...part,
              messageID: info.id,
              sessionID: input.sessionID,
            },
            {
              messageID: info.id,
              sessionID: input.sessionID,
              type: "text",
              synthetic: true,
              // An extra space is added here. Otherwise the 'Use' gets appended
              // to user's last word; making a combined word
              text:
                " Use the above message and context to generate a prompt and call the task tool with subagent: " +
                part.name +
                hint,
            },
          ]
        }

        return [
          {
            ...part,
            messageID: info.id,
            sessionID: input.sessionID,
          },
        ]
      }),
    ).then((x) => x.flat().map(assign))

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

    // Validation guards: previously these blocks only logged errors and
    // then fell through to persistence, so invalid data was written to
    // the database anyway and corrupted downstream consumers (LLM
    // context, replay, API responses). Now we throw on any validation
    // failure so the caller sees a clear error and nothing is saved.
    const parsedInfo = MessageV2.Info.safeParse(info)
    if (!parsedInfo.success) {
      log.error("invalid user message before save", {
        command: "session.prompt.validate",
        status: "error",
        errorCode: "INVALID_MESSAGE",
        sessionID: input.sessionID,
        messageID: info.id,
        agent: info.agent,
        model: info.model,
        issues: parsedInfo.error.issues,
      })
      throw new Error(
        `Invalid user message: ${parsedInfo.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`,
      )
    }

    const invalidParts: number[] = []
    parts.forEach((part, index) => {
      const parsedPart = MessageV2.Part.safeParse(part)
      if (parsedPart.success) return
      log.error("invalid user part before save", {
        command: "session.prompt.validate",
        status: "error",
        errorCode: "INVALID_PART",
        sessionID: input.sessionID,
        messageID: info.id,
        partID: part.id,
        partType: part.type,
        index,
        issues: parsedPart.error.issues,
        part,
      })
      invalidParts.push(index)
    })
    if (invalidParts.length > 0) {
      throw new Error(`Invalid user part(s) at index ${invalidParts.join(", ")} — see log for details`)
    }

    await Session.updateMessage(info)
    // Run updatePart calls in parallel — they are independent DB
    // inserts with independent bus publishes. For messages with many
    // file attachments (screenshots, paste images), sequential awaits
    // added ~10-50ms per part.
    const partFailures: string[] = []
    await Promise.all(
      parts.map(async (part) => {
        try {
          await Session.updatePart(part)
        } catch (e) {
          log.warn("failed to persist part", { partID: part.id, err: e })
          partFailures.push(part.id)
        }
      }),
    )
    if (partFailures.length > 0) {
      throw new Error(`Failed to persist ${partFailures.length} message part(s): ${partFailures.join(", ")}`)
    }

    return {
      info,
      parts,
    }
  }

  async function insertReminders(input: { messages: MessageV2.WithParts[]; agent: Agent.Info; session: Session.Info }) {
    const userMsg = input.messages.findLast((msg) => msg.info.role === "user")
    if (!userMsg) return input.messages
    // Shallow-copy to avoid mutating cached message parts
    const userMessage = { ...userMsg, parts: [...userMsg.parts] }
    const messages = input.messages.map((m) => (m === userMsg ? userMessage : m))
    const autonomousDecisionLedger =
      process.env["AX_CODE_AUTONOMOUS"] === "true" ? autonomousDecisionLedgerReminder(input.messages) : undefined
    if (autonomousDecisionLedger) {
      userMessage.parts.push({
        id: PartID.ascending(),
        messageID: userMessage.info.id,
        sessionID: userMessage.info.sessionID,
        type: "text",
        text: autonomousDecisionLedger,
        synthetic: true,
      })
    }

    // Original logic when experimental plan mode is disabled
    if (!Flag.AX_CODE_EXPERIMENTAL_PLAN_MODE) {
      if (
        input.agent.name === "plan" &&
        !userMessage.parts.some((p) => p.type === "text" && p.synthetic && p.text === PROMPT_PLAN)
      ) {
        userMessage.parts.push({
          id: PartID.ascending(),
          messageID: userMessage.info.id,
          sessionID: userMessage.info.sessionID,
          type: "text",
          text: PROMPT_PLAN,
          synthetic: true,
        })
      }
      const wasPlan = input.messages.some((msg) => msg.info.role === "assistant" && msg.info.agent === "plan")
      if (
        wasPlan &&
        input.agent.name === "build" &&
        !userMessage.parts.some((p) => p.type === "text" && p.synthetic && p.text === BUILD_SWITCH)
      ) {
        userMessage.parts.push({
          id: PartID.ascending(),
          messageID: userMessage.info.id,
          sessionID: userMessage.info.sessionID,
          type: "text",
          text: BUILD_SWITCH,
          synthetic: true,
        })
      }
      return messages
    }

    // New plan mode logic when flag is enabled
    const assistantMessage = input.messages.findLast((msg) => msg.info.role === "assistant")

    // Switching from plan mode to build mode
    if (input.agent.name !== "plan" && assistantMessage?.info.agent === "plan") {
      const plan = Session.plan(input.session)
      const exists = await Filesystem.exists(plan)
      if (exists) {
        const part = await Session.updatePart({
          id: PartID.ascending(),
          messageID: userMessage.info.id,
          sessionID: userMessage.info.sessionID,
          type: "text",
          text:
            BUILD_SWITCH + "\n\n" + `A plan file exists at ${plan}. You should execute on the plan defined within it`,
          synthetic: true,
        })
        userMessage.parts.push(part)
      }
      return messages
    }

    // Entering plan mode
    if (input.agent.name === "plan" && assistantMessage?.info.agent !== "plan") {
      const plan = Session.plan(input.session)
      const exists = await Filesystem.exists(plan)
      if (!exists) await fs.mkdir(path.dirname(plan), { recursive: true })
      const part = await Session.updatePart({
        id: PartID.ascending(),
        messageID: userMessage.info.id,
        sessionID: userMessage.info.sessionID,
        type: "text",
        text: `<system-reminder>
Plan mode is active. The user indicated that they do not want you to execute yet -- you MUST NOT make any edits (with the exception of the plan file mentioned below), run any non-readonly tools (including changing configs or making commits), or otherwise make any changes to the system. This supersedes any other instructions you have received.

## Plan File Info:
${exists ? `A plan file already exists at ${plan}. You can read it and make incremental edits using the edit tool.` : `No plan file exists yet. You should create your plan at ${plan} using the write tool.`}
You should build your plan incrementally by writing to or editing this file. NOTE that this is the only file you are allowed to edit - other than this you are only allowed to take READ-ONLY actions.

## Plan Workflow

### Phase 1: Initial Understanding
Goal: Gain a comprehensive understanding of the user's request by reading through code and asking them questions. Critical: In this phase you should only use the explore subagent type.

1. Focus on understanding the user's request and the code associated with their request

2. **Launch up to 3 explore agents IN PARALLEL** (single message, multiple tool calls) to efficiently explore the codebase.
   - Use 1 agent when the task is isolated to known files, the user provided specific file paths, or you're making a small targeted change.
   - Use multiple agents when: the scope is uncertain, multiple areas of the codebase are involved, or you need to understand existing patterns before planning.
   - Quality over quantity - 3 agents maximum, but you should try to use the minimum number of agents necessary (usually just 1)
   - If using multiple agents: Provide each agent with a specific search focus or area to explore. Example: One agent searches for existing implementations, another explores related components, a third investigates testing patterns

3. After exploring the code, use the question tool to clarify ambiguities in the user request up front.

### Phase 2: Design
Goal: Design an implementation approach.

Launch general agent(s) to design the implementation based on the user's intent and your exploration results from Phase 1.

You can launch up to 1 agent(s) in parallel.

**Guidelines:**
- **Default**: Launch at least 1 Plan agent for most tasks - it helps validate your understanding and consider alternatives
- **Skip agents**: Only for truly trivial tasks (typo fixes, single-line changes, simple renames)

Examples of when to use multiple agents:
- The task touches multiple parts of the codebase
- It's a large refactor or architectural change
- There are many edge cases to consider
- You'd benefit from exploring different approaches

Example perspectives by task type:
- New feature: simplicity vs performance vs maintainability
- Bug fix: root cause vs workaround vs prevention
- Refactoring: minimal change vs clean architecture

In the agent prompt:
- Provide comprehensive background context from Phase 1 exploration including filenames and code path traces
- Describe requirements and constraints
- Request a detailed implementation plan

### Phase 3: Review
Goal: Review the plan(s) from Phase 2 and ensure alignment with the user's intentions.
1. Read the critical files identified by agents to deepen your understanding
2. Ensure that the plans align with the user's original request
3. Use question tool to clarify any remaining questions with the user

### Phase 4: Final Plan
Goal: Write your final plan to the plan file (the only file you can edit).
- Include only your recommended approach, not all alternatives
- Ensure that the plan file is concise enough to scan quickly, but detailed enough to execute effectively
- Include the paths of critical files to be modified
- Include a verification section describing how to test the changes end-to-end (run the code, use MCP tools, run tests)

### Phase 5: Call plan_exit tool
At the very end of your turn, once you have asked the user questions and are happy with your final plan file - you should always call plan_exit to indicate to the user that you are done planning.
This is critical - your turn should only end with either asking the user a question or calling plan_exit. Do not stop unless it's for these 2 reasons.

**Important:** Use question tool to clarify requirements/approach, use plan_exit to request plan approval. Do NOT use question tool to ask "Is this plan okay?" - that's what plan_exit does.

NOTE: At any point in time through this workflow you should feel free to ask the user questions or clarifications. Don't make large assumptions about user intent. The goal is to present a well researched plan to the user, and tie any loose ends before implementation begins.
</system-reminder>`,
        synthetic: true,
      })
      userMessage.parts.push(part)
      return messages
    }
    return messages
  }

  function safeDecisionText(value: unknown, max = 240) {
    if (typeof value !== "string") return ""
    const escaped = value
      .replace(/\s+/g, " ")
      .trim()
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
    return escaped.length <= max ? escaped : `${escaped.slice(0, max)}...`
  }

  /** @internal Exported for regression tests. */
  export function autonomousDecisionLedgerReminder(messages: MessageV2.WithParts[]) {
    const lines: string[] = []
    for (const message of messages) {
      for (const part of message.parts) {
        if (part.type !== "tool") continue
        if (part.tool !== "question") continue
        if (part.state.status !== "completed") continue
        const metadata = part.state.metadata
        if (!metadata || typeof metadata !== "object") continue
        const decisions = metadata["autonomousDecisions"]
        if (!Array.isArray(decisions)) continue
        for (const decision of decisions) {
          if (!decision || typeof decision !== "object") continue
          const value = decision as Record<string, unknown>
          const selected = Array.isArray(value["selected"])
            ? value["selected"]
                .map((item) => safeDecisionText(item, 120))
                .filter(Boolean)
                .join(", ")
            : ""
          const header = safeDecisionText(value["header"], 80)
          const question = safeDecisionText(value["question"], 180)
          const confidence = safeDecisionText(value["confidence"], 32)
          const rationale = safeDecisionText(value["rationale"], 240)
          lines.push(
            `- ${header ? `[${header}] ` : ""}${question || "Question"} -> ${selected || "Unanswered"}${
              confidence ? ` (${confidence} confidence)` : ""
            }${rationale ? `; ${rationale}` : ""}`,
          )
          if (lines.length >= 12) break
        }
        if (lines.length >= 12) break
      }
      if (lines.length >= 12) break
    }
    if (lines.length === 0) return
    return [
      "<autonomous_decision_ledger>",
      "Autonomous mode made these user-visible choices earlier in this session. Use this ledger when preparing the final response.",
      ...lines,
      "</autonomous_decision_ledger>",
    ].join("\n")
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
    const userMsg: MessageV2.User = {
      id: MessageID.ascending(),
      sessionID: input.sessionID,
      time: {
        created: Date.now(),
      },
      role: "user",
      agent: input.agent,
      model: {
        providerID: model.providerID,
        modelID: model.modelID,
      },
    }
    await Session.updateMessage(userMsg)
    const userPart: MessageV2.Part = {
      type: "text",
      id: PartID.ascending(),
      messageID: userMsg.id,
      sessionID: input.sessionID,
      text: "The following tool was executed by the user",
      synthetic: true,
    }
    await Session.updatePart(userPart)

    const msg: MessageV2.Assistant = {
      id: MessageID.ascending(),
      sessionID: input.sessionID,
      parentID: userMsg.id,
      mode: input.agent,
      agent: input.agent,
      path: {
        cwd: Instance.directory,
        root: Instance.worktree,
      },
      time: {
        created: Date.now(),
      },
      role: "assistant",
      tokens: {
        input: 0,
        output: 0,
        reasoning: 0,
        cache: { read: 0, write: 0 },
      },
      modelID: model.modelID,
      providerID: model.providerID,
    }
    await Session.updateMessage(msg)
    const part: MessageV2.Part = {
      type: "tool",
      id: PartID.ascending(),
      messageID: msg.id,
      sessionID: input.sessionID,
      tool: "bash",
      callID: ulid(),
      state: {
        status: "running",
        time: {
          start: Date.now(),
        },
        input: {
          command: input.command,
        },
      },
    }
    await Session.updatePart(part)
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
    let output = ""
    let outputBytes = 0
    let outputTruncated = false
    let flushDirty = false
    let flushRunning = false
    let pending = Promise.resolve()

    const appendOutput = (chunk: Buffer | string) => {
      const text = typeof chunk === "string" ? chunk : chunk.toString()
      if (!text || outputTruncated) return
      const chunkBytes = Buffer.byteLength(text, "utf-8")
      if (outputBytes + chunkBytes <= OUTPUT_HARD_CAP) {
        output += text
        outputBytes += chunkBytes
        return
      }

      let end = text.length
      const remaining = OUTPUT_HARD_CAP - outputBytes
      while (end > 0 && Buffer.byteLength(text.slice(0, end), "utf-8") > remaining) {
        end--
      }
      if (end > 0) {
        const slice = text.slice(0, end)
        output += slice
        outputBytes += Buffer.byteLength(slice, "utf-8")
      }
      output += "\n\n[output truncated at 10MB]"
      outputTruncated = true
    }

    const drainFlush = async () => {
      while (flushDirty) {
        flushDirty = false
        if (part.state.status !== "running") break
        part.state.metadata = { output, description: "", outputTruncated }
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

    proc.stdout?.on("data", (chunk) => {
      appendOutput(chunk)
      flush()
    })
    proc.stdout?.on("error", (error) => {
      log.warn("shell stdout stream error", {
        command: "session.prompt.shell",
        status: "error",
        errorCode: "STDOUT_STREAM_ERROR",
        error,
      })
    })

    proc.stderr?.on("data", (chunk) => {
      appendOutput(chunk)
      flush()
    })
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
      void kill().catch(() => {})
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
        void kill().catch(() => {})
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
        resolve()
      })
      proc.once("error", (err) => {
        exited = true
        clearTimeout(shellTimer)
        if (abortTimer) clearTimeout(abortTimer)
        abort.removeEventListener("abort", abortHandler)
        abort.removeEventListener("abort", abortTimeoutHandler)
        reject(err)
      })
      abort.addEventListener("abort", abortTimeoutHandler, { once: true })
    })

    if (aborted) {
      output += "\n\n" + ["<metadata>", "User aborted the command", "</metadata>"].join("\n")
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
              metadata: {
                output,
                description: "",
                outputTruncated,
              },
            }
          : {
              status: "completed",
              time: {
                ...part.state.time,
                end: Date.now(),
              },
              input: part.state.input,
              title: "",
              metadata: {
                output,
                description: "",
                outputTruncated,
              },
              output,
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
    parts: z
      .array(
        z.discriminatedUnion("type", [
          MessageV2.FilePart.omit({
            messageID: true,
            sessionID: true,
          }).partial({
            id: true,
          }),
        ]),
      )
      .optional(),
  })
  export type CommandInput = z.infer<typeof CommandInput>
  /**
   * Regular expression to match @ file references in text
   * Matches @ followed by file paths, excluding commas, periods at end of sentences, and backticks
   * Does not match when preceded by word characters or backticks (to avoid email addresses and quoted references)
   */

  export async function command(input: CommandInput) {
    log.info("command", {
      command: "session.prompt.command",
      status: "started",
      sessionID: input.sessionID,
      commandName: input.command,
    })
    const command = await Command.get(input.command)
    if (!command) {
      const available = await Command.list().then((cmds) => cmds.map((c) => c.name))
      const hint = available.length ? ` Available commands: ${available.join(", ")}` : ""
      const error = new NamedError.Unknown({ message: `Command not found: "${input.command}".${hint}` })
      Bus.publishDetached(Session.Event.Error, {
        sessionID: input.sessionID,
        error: error.toObject(),
      })
      throw error
    }
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

  const ensureTitle = _ensureTitle
}
