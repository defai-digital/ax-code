import { taskParentConstraints } from "./task-constraints"
import { assistantError, assistantErrorMessage, errorDetails, isAbortError } from "./task-errors"
import { toErrorMessage } from "@/util/error-message"
import { TaskOutputSchema } from "./task-output-schema"
import { Tool } from "./tool"
import DESCRIPTION from "./task_parallel.txt"
import z from "zod"
import { Session } from "../session"
import { SessionID, MessageID } from "../session/schema"
import { NotFoundError } from "../storage/db"
import { MessageV2 } from "../session/message-v2"
import { agentModel } from "../session/prompt/prompt-command-selection"
import { Agent } from "../agent/agent"
import { SessionPrompt } from "../session/prompt"
import { resolvePromptParts } from "../session/prompt/prompt-helpers"
import { defer } from "@/util/defer"
import { Config } from "../config/config"
import { Permission } from "@/permission"
import { Log } from "@/util/log"
import { withTimeout } from "@/util/timeout"
import { WriteIsolation } from "../session/write-isolation"
import { EnsemblePreflight } from "../mode/preflight"
import type { ModelID, ProviderID } from "../provider/schema"

const MAX_DEPTH = 5
/**
 * Members a single swarm call may carry. Raised from 8 once the batch deadline
 * below existed: the worst case is now bounded by that deadline rather than by
 * members x per-member timeout, and the pool keeps the provider load flat.
 */
export const MAX_PARALLEL = 16
/**
 * Members allowed in flight. Deliberately a separate cap from `MAX_PARALLEL`:
 * binding the two let a wider swarm run wider, which is not the same decision
 * (the shared gateway quota is what a high in-flight count contends for).
 */
export const MAX_CONCURRENCY = 8
/** Swarm members in flight at once. Members beyond this queue behind them. */
const DEFAULT_CONCURRENCY = 4
/**
 * Whole-call wall clock. The call blocks the turn, so a wide swarm must not be
 * able to hold it for members x per-member timeout (16 members at concurrency 4
 * would otherwise reach ~48 minutes). On expiry the pool stops starting members,
 * cancels the ones in flight, and the call returns partial results.
 */
const SWARM_DEADLINE_MS = 30 * 60 * 1000
/** Characters of one member's final text inlined into the parent's context. */
const MEMBER_TEXT_INLINE_LIMIT = 4_000
/** Literal placeholder one `prompt_template` fans out over `items`. */
const ITEM_PLACEHOLDER = "{{item}}"
const SUBAGENT_TIMEOUT_MS = 10 * 60 * 1000
const SUBAGENT_FINALIZE_TIMEOUT_MS = 2 * 60 * 1000
const log = Log.create({ service: "task-parallel-tool" })

/** Latest user text in the transcript (for ensemble vs digs routing). */
function lastUserText(messages: MessageV2.WithParts[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i]
    if (!message || message.info.role !== "user") continue
    const chunks: string[] = []
    for (const part of message.parts) {
      if (part.type === "text" && typeof part.text === "string" && part.text.trim()) {
        chunks.push(part.text)
      }
    }
    if (chunks.length) return chunks.join("\n")
  }
  return ""
}

const TaskItem = z.object({
  description: z.string().describe("A short (3-5 words) description of the task"),
  prompt: z.string().describe("The task for the agent to perform"),
  subagent_type: z.string().describe("The type of specialized agent to use for this task"),
  output_schema: TaskOutputSchema.Parameter.optional(),
})

const parameters = z
  .object({
    tasks: z
      .array(TaskItem)
      .min(1, "Provide at least one task")
      .max(MAX_PARALLEL, `At most ${MAX_PARALLEL} parallel tasks`)
      .optional()
      .describe("Independent subagent tasks to run concurrently, each with its own full prompt"),
    items: z
      .array(z.string().min(1))
      .min(1, "Provide at least one item")
      .max(MAX_PARALLEL, `At most ${MAX_PARALLEL} items`)
      .optional()
      .describe(
        `Items to fan one prompt_template over. Each item replaces every ${ITEM_PLACEHOLDER} occurrence, so one brief covers N members instead of writing N prompts.`,
      ),
    prompt_template: z
      .string()
      .min(1)
      .optional()
      .describe(
        `Prompt shared by every item, containing the literal ${ITEM_PLACEHOLDER} placeholder. Validation runs before any member starts.`,
      ),
    subagent_type: z
      .string()
      .optional()
      .describe("Agent type for every item member. Required with items; the whole swarm uses one type."),
    concurrency: z
      .number()
      .int()
      .min(1)
      .max(MAX_CONCURRENCY)
      .optional()
      .describe(`Members allowed to run at once (default ${DEFAULT_CONCURRENCY}). Members beyond this queue.`),
    output_schema: TaskOutputSchema.Parameter.optional().describe(
      "Optional JSON Schema every item member must return. One schema per swarm, not per item.",
    ),
  })
  .describe("Provide either tasks, or items with prompt_template and subagent_type — never both")

export type TaskParallelItem = z.infer<typeof TaskItem>

/**
 * Expand and validate the two accepted call shapes into one member list. Pure
 * so the regression is unit-testable without driving the Provider stack, and so
 * every rejection happens BEFORE a child session, permission ask or worktree
 * exists — a malformed swarm costs nothing.
 */
export function expandTaskParallelInput(input: {
  tasks?: readonly TaskParallelItem[]
  items?: readonly string[]
  promptTemplate?: string
  subagentType?: string
  outputSchema?: TaskParallelItem["output_schema"]
}): { ok: true; tasks: TaskParallelItem[] } | { ok: false; message: string } {
  const hasTasks = (input.tasks?.length ?? 0) > 0
  const hasItems = (input.items?.length ?? 0) > 0
  if (hasTasks && (hasItems || input.promptTemplate !== undefined)) {
    return { ok: false, message: "Provide either tasks, or items with prompt_template — not both" }
  }
  if (!hasTasks && !hasItems) {
    return { ok: false, message: "Provide tasks, or items with prompt_template and subagent_type" }
  }
  if (hasTasks) {
    const tasks = [...input.tasks!]
    if (tasks.length > MAX_PARALLEL) return { ok: false, message: `At most ${MAX_PARALLEL} parallel tasks` }
    return { ok: true, tasks }
  }

  const items = input.items!
  // The schema already caps this; the pure function enforces it too so a direct
  // caller cannot build an over-cap swarm.
  if (items.length > MAX_PARALLEL) return { ok: false, message: `At most ${MAX_PARALLEL} items` }
  if (input.promptTemplate === undefined) {
    return { ok: false, message: "prompt_template is required when items are provided" }
  }
  if (!input.promptTemplate.includes(ITEM_PLACEHOLDER)) {
    return { ok: false, message: `prompt_template must contain the literal ${ITEM_PLACEHOLDER} placeholder` }
  }
  if (input.subagentType === undefined) {
    return { ok: false, message: "subagent_type is required when items are provided" }
  }
  // Single pass, no rescan: an item that itself contains the placeholder text
  // is substituted verbatim, never expanded again.
  const tasks = items.map((item) => ({
    description: swarmMemberDescription(item),
    prompt: input.promptTemplate!.split(ITEM_PLACEHOLDER).join(item),
    subagent_type: input.subagentType!,
    ...(input.outputSchema === undefined ? {} : { output_schema: input.outputSchema }),
  }))
  const seen = new Set<string>()
  for (const task of tasks) {
    // Compare trimmed prompts: two items that differ only in surrounding
    // whitespace fill to the same brief, which the model almost never intends.
    const key = task.prompt.trim()
    if (seen.has(key)) {
      return { ok: false, message: "Every item must produce a distinct prompt; two items filled identically" }
    }
    seen.add(key)
  }
  return { ok: true, tasks }
}

/** Human label for one item member: first line, bounded, never empty. */
function swarmMemberDescription(item: string) {
  const firstLine = item.split("\n").find((line) => line.trim().length > 0)?.trim() ?? item.trim()
  const bounded = firstLine.length > 60 ? `${firstLine.slice(0, 57)}...` : firstLine
  return bounded.length > 0 ? bounded : "swarm member"
}

type TaskItemInput = z.infer<typeof TaskItem>

async function assertDepth(sessionID: SessionID) {
  let depth = 0
  let parent: SessionID | undefined = sessionID
  while (parent) {
    const current: Awaited<ReturnType<typeof Session.get>> | undefined = await Session.get(parent).catch((e) => {
      if (NotFoundError.isInstance(e)) return undefined
      throw e
    })
    if (!current?.parentID) break
    depth++
    if (depth >= MAX_DEPTH) {
      throw new Error(`Maximum subagent nesting depth (${MAX_DEPTH}) exceeded`)
    }
    parent = current.parentID
  }
}

type TaskOutcome = {
  description: string
  subagent_type: string
  task_id: string
  ok: boolean
  text: string
  error?: string
  structured?: unknown
  // Mirrors tool/task.ts: set only when this task requested output_schema.
  structuredStatus?: "absent" | "captured"
}

// User lifecycle hooks (SubagentStop): observational only, same contract as
// tool/task.ts. Hook failures never affect the parallel result.
async function fireSubagentStop(input: { sessionID: string; agent: string; status: "completed" | "failed" }) {
  try {
    const { LifecycleHooks } = await import("@/hooks/lifecycle")
    await LifecycleHooks.runForWorkspace({
      event: "SubagentStop",
      sessionID: input.sessionID,
      args: { agent: input.agent, status: input.status },
    })
  } catch (error) {
    log.warn("SubagentStop lifecycle hooks failed", { sessionID: input.sessionID, error })
  }
}

async function runOneTask(input: {
  params: TaskItemInput
  ctx: Tool.Context
  model: { modelID: ModelID; providerID: ProviderID }
  config: Awaited<ReturnType<typeof Config.get>>
  agent: Agent.Info
  constraints: Awaited<ReturnType<typeof taskParentConstraints>>
  onSessionCreated?: (sessionID: SessionID) => void
}): Promise<TaskOutcome> {
  const { params, ctx, model, config, agent, constraints } = input
  // Same fan-out gate as tool/task.ts (ADR-005 deny-by-default; ADR-057 D2):
  // the LAST rule naming `task` decides, regardless of pattern — a scoped
  // allow like `task: { general: "allow" }` counts, wildcard `*` rules are
  // just rules like any other, and no task rule means deny-by-default.
  const taskRules = agent.permission.filter((rule) => rule.permission === "task")
  const canFanOut = taskRules.findLast(() => true)?.action === "allow"

  const session = await Session.create({
    parentID: ctx.sessionID,
    title: params.description + ` (@${agent.name} parallel)`,
    permission: [
      {
        permission: "todowrite",
        pattern: "*",
        action: "deny",
      },
      {
        permission: "todoread",
        pattern: "*",
        action: "deny",
      },
      {
        permission: "task_parallel",
        pattern: "*",
        action: "deny",
      },
      ...(canFanOut
        ? []
        : [
            {
              permission: "task" as const,
              pattern: "*" as const,
              action: "deny" as const,
            },
          ]),
      ...(config.experimental?.primary_tools?.map((t) => ({
        pattern: "*",
        action: "deny" as const,
        permission: t,
      })) ?? []),
      ...constraints.permissionDenials,
    ],
  })
  input.onSessionCreated?.(session.id)

  const cancel = () => {
    // Abort propagation IS an interruption of the child turn (same as
    // tool/task.ts cancelSubagent), so the Interrupt hook fires for it.
    void SessionPrompt.cancel(session.id, { interrupt: true }).catch((error) => {
      log.warn("failed to cancel parallel subagent", { sessionID: session.id, error })
    })
  }
  ctx.abort.addEventListener("abort", cancel, { once: true })
  using _ = defer(() => ctx.abort.removeEventListener("abort", cancel))

  const taskTools = {
    ...constraints.tools,
    todowrite: false,
    todoread: false,
    task_parallel: false,
    // No fan-out means no background tasks to wait on — hide waitfor too.
    ...(canFanOut
      ? {}
      : { task: false, waitfor: false, list_background_tasks: false, message_background_task: false }),
    ...Object.fromEntries((config.experimental?.primary_tools ?? []).map((t) => [t, false])),
  }

  // Caller-supplied schema, validated at the tool boundary before any child
  // session exists, mapped onto the shared structured-output turn.
  const structuredFormat = params.output_schema ? TaskOutputSchema.toFormat(params.output_schema) : undefined

  try {
    if (ctx.abort.aborted) throw new DOMException("Aborted", "AbortError")
    const promptParts = await resolvePromptParts(params.prompt)
    if (ctx.abort.aborted) throw new DOMException("Aborted", "AbortError")
    let result = await withTimeout(
      SessionPrompt.prompt({
        messageID: MessageID.ascending(),
        sessionID: session.id,
        model,
        agent: agent.name,
        agentRouting: "preserve",
        tools: taskTools,
        toolsScope: "turn",
        isolation: constraints.isolation,
        parts: promptParts,
        format: structuredFormat,
      }),
      SUBAGENT_TIMEOUT_MS,
      `Subagent timed out after ${SUBAGENT_TIMEOUT_MS / 60_000} minutes`,
    )

    if (ctx.abort.aborted) throw new DOMException("Aborted", "AbortError")
    let text = result.parts.findLast((x) => x.type === "text")?.text ?? ""
    const firstError = assistantError(result)
    // A child that satisfied output_schema produced usable evidence even with
    // no prose, so the empty-result finalize retry must not run.
    if (text.trim().length === 0 && !firstError && TaskOutputSchema.fromResult(result) === undefined) {
      try {
        result = await withTimeout(
          SessionPrompt.prompt({
            messageID: MessageID.ascending(),
            sessionID: session.id,
            model,
            agent: agent.name,
            agentRouting: "preserve",
            tools: { ...taskTools, task: false, task_parallel: false },
            isolation: constraints.isolation,
            toolsScope: "turn",
            format: structuredFormat,
            parts: [
              {
                type: "text",
                text:
                  `Your previous subagent turn ended without a usable final response. ` +
                  `Produce the final result for this task now in plain text. ` +
                  `Do not call more tools unless absolutely required. ` +
                  `If the evidence is incomplete, explicitly say what was inspected and what remains unresolved.`,
              },
            ],
          }),
          SUBAGENT_FINALIZE_TIMEOUT_MS,
          `Subagent finalization timed out after ${SUBAGENT_FINALIZE_TIMEOUT_MS / 60_000} minutes`,
        )
        if (ctx.abort.aborted) throw new DOMException("Aborted", "AbortError")
        text = result.parts.findLast((x) => x.type === "text")?.text ?? ""
      } catch (error) {
        if (ctx.abort.aborted || isAbortError(error)) throw error
        const failure = errorDetails(error)
        return {
          description: params.description,
          subagent_type: agent.name,
          task_id: session.id,
          ok: false,
          text: "",
          error: `${failure.name}: ${failure.message}`,
          ...(params.output_schema ? { structuredStatus: "absent" as const } : {}),
        }
      }
    }

    const structured = TaskOutputSchema.fromResult(result)
    // A caller that asked for a schema gets an explicit status on every
    // outcome shape, matching the single-task tool rather than leaving it to
    // be inferred from a missing field.
    const structuredFields = params.output_schema
      ? structured === undefined
        ? { structuredStatus: "absent" as const }
        : { structuredStatus: "captured" as const, structured }
      : {}
    const error = assistantError(result)
    if (error) {
      return {
        description: params.description,
        subagent_type: agent.name,
        task_id: session.id,
        ok: false,
        text,
        error: `${error.name}: ${assistantErrorMessage(error)}`,
        ...structuredFields,
      }
    }

    if (text.trim().length === 0 && structured === undefined) {
      return {
        description: params.description,
        subagent_type: agent.name,
        task_id: session.id,
        ok: false,
        text: "",
        error: "Subagent completed without a final response",
        ...structuredFields,
      }
    }

    return {
      description: params.description,
      subagent_type: agent.name,
      task_id: session.id,
      ok: true,
      text,
      ...structuredFields,
    }
  } catch (e) {
    await SessionPrompt.cancel(session.id).catch(() => undefined)
    if (ctx.abort.aborted || isAbortError(e)) {
      await Session.remove(session.id).catch(() => undefined)
      throw e
    }
    const failure = errorDetails(e)
    return {
      description: params.description,
      subagent_type: agent.name,
      task_id: session.id,
      ok: false,
      text: "",
      error: `${failure.name}: ${failure.message}`,
      ...(params.output_schema ? { structuredStatus: "absent" as const } : {}),
    }
  }
}

export const TaskParallelTool = Tool.define("task_parallel", async (ctx) => {
  const agents = await Agent.list().then((x) =>
    x.filter((a) => {
      const tier = Agent.resolveTier(a)
      return tier === "subagent" || tier === "specialist"
    }),
  )

  const caller = ctx?.agent
  const accessibleAgents = caller
    ? agents.filter((a) => Permission.evaluate("task", a.name, caller.permission).action !== "deny")
    : agents
  const list = accessibleAgents.toSorted((a, b) => a.name.localeCompare(b.name))

  const description = DESCRIPTION.replace(
    "{agents}",
    list
      .map((a) => `- ${a.name}: ${a.description ?? "This subagent should only be called manually by the user."}`)
      .join("\n"),
  )

  return {
    description,
    parameters,
    async execute(params: z.infer<typeof parameters>, toolCtx) {
      await assertDepth(toolCtx.sessionID)

      // Hard gate: multi-provider ensemble requests must not open parallel digs first.
      // Observed failure mode: /council → task_parallel ×4 explores → never calls council.
      EnsemblePreflight.assertTaskParallelAllowed(
        lastUserText(toolCtx.messages),
        toolCtx.extra?.bypassAgentCheck === true,
      )

      // Expand and validate before any gate can create state: a malformed swarm
      // must not reach the permission ask, agent resolution or a child session.
      const expansion = expandTaskParallelInput({
        tasks: params.tasks,
        items: params.items,
        promptTemplate: params.prompt_template,
        subagentType: params.subagent_type,
        outputSchema: params.output_schema,
      })
      if (!expansion.ok) throw new Error(expansion.message)
      const members = expansion.tasks
      const swarmItems = (params.items?.length ?? 0) > 0

      if (!toolCtx.extra?.bypassAgentCheck) {
        const types = [...new Set(members.map((t) => t.subagent_type))]
        await toolCtx.ask({
          permission: "task",
          patterns: types,
          always: ["*"],
          metadata: {
            description: swarmItems
              ? `swarm ${members.length} items from one template`
              : `parallel ${members.length} tasks`,
            subagent_types: types,
            parallel: true,
          },
        })
      }

      const resolved = await Promise.all(
        members.map(async (task) => {
          const agent = await Agent.get(task.subagent_type)
          if (!agent) throw new Error(`Unknown agent type: ${task.subagent_type}`)
          return { task, agent }
        }),
      )

      const isolation = WriteIsolation.evaluateParallelAgents(
        resolved.map(({ agent }) => ({
          name: agent.name,
          permission: agent.permission,
        })),
      )
      if (!isolation.ok) throw new Error(isolation.message)

      const msg = await MessageV2.get({ sessionID: toolCtx.sessionID, messageID: toolCtx.messageID })
      if (msg.info.role !== "assistant") throw new Error("Not an assistant message")

      const constraints = await taskParentConstraints(msg.info)
      const config = await Config.get()
      const defaultModel = {
        modelID: msg.info.modelID,
        providerID: msg.info.providerID,
      }

      toolCtx.metadata({
        title: `Parallel digs (${members.length})`,
        metadata: {
          count: members.length,
          writers: isolation.writers,
          readers: isolation.readers,
        },
      })

      // Every child owns its own session and settles independently. A child
      // that throws before its session exists must cancel siblings immediately
      // so they do not run to completion as orphans. SubagentStop still fires
      // for every child that did start, including cancelled ones.
      const started: { sessionID: SessionID; agent: string }[] = []
      let failed = false
      const cancelChild = (sessionID: SessionID) =>
        SessionPrompt.cancel(sessionID, { interrupt: true }).catch((error) => {
          log.warn("failed to cancel sibling parallel subagent", { sessionID, error })
        })
      const cancelStarted = async () => {
        failed = true
        await Promise.all(started.map((child) => cancelChild(child.sessionID)))
      }
      // Bounded fan-out: at most `concurrency` members run at once, the rest
      // queue behind them. Results are stored at their member index so the
      // aggregation below keeps the caller's ordering regardless of finish
      // order. A member that throws stops the pool from starting new work and
      // cancels the siblings that already started (unchanged contract).
      const concurrency = Math.min(params.concurrency ?? DEFAULT_CONCURRENCY, resolved.length)
      const deadlineAt = Date.now() + SWARM_DEADLINE_MS
      const outcomes: Array<Awaited<ReturnType<typeof runOneTask>> | undefined> = []
      // Members the deadline stopped before they were dispatched: reported as
      // their own outcome so the caller sees every member, not just the settled
      // ones, and so the numbering stays the caller's member order.
      const deadlineSkipped = new Set<number>()
      let deadlineHit = false
      let failure: { index: number; reason: unknown } | undefined
      let cursor = 0
      const runPool = async () => {
        while (failure === undefined && !toolCtx.abort.aborted && !deadlineHit) {
          const index = cursor++
          const entry = resolved[index]
          if (!entry) return
          if (Date.now() >= deadlineAt) {
            // Stop starting members, cancel the ones in flight so they cannot
            // outlive the call, and let the aggregation report partial results.
            deadlineHit = true
            deadlineSkipped.add(index)
            for (const child of started) void cancelChild(child.sessionID)
            return
          }
          const { task, agent } = entry
          try {
            outcomes[index] = await runOneTask({
              params: task,
              ctx: toolCtx,
              model: (await agentModel(agent)) ?? defaultModel,
              config,
              agent,
              constraints,
              onSessionCreated: (sessionID) => {
                started.push({ sessionID, agent: agent.name })
                if (failed) void cancelChild(sessionID)
              },
            })
          } catch (error) {
            // A member that throws before its session exists is reported as that
            // member's failure, not as the whole call's: discarding the members
            // that already finished would throw away real work, and a wide swarm
            // makes that loss more likely. An abort is the caller's own signal,
            // so it still propagates.
            if (toolCtx.abort.aborted || isAbortError(error)) throw error
            failure ??= { index, reason: error }
            await cancelStarted()
            return
          }
        }
      }
      // Whatever stopped the pool, let the members still in flight settle before
      // reporting: an unawaited promise would keep running past the response.
      if (deadlineHit) await cancelStarted()
      await Promise.all(Array.from({ length: Math.max(1, concurrency) }, () => runPool()))
      const settled = outcomes.filter((outcome): outcome is NonNullable<typeof outcome> => outcome !== undefined)
      const stopped = new Set(settled.map((outcome) => outcome.task_id))
      // Hooks run concurrently: they are independent notifications, and awaiting
      // them one by one made a wide swarm's latency grow with its member count.
      await Promise.all(
        settled.map((outcome) =>
          fireSubagentStop({
            sessionID: outcome.task_id,
            agent: outcome.subagent_type,
            status: outcome.ok ? "completed" : "failed",
          }),
        ),
      )
      if (failure) {
        await cancelStarted()
        await Promise.all(
          started
            .filter((child) => !stopped.has(child.sessionID))
            .map((child) => {
              stopped.add(child.sessionID)
              return fireSubagentStop({ sessionID: child.sessionID, agent: child.agent, status: "failed" })
            }),
        )
      }
      const callFailure = failure

      // Every member is reported in the caller's order, including the ones the
      // deadline stopped: a partial result that silently omitted them would read
      // as if the swarm had been narrower than it was.
      const failureReason =
        callFailure === undefined
          ? undefined
          : toErrorMessage(callFailure.reason, "member failed before its session existed")
      const reports = resolved.map(({ task }, index) => {
        const outcome = outcomes[index]
        if (outcome) return { task, outcome, status: outcome.ok ? ("ok" as const) : ("failed" as const) }
        if (callFailure?.index === index) {
          return { task, outcome: undefined, status: "failed" as const, error: failureReason! }
        }
        return {
          task,
          outcome: undefined,
          status: deadlineHit ? ("deadline_cancelled" as const) : ("not_started" as const),
          ...(callFailure === undefined
            ? {}
            : { error: `not started: sibling member ${callFailure.index + 1} failed before its session existed` }),
        }
      })
      const okCount = reports.filter((report) => report.status === "ok").length
      const lines = reports.map((report, index) => {
        const header = `### ${index + 1}. ${report.task.description} (@${report.task.subagent_type})`
        const result = report.outcome
        if (!result) {
          const reason =
            "error" in report && report.error
              ? report.error
              : report.status === "deadline_cancelled"
                ? `not started before the call's ${Math.round(SWARM_DEADLINE_MS / 60_000)}-minute deadline; run it as its own swarm or task`
                : "not started"
          return [header, `status: ${report.status}`, `task_id: -`, "", "<task_result>", reason, "</task_result>"].join("\n")
        }
        const full = result.ok ? result.text : [result.error, result.text].filter(Boolean).join("\n") || "No output"
        // Bound what one member contributes to the parent's context. The full
        // text stays in the member's own session, reachable by task_id.
        const truncated = full.length > MEMBER_TEXT_INLINE_LIMIT
        const body = truncated
          ? `${full.slice(0, MEMBER_TEXT_INLINE_LIMIT)}\n\n[truncated at ${MEMBER_TEXT_INLINE_LIMIT} characters; the member session ${result.task_id} holds the full text]`
          : full
        return [
          header,
          `status: ${report.status}`,
          `task_id: ${result.task_id}`,
          "",
          "<task_result>",
          body,
          "</task_result>",
          ...(result.structured === undefined ? [] : ["", TaskOutputSchema.render(result.structured)]),
        ].join("\n")
      })

      return {
        title: `Parallel digs ${okCount}/${reports.length} ok${deadlineHit ? " (deadline reached)" : ""}`,
        metadata: {
          results: reports.map((report) => {
            const result = report.outcome
            if (!result) {
              return {
                description: report.task.description,
                subagent_type: report.task.subagent_type,
                task_id: undefined,
                ok: false,
                error:
                  "error" in report && report.error
                    ? report.error
                    : report.status === "deadline_cancelled"
                      ? "not started before the swarm deadline"
                      : "not started",
              }
            }
            return {
              description: result.description,
              subagent_type: result.subagent_type,
              task_id: result.task_id,
              ok: result.ok,
              error: result.error,
              ...(result.structuredStatus === undefined
                ? {}
                : {
                    structuredStatus: result.structuredStatus,
                    ...(result.structured === undefined ? {} : { structured: result.structured }),
                  }),
            }
          }),
          writers: isolation.writers,
          readers: isolation.readers,
          ...(deadlineHit ? { deadlineReached: true } : {}),
        },
        output: [
          `Parallel explore finished: ${okCount}/${reports.length} succeeded.`,
          ...(deadlineHit
            ? [
                `The call reached its ${Math.round(SWARM_DEADLINE_MS / 60_000)}-minute deadline: members still running were cancelled and the rest were not started. Re-run the unfinished items.`,
              ]
            : []),
          isolation.writers.length > 0
            ? `Writers in this batch (serialized capability, single writer): ${isolation.writers.join(", ")}`
            : "All agents classified read-only.",
          "",
          ...lines,
        ].join("\n"),
      }
    },
  }
})
