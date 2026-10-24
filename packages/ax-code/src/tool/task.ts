import { inheritTaskPermissionDenials, taskParentConstraints } from "./task-constraints"
import { assistantError, assistantErrorMessage, errorDetails, isAbortError } from "./task-errors"
import {
  assertSubagentDepth,
  fireSubagentStop,
  subagentDescription,
  subagentSessionPermissions,
  subagentToolGates,
  taskFanOutAllowed,
} from "./task-shared"
import { Tool } from "./tool"
import { BackgroundShell } from "./bash-background"
import DESCRIPTION from "./task.txt"
import { assertPoolAlias, modelPoolParameter, resolvePoolModel } from "./task-model-pool"
import z from "zod"
import { Session } from "../session"
import { BackgroundNotification } from "../session/background-notification"
import { SessionID, MessageID, type TaskQueueID } from "../session/schema"
import { NotFoundError } from "../storage/db"
import { MessageV2 } from "../session/message-v2"
import { needsRecoveredResultReview } from "../session/background-subagent-handoff"
import { agentModel } from "../session/prompt/prompt-command-selection"
import { Agent } from "../agent/agent"
import { SessionPrompt } from "../session/prompt"
import { resolvePromptParts } from "../session/prompt/prompt-helpers"
import { iife } from "@/util/iife"
import { defer } from "@/util/defer"
import { Config } from "../config/config"
import { Log } from "@/util/log"
import { withTimeout } from "@/util/timeout"
import { ToolBoolean } from "./schema"
import { TaskOutputSchema } from "./task-output-schema"
import { Provider } from "../provider/provider"
import { TokenEstimate } from "../provider/token-estimate"

export const MAX_BACKGROUND_SUBAGENTS = 8

export class BackgroundCapacityError extends Error {
  constructor() {
    super(
      `Maximum concurrent background subagents (${MAX_BACKGROUND_SUBAGENTS}) reached. This limit counts background tasks only — the members of one task_parallel call do not use it, so a wide swarm can run alongside it. Wait for one to finish, stop one, or run this task in the foreground.`,
    )
    this.name = "BackgroundCapacityError"
  }
}
// 10 minutes: subagent tasks that exceed this are likely stuck on a
// non-responsive provider or in an infinite tool loop. The step limit
// (200) catches runaway tool loops, but a provider that accepts the
// request and then never streams tokens would hang forever without
// this timeout.
const SUBAGENT_TIMEOUT_MS = 10 * 60 * 1000
const SUBAGENT_FINALIZE_TIMEOUT_MS = 2 * 60 * 1000

const EMPTY_FINALIZE_INSTRUCTION =
  `Your previous subagent turn ended without a usable final response. ` +
  `Produce the final result for this task now in plain text. ` +
  `Do not call more tools unless absolutely required. ` +
  `If the evidence is incomplete, explicitly say what was inspected and what remains unresolved.`

// Sent after the child's background shells finish: the final turn must fold
// their evidence in without launching more detached work.
const BACKGROUND_FINALIZE_INSTRUCTION =
  `Background shell work started by this task has finished. ` +
  `Produce the final result for this task now in plain text, using bash_output to read any background output you have not consumed. ` +
  `Do not start new shells or monitors, and do not delegate further. ` +
  `If the evidence is incomplete, explicitly say what was inspected and what remains unresolved.`

// Sent when the background wait exhausted the budget reserved for it. The
// task must still return usable evidence rather than fail: the final turn
// reports the partial result and says explicitly that work is still running.
const BACKGROUND_ONGOING_INSTRUCTION =
  `Background work started by this task is still running and did not finish within the available time. ` +
  `Produce the best final result for this task now in plain text, using bash_output to read any background output already produced. ` +
  `Say explicitly which background work is still running and what evidence remains pending. ` +
  `Do not start new shells or monitors, and do not delegate further.`
const log = Log.create({ service: "task-tool" })

const baseParameters = z.object({
  description: z.string().describe("A short (3-5 words) description of the task"),
  prompt: z.string().describe("The task for the agent to perform"),
  subagent_type: z.string().describe("The type of specialized agent to use for this task"),
  task_id: z
    .string()
    .describe(
      "This should only be set if you mean to resume a previous task (you can pass a prior task_id and the task will continue the same subagent session as before instead of creating a fresh one)",
    )
    .optional(),
  command: z.string().describe("The command that triggered this task").optional(),
  background: ToolBoolean.optional().describe(
    "Run the agent in the background. Returns immediately with a task_id. You will be notified when it completes. DO NOT sleep, poll, or proactively check on its progress. Default false.",
  ),
  // ADR-239: optional fork copies the parent's model-visible history into the
  // child session as its starting context (read-only to the parent). The
  // child keeps the standard subagent denials (no further fan-out, ADR-005)
  // and the same scope of permission rules as a non-fork subagent. Refused
  // when the calling session is itself a subagent, when the projected
  // history would exceed 60% of the child's context window, or when combined
  // with task_id (which resumes an existing session instead of forking).
  fork: ToolBoolean.optional().describe(
    "Copy the parent's model-visible history into the child session as its starting context. Read-only to the parent. The child cannot fan out further. Refused when the parent is itself a subagent or when the copied history would exceed 60% of the child's context window.",
  ),
  output_schema: TaskOutputSchema.Parameter.optional(),
})

/** Parameters the executor accepts: the base shape plus the pool `model` alias (ADR-218). */
type TaskParameters = z.infer<typeof baseParameters> & { model?: string }

type TaskMetadata = {
  sessionId: SessionID
  model: { modelID: string; providerID: string }
  background?: boolean
  queueID?: TaskQueueID
  /** Background work was still pending when the task finalized (ongoing). */
  backgroundPending?: boolean
  emptyResult: boolean
  finalizeAttempted: boolean
  recoveredFromEmpty: boolean
  recoveredResultNeedsReview: boolean
  subagentError: boolean
  errorName?: string
  errorMessage?: string
  finalizeError?: boolean
  finalizeErrorName?: string
  finalizeErrorMessage?: string
  // Set only when the caller requested output_schema, so schema-less callers
  // keep an unchanged result shape. `structured` is the captured payload.
  structuredStatus?: "absent" | "captured"
  structured?: unknown
}

function taskResult(title: string, metadata: TaskMetadata, output: string) {
  return { title, metadata, output }
}

const BACKGROUND_STARTED = [
  "The task is working in the background. You will be notified when it finishes.",
  "DO NOT sleep, poll for progress, ask the task for status, or duplicate this task's work — avoid working with the same files or topics it is using.",
  "Work on non-overlapping tasks, or briefly tell the user what you launched and end your response.",
].join("\n")

async function startBackgroundSubagent(input: {
  params: TaskParameters
  ctx: Tool.Context
  session: Awaited<ReturnType<typeof Session.create>>
  agent: Agent.Info
  model: { modelID: string; providerID: string }
  taskTools: Record<string, boolean>
  isolation: Awaited<ReturnType<typeof taskParentConstraints>>["isolation"]
  promptParts: Awaited<ReturnType<typeof resolvePromptParts>>
  ensureNotAborted: () => void
}) {
  const { params, ctx, session, agent, model, taskTools, promptParts, ensureNotAborted } = input
  ensureNotAborted()
  const { TaskQueue } = await import("../session/task-queue")
  const { TaskQueueExecutor } = await import("../session/task-queue-executor")
  await assertBackgroundCapacity(ctx.sessionID, TaskQueue)

  const queued = await TaskQueue.enqueue({
    sessionID: session.id,
    kind: "subagent",
    title: params.description,
    agent: agent.name,
    model,
    sourceMessageID: ctx.messageID,
    executionTimeoutMs: SUBAGENT_TIMEOUT_MS,
    payload: {
      source: "task",
      resumeOnRestart: true,
      deliveryStatus: "pending",
      parentSessionID: ctx.sessionID,
      subagentType: params.subagent_type,
      command: params.command,
      prompt: params.prompt,
      body: {
        parts: promptParts,
        agent: agent.name,
        model,
        tools: taskTools,
        toolsScope: "turn",
        isolation: input.isolation,
        agentRouting: "preserve",
      },
    },
  })
  ensureNotAborted()

  try {
    await TaskQueueExecutor.start(queued)
  } catch (error) {
    log.warn("failed to start background subagent queue item", {
      sessionID: session.id,
      queueID: queued.id,
      error,
    })
    // The row exists but nothing will run it: leave it terminal so it stops
    // counting against background capacity and cannot be resumed as live
    // work, then surface the failure instead of reporting a running task.
    await TaskQueue.setStatus({
      id: queued.id,
      status: "failed",
      error: error instanceof Error ? error.message : String(error),
    }).catch((statusError) => {
      log.warn("failed to mark unstarted background subagent queue item", {
        queueID: queued.id,
        error: statusError,
      })
    })
    throw error
  }

  const metadata = {
    sessionId: session.id,
    model,
    background: true,
    queueID: queued.id,
  }
  ctx.metadata({
    title: params.description,
    metadata,
  })

  return taskResult(
    params.description,
    {
      ...metadata,
      emptyResult: false,
      finalizeAttempted: false,
      recoveredFromEmpty: false,
      recoveredResultNeedsReview: false,
      subagentError: false,
    },
    [
      `task_id: ${session.id} (for resuming to continue this task if needed)`,
      "state: running",
      `queue_id: ${queued.id}`,
      "",
      "<task_result>",
      BACKGROUND_STARTED,
      "</task_result>",
    ].join("\n"),
  )
}

// Terminal queue statuses (the same set TaskQueue.setStatus treats as
// terminal): rows in these states no longer count against background
// capacity. Kept as a plain string set so it can be checked against the
// wider Status union without importing the task-queue namespace statically.
const TERMINAL_TASK_STATUSES: ReadonlySet<string> = new Set(["completed", "failed", "cancelled"])

async function assertBackgroundCapacity(
  parentSessionID: SessionID,
  TaskQueue: typeof import("../session/task-queue").TaskQueue,
) {
  // Query only non-terminal rows: listing the first N rows of any status let
  // 100+ terminal rows shadow a later active subagent row and over-admit past
  // MAX_BACKGROUND_SUBAGENTS. limit: 500 is the ListInput schema maximum.
  const statuses = TaskQueue.Status.options.filter((status) => !TERMINAL_TASK_STATUSES.has(status))
  const children = await Session.children(parentSessionID)
  let active = 0
  for (const child of children) {
    const items = await TaskQueue.list({ sessionID: child.id, statuses, limit: 500 })
    if (items.some((item) => item.kind === "subagent")) {
      active++
    }
  }
  if (active >= MAX_BACKGROUND_SUBAGENTS) {
    throw new BackgroundCapacityError()
  }
}

export const TaskTool = Tool.define("task", async (ctx?) => {
  const description = await subagentDescription(DESCRIPTION, ctx?.agent)
  // ADR-218: with a configured agents.model_pool the tool advertises a `model`
  // alias parameter; without one the schema stays byte-identical to the
  // pre-pool shape.
  const initConfig = await Config.get()
  const modelParam = modelPoolParameter(initConfig.agents?.model_pool)
  const parameters = modelParam ? baseParameters.extend({ model: modelParam }) : baseParameters
  return {
    description,
    parameters,
    async execute(params: TaskParameters, ctx) {
      // Fail before any child session exists. A background task cannot return a
      // validated structured result, so accepting this combination would spawn
      // work whose contract the caller can never observe.
      if (params.output_schema && params.background) {
        throw new Error(
          "output_schema is not supported with background: true — run the task in the foreground so its structured result can be validated and returned.",
        )
      }
      const structuredFormat = params.output_schema ? TaskOutputSchema.toFormat(params.output_schema) : undefined
      let aborted = false

      const markAborted = () => {
        aborted = true
      }
      const ensureNotAborted = () => {
        if (ctx.abort.aborted || aborted) throw new DOMException("Aborted", "AbortError")
      }
      let subagentSessionID: SessionID | undefined

      function cancelSubagent() {
        if (!subagentSessionID) return
        // Abort propagation IS an interruption of the child turn, so the
        // Interrupt hook fires for the child session as well.
        void SessionPrompt.cancel(subagentSessionID, { interrupt: true }).catch((error) => {
          log.warn("failed to cancel aborted subagent session", {
            sessionID: subagentSessionID,
            error,
          })
        })
      }

      ctx.abort.addEventListener("abort", markAborted, { once: true })
      using _ = defer(() => ctx.abort.removeEventListener("abort", markAborted))
      ctx.abort.addEventListener("abort", cancelSubagent, { once: true })
      using _cancelSubagent = defer(() => ctx.abort.removeEventListener("abort", cancelSubagent))

      const config = await Config.get()
      ensureNotAborted()
      // ADR-218: reject an unknown pool alias before the permission ask or
      // any child session exists. Without a pool every non-"primary" value
      // is rejected, so the model cannot route to an unauthorised provider.
      assertPoolAlias(config.agents?.model_pool, params.model)
      await assertSubagentDepth(ctx.sessionID, ensureNotAborted)

      // Skip permission check when user explicitly invoked via @ or command subtask
      if (!ctx.extra?.bypassAgentCheck) {
        await ctx.ask({
          permission: "task",
          patterns: [params.subagent_type],
          always: ["*"],
          metadata: {
            description: params.description,
            subagent_type: params.subagent_type,
          },
        })
      }

      const agent = await Agent.get(params.subagent_type)
      ensureNotAborted()
      if (!agent) throw new Error(`Unknown agent type: ${params.subagent_type} is not a valid agent type`)

      if (params.background) {
        const { TaskQueue } = await import("../session/task-queue")
        await assertBackgroundCapacity(ctx.sessionID, TaskQueue)
      }

      const canFanOut = taskFanOutAllowed(agent)

      const msg = await MessageV2.get({ sessionID: ctx.sessionID, messageID: ctx.messageID })
      ensureNotAborted()
      if (msg.info.role !== "assistant") throw new Error("Not an assistant message")
      // Hoisted for the fork branch below: the async iife cannot see the
      // narrowed `assistant` type for `msg.info` after the throw above, so
      // we capture the two fields it needs (parent model) into a local
      // before crossing the closure boundary.
      const msgFallback = { modelID: msg.info.modelID, providerID: msg.info.providerID }
      const constraints = await taskParentConstraints(msg.info)
      ensureNotAborted()

      const session = await iife(async () => {
        // ADR-239: fork copies the parent's model-visible history into the
        // child as its starting context. Must come before the resume branch
        // (task_id) because the two are mutually exclusive: resume continues
        // an existing session, fork creates a new one from the parent.
        if (params.fork) {
          if (params.task_id) {
            throw new Error(
              "fork is not supported with task_id — fork creates a new child session from the parent's history; pass task_id alone to resume an existing session.",
            )
          }
          const parentSession = await Session.get(ctx.sessionID)
          if (parentSession?.parentID) {
            throw new Error(
              "fork is not available when the calling session is itself a subagent — the child would carry the parent's subagent ruleset and tool history, which would bypass the ADR-005 fan-out deny that applies to that parent. Call fork from the root session instead.",
            )
          }
          // Size guard (ADR-239 D3). The forked child starts from the same
          // model-visible prefix the parent just sent, so projecting the
          // parent's current messages gives the exact token cost the child
          // will pay on its first turn. Resolved here rather than after
          // the iife so the guard runs before any session is created.
          // `msgFallback` is hoisted out of this async closure so we do
          // not have to re-narrow the assistant union across an `await`.
          const forkModel = resolvePoolModel({
            pool: config.agents?.model_pool,
            requested: params.model,
            agentPin: await agentModel(agent),
            fallback: msgFallback,
          })
          ensureNotAborted()
          const providerModel = await Provider.getModel(forkModel.providerID, forkModel.modelID).catch(() => undefined)
          if (providerModel) {
            const projected = await MessageV2.toModelMessages(ctx.messages, providerModel, { stripMedia: true })
            let projectedTokens = 0
            for (const m of projected) projectedTokens += TokenEstimate.messageTokens(m)
            const contextWindow = providerModel.limit.context
            // The child also needs room for its own first turn (prompt +
            // tools + response), so 60% is the documented budget for the
            // copied prefix. A 0-context model (custom gateway with no
            // declared window) is treated as "unknown" and skipped so a
            // missing cap never silently allows a giant fork.
            if (contextWindow > 0 && projectedTokens > 0.6 * contextWindow) {
              throw new Error(
                `fork refused: the parent's history projects to ~${projectedTokens} tokens, ` +
                  `which exceeds 60% of ${providerModel.name ?? forkModel.modelID}'s ${contextWindow}-token context window. ` +
                  `Use a regular task and inline only the context the child actually needs.`,
              )
            }
          }
          ensureNotAborted()
          // Session.fork copies every message strictly before ctx.messageID
          // (the parent's assistant turn that contains this tool call), so
          // the child starts at the same prefix the parent just sent to its
          // own model. ctx.messageID is the cutoff, not a message to copy.
          const forked = await Session.fork({ sessionID: ctx.sessionID, messageID: ctx.messageID })
          // The forked session inherits the parent's permission, but a fork
          // exists so a child can carry the parent's prompt cache without
          // also inheriting the parent's allow rules. ADR-239 D2: inherited
          // approvals are not carried over; the child keeps the standard
          // subagent denials (canFanOut=false → task:deny), and any of the
          // parent's deny rules survive so the child cannot exceed its
          // scope. Same shape as the non-fork create path, so existing
          // surfaces (subagent panel, session ruleset) render unchanged.
          const permission = subagentSessionPermissions({
            canFanOut: false,
            primaryTools: config.experimental?.primary_tools,
            inherited: constraints.permissionDenials,
          })
          await Session.setPermission({ sessionID: forked.id, permission })
          return { ...forked, permission }
        }
        if (params.task_id) {
          const found = await Session.get(SessionID.make(params.task_id)).catch((e) => {
            if (NotFoundError.isInstance(e)) return undefined
            throw e
          })
          if (found && found.parentID === ctx.sessionID) {
            const permission = inheritTaskPermissionDenials(found.permission ?? [], constraints.permissionDenials)
            await Session.setPermission({ sessionID: found.id, permission })
            return { ...found, permission }
          }
          if (found) throw new Error("Cannot resume a session that is not a child of the current session")
        }

        // Project-approved "always allow" rules already apply to this child
        // session: Permission.ask evaluates the caller's ruleset plus the
        // project-scoped `approved` list (src/permission/index.ts:320-337).
        // Do NOT copy allow rules into this durable session ruleset — a
        // persisted copy is stale by construction, widens blast radius in
        // unattended sessions, and corrupts the surfaces that render the
        // session's own ruleset (ADR-057 D1).
        return await Session.create({
          parentID: ctx.sessionID,
          title: params.description + ` (@${agent.name} subagent)`,
          permission: subagentSessionPermissions({
            canFanOut,
            primaryTools: config.experimental?.primary_tools,
            inherited: constraints.permissionDenials,
          }),
        })
      })
      subagentSessionID = session.id
      if (ctx.abort.aborted || aborted) cancelSubagent()

      // A subagent pinned to a disabled provider (native deepseek after the
      // SKU moved behind a custom gateway) runs on the parent's model instead
      // of failing the whole task with ModelNotFound. A pool alias (or the
      // pool default) overrides the agent pin only when the caller asked for
      // one or the user configured a default (ADR-218); the resolved model
      // flows into SessionPrompt.prompt so the usual provider availability
      // and permission checks still run.
      const model = resolvePoolModel({
        pool: config.agents?.model_pool,
        requested: params.model,
        agentPin: await agentModel(agent),
        fallback: {
          modelID: msg.info.modelID,
          providerID: msg.info.providerID,
        },
      })

      const taskTools = subagentToolGates({
        constraints: constraints.tools,
        canFanOut,
        primaryTools: config.experimental?.primary_tools,
      })
      let result: Awaited<ReturnType<typeof SessionPrompt.prompt>>
      let finalizeAttempted = false
      let finalizeError: ReturnType<typeof errorDetails> | undefined
      let initialEmpty = false
      // Whether background work needs a finalization turn (completed or still
      // running). Distinct from `backgroundTimedOut`, which only records that
      // the bounded wait actually expired.
      let backgroundWorkPending = false
      let backgroundTimedOut = false
      try {
        ensureNotAborted()
        ctx.metadata({
          title: params.description,
          metadata: {
            sessionId: session.id,
            model,
          },
        })

        const messageID = MessageID.ascending()
        ensureNotAborted()
        const promptParts = await resolvePromptParts(params.prompt)
        ensureNotAborted()

        if (params.background) {
          return await startBackgroundSubagent({
            params,
            ctx,
            session,
            agent,
            model,
            taskTools,
            isolation: constraints.isolation,
            promptParts,
            ensureNotAborted,
          })
        }

        // The original 10-minute prompt budget covers both the background
        // shell wait and the finalization prompt that follows it.
        const promptStartedAt = Date.now()
        result = await withTimeout(
          SessionPrompt.prompt({
            messageID,
            sessionID: session.id,
            model: {
              modelID: model.modelID,
              providerID: model.providerID,
            },
            agent: agent.name,
            agentRouting: "preserve",
            tools: taskTools,
            toolsScope: "turn",
            isolation: constraints.isolation,
            parts: promptParts,
            format: structuredFormat,
          }),
          SUBAGENT_TIMEOUT_MS,
          `Subagent timed out after ${SUBAGENT_TIMEOUT_MS / 60_000} minutes — provider may be unresponsive`,
        )

        ensureNotAborted()
        const initialText = result.parts.findLast((x) => x.type === "text")?.text ?? ""
        const initialError = assistantError(result)
        // Snapshot the FIRST turn's error and emptiness before any
        // finalization. A finalize forced by finished background work is not
        // recovery from an empty response.
        initialEmpty = initialText.trim().length === 0 && TaskOutputSchema.fromResult(result) === undefined
        // Persistent shells (monitors) are expected to keep running; waiting
        // for one would burn the whole task budget. A queued notification
        // means work already finished, so it still deserves a final turn.
        backgroundWorkPending =
          !initialError &&
          (BackgroundShell.list(session.id).some((shell) => shell.status === "running" && shell.persistent !== true) ||
            BackgroundNotification.pendingCount(session.id) > 0)
        if (backgroundWorkPending) {
          // Spend the remaining original budget on the wait, but reserve the
          // finalize window so the final prompt still has time to run.
          const waitBudgetMs = Math.max(
            0,
            SUBAGENT_TIMEOUT_MS - (Date.now() - promptStartedAt) - SUBAGENT_FINALIZE_TIMEOUT_MS,
          )
          const outcome = await BackgroundShell.waitForCompletion(session.id, {
            signal: ctx.abort,
            timeoutMs: waitBudgetMs,
          })
          ensureNotAborted()
          backgroundTimedOut = outcome === "timeout"
        }
        // A child that satisfied output_schema produced usable evidence even
        // with no prose, so the empty-result finalize retry must not run. The
        // background path still finalizes: its last turn only reported that
        // the detached work had started, or ended with work still running.
        if (backgroundWorkPending || (initialEmpty && !initialError)) {
          finalizeAttempted = true
          const finalizeMessageID = MessageID.ascending()
          const finalizeTimeoutMs = backgroundWorkPending
            ? Math.min(SUBAGENT_FINALIZE_TIMEOUT_MS, Math.max(1, SUBAGENT_TIMEOUT_MS - (Date.now() - promptStartedAt)))
            : SUBAGENT_FINALIZE_TIMEOUT_MS
          try {
            result = await withTimeout(
              SessionPrompt.prompt({
                messageID: finalizeMessageID,
                sessionID: session.id,
                model: {
                  modelID: model.modelID,
                  providerID: model.providerID,
                },
                agent: agent.name,
                agentRouting: "preserve",
                isolation: constraints.isolation,
                toolsScope: "turn",
                tools: backgroundWorkPending
                  ? { ...taskTools, bash: false, monitor: false, task: false, task_parallel: false }
                  : { ...taskTools, task: false },
                format: structuredFormat,
                parts: [
                  {
                    type: "text",
                    text: backgroundWorkPending
                      ? backgroundTimedOut
                        ? BACKGROUND_ONGOING_INSTRUCTION
                        : BACKGROUND_FINALIZE_INSTRUCTION
                      : EMPTY_FINALIZE_INSTRUCTION,
                  },
                ],
              }),
              finalizeTimeoutMs,
              `Subagent finalization timed out after ${Math.max(1, Math.round(finalizeTimeoutMs / 60_000))} minutes`,
            )
            ensureNotAborted()
          } catch (error) {
            if (ctx.abort.aborted || aborted) throw error
            finalizeError = errorDetails(error)
            log.warn("subagent finalization failed", {
              sessionID: session.id,
              errorCode: finalizeError.name,
              errorMessage: finalizeError.message,
            })
            await SessionPrompt.cancel(session.id).catch((cancelError) => {
              log.warn("failed to cancel subagent session after finalization error", {
                sessionID: session.id,
                error: cancelError,
              })
            })
          }
        }
      } catch (e) {
        // Cancel the in-flight processor before deciding how to surface the
        // failure. Without this, a timed-out subagent's processor continues
        // running (making LLM calls, executing tools) in the background
        // even though the parent has moved on.
        await SessionPrompt.cancel(session.id).catch((error) => {
          log.warn("failed to cancel subagent session after task error", {
            sessionID: session.id,
            error,
          })
        })

        // A genuine abort tears the whole session tree down — the parent is
        // gone and there is nothing left to resume, so remove the orphaned
        // subagent session and propagate the cancellation.
        if (ctx.abort.aborted || aborted || isAbortError(e)) {
          await Session.remove(session.id).catch((error) => {
            log.warn("failed to remove session after task abort", { sessionID: session.id, error })
          })
          throw e
        }
        if (e instanceof BackgroundCapacityError) {
          await Session.remove(session.id).catch((error) => {
            log.warn("failed to remove session after background capacity error", { sessionID: session.id, error })
          })
          throw e
        }

        // Operational failure (subagent timeout, a provider error that threw,
        // etc.). Do NOT remove the session: it holds the subagent's partial
        // work (including any nested children) and must stay resumable. If we
        // rethrew here the tool would surface a bare ToolStateError with no
        // task_id, which the control-plane completion gate flags as "failed
        // before returning usable evidence" — and the auto-continuation prompt
        // then tells the model to "resume the task_id" that no longer exists,
        // so the gate can never be satisfied and the retry budget is burned for
        // nothing. Instead return a structured, recoverable result that
        // surfaces the task_id so the model can actually resume this session.
        const failure = errorDetails(e)
        log.warn("subagent task failed; preserving session for resume", {
          sessionID: session.id,
          errorCode: failure.name,
          errorMessage: failure.message,
        })
        const recoverableText = [
          `Subagent failed before returning a usable result: ${failure.name}: ${failure.message}.`,
          "Treat this as incomplete evidence: resume the task_id above to continue this subagent, " +
            "retry the task, or explain that no usable subagent result was returned.",
        ].join("\n")
        await fireSubagentStop({ sessionID: session.id, agent: agent.name, status: "failed" })
        return taskResult(
          params.description,
          {
            sessionId: session.id,
            model,
            emptyResult: true,
            finalizeAttempted,
            recoveredFromEmpty: false,
            recoveredResultNeedsReview: false,
            subagentError: true,
            errorName: failure.name as string | undefined,
            errorMessage: failure.message as string | undefined,
            finalizeError: !!finalizeError,
            finalizeErrorName: finalizeError?.name,
            finalizeErrorMessage: finalizeError?.message,
            // A failed task cannot have captured a structured result, but a
            // caller that asked for one must still see that status explicitly
            // rather than inferring it from a missing field.
            ...(params.output_schema ? { structuredStatus: "absent" as const } : {}),
          },
          [
            `task_id: ${session.id} (for resuming to continue this task if needed)`,
            "",
            "<task_result>",
            recoverableText,
            "</task_result>",
          ].join("\n"),
        )
      }

      const text = result.parts.findLast((x) => x.type === "text")?.text ?? ""
      const error = assistantError(result)
      const structured = TaskOutputSchema.fromResult(result)
      const emptyResult = text.trim().length === 0 && structured === undefined
      const recoveredFromEmpty = finalizeAttempted && initialEmpty && !emptyResult
      const recoveredResultNeedsReview = recoveredFromEmpty && needsRecoveredResultReview(text)
      const finalizeErrorText = finalizeError
        ? `Finalization failed with ${finalizeError.name}: ${finalizeError.message}.`
        : undefined
      const taskResultText = emptyResult
        ? error
          ? [
              `Subagent ended with ${error.name}: ${assistantErrorMessage(error)}.`,
              "Treat this as incomplete evidence: retry the task, resume the task_id, or explain that no usable subagent result was returned.",
            ].join("\n")
          : [
              "Subagent completed without a final response.",
              finalizeErrorText,
              "Treat this as incomplete evidence: retry the task, resume the task_id, or explain that no usable subagent result was returned.",
            ]
              .filter(Boolean)
              .join("\n")
        : [
            recoveredFromEmpty
              ? "Note: this result was recovered by asking the subagent to finalize after an initially empty response. Review it before treating it as normal subagent evidence."
              : "",
            text,
          ]
            .filter(Boolean)
            .join("\n\n")

      const output = [
        `task_id: ${session.id} (for resuming to continue this task if needed)`,
        "",
        "<task_result>",
        taskResultText,
        "</task_result>",
        ...(structured === undefined ? [] : ["", TaskOutputSchema.render(structured)]),
      ].join("\n")

      await fireSubagentStop({
        sessionID: session.id,
        agent: agent.name,
        status: error || finalizeError ? "failed" : "completed",
      })

      return taskResult(
        params.description,
        {
          sessionId: session.id,
          model,
          emptyResult,
          finalizeAttempted,
          recoveredFromEmpty,
          recoveredResultNeedsReview,
          ...(backgroundTimedOut ? { backgroundPending: true } : {}),
          subagentError: !!error || !!finalizeError,
          errorName: error?.name ?? finalizeError?.name,
          errorMessage: error ? assistantErrorMessage(error) : finalizeError?.message,
          finalizeError: !!finalizeError,
          finalizeErrorName: finalizeError?.name,
          finalizeErrorMessage: finalizeError?.message,
          ...(params.output_schema
            ? structured === undefined
              ? { structuredStatus: "absent" as const }
              : { structuredStatus: "captured" as const, structured }
            : {}),
        },
        output,
      )
    },
  }
})
