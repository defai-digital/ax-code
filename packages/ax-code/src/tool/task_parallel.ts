import { taskParentConstraints } from "./task-constraints"
import { assistantError, assistantErrorMessage, errorDetails, isAbortError } from "./task-errors"
import {
  assertSubagentDepth,
  fireSubagentStop,
  subagentDescription,
  subagentSessionPermissions,
  subagentToolGates,
  taskFanOutAllowed,
} from "./task-shared"
import { toErrorMessage } from "@/util/error-message"
import { TaskOutputSchema } from "./task-output-schema"
import { assertPoolAlias, modelPoolParameter, resolvePoolModel } from "./task-model-pool"
import { Tool } from "./tool"
import DESCRIPTION from "./task_parallel.txt"
import z from "zod"
import { Session } from "../session"
import { SessionID, MessageID } from "../session/schema"
import { MessageV2 } from "../session/message-v2"
import { agentModel } from "../session/prompt/prompt-command-selection"
import { Agent } from "../agent/agent"
import { SessionPrompt } from "../session/prompt"
import { resolvePromptParts } from "../session/prompt/prompt-helpers"
import { defer } from "@/util/defer"
import { Config } from "../config/config"
import { Log } from "@/util/log"
import { withTimeout } from "@/util/timeout"
import { WriteIsolation } from "../session/write-isolation"
import { EnsemblePreflight } from "../mode/preflight"
import type { ModelID, ProviderID } from "../provider/schema"
import { Instance } from "../project/instance"
import { InstanceBootstrap } from "../project/bootstrap"
import { Worktree } from "../worktree"
import { git } from "../util/git"

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

const baseParameters = z.object({
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

/** Parameters the executor accepts: the base shape plus the pool `model` alias (ADR-218). */
type TaskParallelParameters = z.infer<typeof baseParameters> & { model?: string }

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
  const firstLine =
    item
      .split("\n")
      .find((line) => line.trim().length > 0)
      ?.trim() ?? item.trim()
  const bounded = firstLine.length > 60 ? `${firstLine.slice(0, 57)}...` : firstLine
  return bounded.length > 0 ? bounded : "swarm member"
}

/**
 * Capture the current HEAD of the project worktree so each writer's
 * worktree can be created from the same anchor and the post-pool pass can
 * report a diff against the original state. Returns null on failure
 * (non-git project or detached HEAD), which the caller treats as "no
 * diff anchor available" — writers still run, they just have nothing
 * to diff against.
 */
async function captureBaseCommit(): Promise<string | null> {
  if (Instance.project.vcs !== "git") return null
  const result = await git(["rev-parse", "HEAD"], { cwd: Instance.worktree })
  if (result.exitCode !== 0) return null
  return result.stdout.toString().trim() || null
}

/**
 * Slug for a parallel writer's worktree directory. Kept short (≤24 chars)
 * so the full name (e.g. "swarm-0-build-the-thing") fits inside the 38-char
 * branch-name limit imposed by `Worktree.makeWorktreeInfo`. Non-ASCII is
 * stripped so the name always validates.
 */
function slugifyForWorktree(input: string): string {
  const slug = input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+/, "")
    .replace(/-+$/, "")
  return slug.length > 0 ? slug.slice(0, 24) : "writer"
}

/**
 * Post-pool worktree cleanup for one writer. Runs from the project
 * Instance (NOT the worktree Instance) so `Worktree.remove` operates on
 * the same registry that created the worktree. Returns the per-writer
 * report that the call result aggregates.
 */
async function finalizeWriterWorktree(input: {
  outcome: TaskOutcome
  index: number
}): Promise<WriterWorktreeReport | undefined> {
  const { outcome, index } = input
  if (!outcome.worktree) return undefined
  const { info, startPoint } = outcome.worktree

  let diffStat = ""
  let dirty = false
  try {
    const [stat, status] = await Promise.all([
      git(["diff", "--stat", startPoint, "HEAD", "--"], { cwd: info.directory }),
      git(["status", "--porcelain=v1"], { cwd: info.directory }),
    ])
    diffStat = stat.exitCode === 0 ? stat.stdout.toString().trim() : ""
    dirty = status.exitCode === 0 && status.stdout.toString().trim().length > 0
  } catch (error) {
    log.warn("failed to read worktree diff status", {
      directory: info.directory,
      error: toErrorMessage(error),
    })
  }

  const hasChanges = diffStat.length > 0 || dirty
  let kept = true
  let removed = false
  if (!hasChanges && outcome.ok) {
    // ADR-231: zero commits and a clean tree → remove the worktree. A
    // failed member's empty worktree is also a candidate for removal —
    // it produced no patch either.
    try {
      await Worktree.remove({ directory: info.directory })
      removed = true
      kept = false
    } catch (error) {
      log.warn("failed to remove empty writer worktree", {
        directory: info.directory,
        error: toErrorMessage(error),
      })
    }
  }

  log.info("parallel writer worktree finalised", {
    memberIndex: index,
    branch: info.branch,
    kept,
    diffLines: diffStat.split("\n").filter(Boolean).length,
  })

  return { directory: info.directory, branch: info.branch, diffStat, dirty, kept, removed }
}

type WriterWorktreeReport = {
  directory: string
  branch: string
  diffStat: string
  dirty: boolean
  kept: boolean
  removed: boolean
}

type TaskItemInput = z.infer<typeof TaskItem>

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
  // ADR-231: set when this writer ran inside its own Worktree.createReady
  // worktree. Captured here so the post-pool pass can compute a diff stat
  // and decide whether to keep or remove the worktree. Undefined for
  // read-only members (which always share the main tree).
  worktree?: {
    info: Worktree.Info
    startPoint: string
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
  // ADR-231: when set, allocate a Worktree.createReady worktree for this
  // writer before doing anything else. Creation failure surfaces as a
  // member failure (not a thrown error) so the rest of the swarm keeps
  // running. The worktree info is returned in the outcome so the post-pool
  // pass can summarise diffs and decide whether to keep the worktree.
  worktreeSetup?: { name: string; startPoint: string }
}): Promise<TaskOutcome> {
  const { params, ctx, model, config, agent, constraints, worktreeSetup } = input
  const canFanOut = taskFanOutAllowed(agent)

  // ADR-231: allocate the writer's worktree up front. A non-git project or
  // a hostile start point fails this member only — the swarm continues
  // with the remaining members, which is the documented "fails that child
  // only with a clear message" behaviour.
  if (worktreeSetup) {
    let worktreeInfo: Worktree.Info
    try {
      worktreeInfo = await Worktree.createReady(worktreeSetup)
    } catch (error) {
      const failure = toErrorMessage(error, "worktree creation failed")
      log.warn("worktree creation failed for parallel writer", {
        agent: agent.name,
        error: failure,
      })
      return {
        description: params.description,
        subagent_type: agent.name,
        task_id: "",
        ok: false,
        text: "",
        error: `worktree creation failed: ${failure}. The rest of the swarm continues.`,
        ...(params.output_schema ? { structuredStatus: "absent" as const } : {}),
      }
    }
    // Wrap the rest of the member's work inside the new Instance so the
    // child session, the prompt path, and any tool that reads
    // Instance.directory all operate on the worktree. Mirrors the pattern
    // in src/tool/arena-implement.ts:433-525.
    const outcome = await Instance.provide({
      directory: worktreeInfo.directory,
      init: InstanceBootstrap,
      fn: () =>
        runMemberInsideInstance({
          params,
          ctx,
          model,
          config,
          agent,
          constraints,
          canFanOut,
          onSessionCreated: input.onSessionCreated,
        }),
    })
    return { ...outcome, worktree: { info: worktreeInfo, startPoint: worktreeSetup.startPoint } }
  }

  return await runMemberInsideInstance({
    params,
    ctx,
    model,
    config,
    agent,
    constraints,
    canFanOut,
    onSessionCreated: input.onSessionCreated,
  })
}

// The original body of runOneTask, lifted out so it can run either inside
// the writer's worktree (via Instance.provide) or directly on the main
// tree (no worktree). Behaviour is byte-identical to the pre-ADR-231 code
// for the no-worktree path.
async function runMemberInsideInstance(input: {
  params: TaskItemInput
  ctx: Tool.Context
  model: { modelID: ModelID; providerID: ProviderID }
  config: Awaited<ReturnType<typeof Config.get>>
  agent: Agent.Info
  constraints: Awaited<ReturnType<typeof taskParentConstraints>>
  canFanOut: boolean
  onSessionCreated?: (sessionID: SessionID) => void
}): Promise<TaskOutcome> {
  const { params, ctx, model, config, agent, constraints, canFanOut } = input

  const session = await Session.create({
    parentID: ctx.sessionID,
    title: params.description + ` (@${agent.name} parallel)`,
    permission: subagentSessionPermissions({
      canFanOut,
      extraDeny: ["task_parallel"],
      primaryTools: config.experimental?.primary_tools,
      inherited: constraints.permissionDenials,
    }),
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

  const taskTools = subagentToolGates({
    constraints: constraints.tools,
    canFanOut,
    extraDeny: ["task_parallel"],
    primaryTools: config.experimental?.primary_tools,
  })

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
        // Cancel the in-flight processor before reporting the failure: a
        // timed-out finalize would otherwise keep running (LLM calls, tools)
        // after the swarm has already returned this member as failed. Mirrors
        // the single-task tool.
        await SessionPrompt.cancel(session.id).catch((cancelError) => {
          log.warn("failed to cancel subagent session after finalization error", {
            sessionID: session.id,
            error: cancelError,
          })
        })
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
    // Only the caller's own abort is the whole call's business: it tears the tree
    // down and leaves nothing to report. A member cancelled together with its
    // siblings — the swarm deadline, a sibling failing before its session existed
    // — rejects with an AbortError too, and that is this member's outcome, not a
    // reason to discard the members that already finished.
    if (ctx.abort.aborted) {
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
  const description = await subagentDescription(DESCRIPTION, ctx?.agent)
  // ADR-218: with a configured agents.model_pool the swarm advertises a
  // `model` alias applied to every member; without one the schema stays
  // byte-identical to the pre-pool shape.
  const initConfig = await Config.get()
  const modelParam = modelPoolParameter(initConfig.agents?.model_pool)
  const parameters = (modelParam ? baseParameters.extend({ model: modelParam }) : baseParameters).describe(
    "Provide either tasks, or items with prompt_template and subagent_type — never both",
  )

  return {
    description,
    parameters,
    async execute(params: TaskParallelParameters, toolCtx) {
      await assertSubagentDepth(toolCtx.sessionID)

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

      // ADR-218: reject an unknown pool alias before the permission ask or any
      // child session exists, matching the single-task tool.
      const config = await Config.get()
      const pool = config.agents?.model_pool
      assertPoolAlias(pool, params.model)

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
        // ADR-231: opt-in worktree mode. Only effective for git projects — a
        // non-git project keeps the strict multi-writer reject because
        // Worktree.createReady would otherwise fail every writer. The flag
        // also has no effect when there is at most one writer, so
        // single-writer swarms behave unchanged.
        {
          allowWorktree: config.agents?.task_parallel?.worktree_isolation === true && Instance.project.vcs === "git",
        },
      )
      if (!isolation.ok) throw new Error(isolation.message)

      const msg = await MessageV2.get({ sessionID: toolCtx.sessionID, messageID: toolCtx.messageID })
      if (msg.info.role !== "assistant") throw new Error("Not an assistant message")

      const constraints = await taskParentConstraints(msg.info)
      const defaultModel = {
        modelID: msg.info.modelID,
        providerID: msg.info.providerID,
      }

      // ADR-231: capture the base commit before any worktree is created so
      // each writer's diff stat can be measured against the same anchor. We
      // only need this in worktree mode, but computing it once is cheap and
      // keeps the post-pool cleanup simple.
      const worktreeBaseCommit = isolation.mode === "worktree" ? await captureBaseCommit() : null
      // Worktree isolation is the only policy that admits concurrent writers,
      // so falling back to the shared tree when no base commit exists (e.g. a
      // repository with no commits yet) would silently reintroduce the
      // multi-writer hazard the policy refuses. Fail before any child starts.
      if (isolation.mode === "worktree" && !worktreeBaseCommit) {
        throw new Error(
          "task_parallel.worktree_isolation needs a git base commit: the project has no commit to start worktrees from",
        )
      }

      toolCtx.metadata({
        title: `Parallel digs (${members.length})`,
        metadata: {
          count: members.length,
          writers: isolation.writers,
          readers: isolation.readers,
          ...(isolation.mode === "worktree" ? { worktreeIsolation: true, baseCommit: worktreeBaseCommit } : {}),
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
      let deadlineHit = false
      let failure: { index: number; reason: unknown } | undefined
      let cursor = 0
      const runPool = async () => {
        while (failure === undefined && !toolCtx.abort.aborted && !deadlineHit) {
          const index = cursor++
          const entry = resolved[index]
          if (!entry) return
          if (Date.now() >= deadlineAt) {
            // Stop starting members and cancel the ones in flight so they cannot
            // outlive the call; the aggregation below still reports every member.
            // The await earns its keep: `cancelStarted` also marks the siblings as
            // cancelled, so a member whose session is created after this instant is
            // cancelled too instead of running on past the deadline it never saw.
            deadlineHit = true
            await cancelStarted()
            return
          }
          const { task, agent } = entry
          // ADR-231: when worktree mode is on, every writer member gets its
          // own worktree. Read-only members share the main tree (no
          // worktreeSetup). The name is the member index + a short slug so
          // tests can locate the worktree on disk; random adjective-noun
          // names are not predictable enough to assert against.
          const isWriter = isolation.writers.includes(agent.name)
          const worktreeSetup =
            isolation.mode === "worktree" && isWriter && worktreeBaseCommit
              ? {
                  name: `swarm-${index}-${slugifyForWorktree(task.description)}`,
                  startPoint: worktreeBaseCommit,
                }
              : undefined
          try {
            outcomes[index] = await runOneTask({
              params: task,
              ctx: toolCtx,
              // ADR-218: the swarm-wide alias (or the pool default) resolves
              // per member so an explicit agent pin still applies when no
              // alias was requested.
              model: resolvePoolModel({
                pool,
                requested: params.model,
                agentPin: await agentModel(agent),
                fallback: defaultModel,
              }),
              config,
              agent,
              constraints,
              onSessionCreated: (sessionID) => {
                started.push({ sessionID, agent: agent.name })
                if (failed) void cancelChild(sessionID)
              },
              ...(worktreeSetup ? { worktreeSetup } : {}),
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
      await Promise.all(Array.from({ length: Math.max(1, concurrency) }, () => runPool()))

      // ADR-231: per-writer worktree cleanup. For every writer that
      // successfully created a worktree, compute a short diff stat against
      // the base commit, then keep the worktree (with the diff) if there is
      // any change or new commit, or remove it (the documented "zero commits
      // and a clean tree" case) if the writer produced no patch. A removal
      // failure is logged but never fails the call — the user can re-run
      // `ax-code worktree remove` to clean up afterwards.
      const worktreeReports = await Promise.all(
        outcomes.map(async (outcome, index) => {
          if (!outcome?.worktree) return undefined
          return await finalizeWriterWorktree({ outcome, index })
        }),
      )
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
          return [header, `status: ${report.status}`, `task_id: -`, "", "<task_result>", reason, "</task_result>"].join(
            "\n",
          )
        }
        const full = result.ok ? result.text : [result.error, result.text].filter(Boolean).join("\n") || "No output"
        // Bound what one member contributes to the parent's context. The full
        // text stays in the member's own session, reachable by task_id.
        const truncated = full.length > MEMBER_TEXT_INLINE_LIMIT
        const body = truncated
          ? `${full.slice(0, MEMBER_TEXT_INLINE_LIMIT)}\n\n[truncated at ${MEMBER_TEXT_INLINE_LIMIT} characters; the member session ${result.task_id} holds the full text]`
          : full
        const worktree = worktreeReports[index]
        return [
          header,
          `status: ${report.status}`,
          `task_id: ${result.task_id}`,
          ...(worktree
            ? [
                `worktree: ${worktree.kept ? "kept" : "removed"}${worktree.removed ? " (clean tree, no diff)" : ""}`,
                `branch: ${worktree.branch}`,
                `worktree_path: ${worktree.directory}`,
                worktree.diffStat
                  ? `diff_stat:\n${worktree.diffStat}`
                  : worktree.dirty
                    ? `diff_stat: (uncommitted changes only)`
                    : `diff_stat: (no changes)`,
              ]
            : []),
          "",
          "<task_result>",
          body,
          "</task_result>",
          ...(result.structured === undefined ? [] : ["", TaskOutputSchema.render(result.structured)]),
        ].join("\n")
      })

      const worktreeKept = worktreeReports.filter((r) => r?.kept).length
      const worktreeRemoved = worktreeReports.filter((r) => r?.removed).length

      return {
        title: `Parallel digs ${okCount}/${reports.length} ok${deadlineHit ? " (deadline reached)" : ""}`,
        metadata: {
          results: reports.map((report, index) => {
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
            const worktree = worktreeReports[index]
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
              ...(worktree
                ? {
                    worktree: {
                      branch: worktree.branch,
                      directory: worktree.directory,
                      diffStat: worktree.diffStat,
                      dirty: worktree.dirty,
                      kept: worktree.kept,
                      removed: worktree.removed,
                    },
                  }
                : {}),
            }
          }),
          writers: isolation.writers,
          readers: isolation.readers,
          ...(isolation.mode === "worktree"
            ? {
                worktreeIsolation: true,
                baseCommit: worktreeBaseCommit,
                worktreesKept: worktreeKept,
                worktreesRemoved: worktreeRemoved,
              }
            : {}),
          ...(deadlineHit ? { deadlineReached: true } : {}),
        },
        output: [
          `Parallel explore finished: ${okCount}/${reports.length} succeeded.`,
          ...(deadlineHit
            ? [
                `The call reached its ${Math.round(SWARM_DEADLINE_MS / 60_000)}-minute deadline: members still running were cancelled and the rest were not started. Re-run the unfinished items.`,
              ]
            : []),
          isolation.mode === "worktree"
            ? `Worktree isolation (ADR-231) is on. ${worktreeKept} writer worktree(s) kept, ${worktreeRemoved} removed (clean tree, no diff). Nothing was merged.`
            : isolation.writers.length > 0
              ? `Writers in this batch (serialized capability, single writer): ${isolation.writers.join(", ")}`
              : "All agents classified read-only.",
          "",
          ...lines,
        ].join("\n"),
      }
    },
  }
})
