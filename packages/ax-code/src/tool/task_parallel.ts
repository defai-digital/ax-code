import { taskParentConstraints } from "./task-constraints"
import { assistantError, assistantErrorMessage, errorDetails, isAbortError } from "./task-errors"
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
const MAX_PARALLEL = 8
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
})

const parameters = z.object({
  tasks: z
    .array(TaskItem)
    .min(1, "Provide at least one task")
    .max(MAX_PARALLEL, `At most ${MAX_PARALLEL} parallel tasks`)
    .describe("Independent subagent tasks to run concurrently"),
})

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
    task: false,
    task_parallel: false,
    // No fan-out means no background tasks to wait on — hide waitfor too.
    waitfor: false,
    list_background_tasks: false,
    message_background_task: false,
    ...Object.fromEntries((config.experimental?.primary_tools ?? []).map((t) => [t, false])),
  }

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
      }),
      SUBAGENT_TIMEOUT_MS,
      `Subagent timed out after ${SUBAGENT_TIMEOUT_MS / 60_000} minutes`,
    )

    if (ctx.abort.aborted) throw new DOMException("Aborted", "AbortError")
    let text = result.parts.findLast((x) => x.type === "text")?.text ?? ""
    const firstError = assistantError(result)
    if (text.trim().length === 0 && !firstError) {
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
        }
      }
    }

    const error = assistantError(result)
    if (error) {
      return {
        description: params.description,
        subagent_type: agent.name,
        task_id: session.id,
        ok: false,
        text,
        error: `${error.name}: ${assistantErrorMessage(error)}`,
      }
    }

    if (text.trim().length === 0) {
      return {
        description: params.description,
        subagent_type: agent.name,
        task_id: session.id,
        ok: false,
        text: "",
        error: "Subagent completed without a final response",
      }
    }

    return {
      description: params.description,
      subagent_type: agent.name,
      task_id: session.id,
      ok: true,
      text,
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

      if (!toolCtx.extra?.bypassAgentCheck) {
        const types = [...new Set(params.tasks.map((t) => t.subagent_type))]
        await toolCtx.ask({
          permission: "task",
          patterns: types,
          always: ["*"],
          metadata: {
            description: `parallel ${params.tasks.length} tasks`,
            subagent_types: types,
            parallel: true,
          },
        })
      }

      const resolved = await Promise.all(
        params.tasks.map(async (task) => {
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
        title: `Parallel digs (${params.tasks.length})`,
        metadata: {
          count: params.tasks.length,
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
      const outcomes = await Promise.allSettled(
        resolved.map(async ({ task, agent }) =>
          runOneTask({
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
          }).catch(async (error) => {
            await cancelStarted()
            throw error
          }),
        ),
      )
      const rejected = outcomes.find((outcome) => outcome.status === "rejected")
      const settled = outcomes.flatMap((outcome) => (outcome.status === "fulfilled" ? [outcome.value] : []))
      const stopped = new Set(settled.map((outcome) => outcome.task_id))
      for (const outcome of settled) {
        await fireSubagentStop({
          sessionID: outcome.task_id,
          agent: outcome.subagent_type,
          status: outcome.ok ? "completed" : "failed",
        })
      }
      if (rejected) {
        await cancelStarted()
        for (const child of started) {
          if (stopped.has(child.sessionID)) continue
          await fireSubagentStop({
            sessionID: child.sessionID,
            agent: child.agent,
            status: "failed",
          })
          stopped.add(child.sessionID)
        }
        throw rejected.reason
      }

      const okCount = settled.filter((r) => r.ok).length
      const lines = settled.map((result, index) => {
        const header = `### ${index + 1}. ${result.description} (@${result.subagent_type})`
        const status = result.ok ? "ok" : "failed"
        const body = result.ok ? result.text : [result.error, result.text].filter(Boolean).join("\n") || "No output"
        return [
          header,
          `status: ${status}`,
          `task_id: ${result.task_id}`,
          "",
          "<task_result>",
          body,
          "</task_result>",
        ].join("\n")
      })

      return {
        title: `Parallel digs ${okCount}/${settled.length} ok`,
        metadata: {
          results: settled.map((r) => ({
            description: r.description,
            subagent_type: r.subagent_type,
            task_id: r.task_id,
            ok: r.ok,
            error: r.error,
          })),
          writers: isolation.writers,
          readers: isolation.readers,
        },
        output: [
          `Parallel explore finished: ${okCount}/${settled.length} succeeded.`,
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
