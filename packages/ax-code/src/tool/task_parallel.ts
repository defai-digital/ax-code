import { Tool } from "./tool"
import DESCRIPTION from "./task_parallel.txt"
import z from "zod"
import { Session } from "../session"
import { SessionID, MessageID } from "../session/schema"
import { NotFoundError } from "../storage/db"
import { MessageV2 } from "../session/message-v2"
import { Agent } from "../agent/agent"
import { SessionPrompt } from "../session/prompt"
import { resolvePromptParts } from "../session/prompt-helpers"
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

function assistantError(result: Awaited<ReturnType<typeof SessionPrompt.prompt>>) {
  if (result.info.role !== "assistant") return undefined
  return result.info.error
}

function assistantErrorMessage(error: NonNullable<MessageV2.Assistant["error"]>) {
  const data = error.data as { message?: unknown } | undefined
  return typeof data?.message === "string" ? data.message : error.name
}

function errorDetails(error: unknown) {
  if (error instanceof Error) {
    return {
      name: error.name || "Error",
      message: error.message || error.name || "Unknown error",
    }
  }
  if (typeof error === "string") {
    return { name: "Error", message: error }
  }
  return { name: "Error", message: "Unknown error" }
}

function isAbortError(error: unknown) {
  return error instanceof DOMException && error.name === "AbortError"
}

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

async function runOneTask(input: {
  params: TaskItemInput
  ctx: Tool.Context
  model: { modelID: ModelID; providerID: ProviderID }
  config: Awaited<ReturnType<typeof Config.get>>
  agent: Agent.Info
}): Promise<{
  description: string
  subagent_type: string
  task_id: string
  ok: boolean
  text: string
  error?: string
}> {
  const { params, ctx, model, config, agent } = input
  const hasTaskPermission = agent.permission.some((rule) => rule.permission === "task")

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
      ...(hasTaskPermission
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
        action: "allow" as const,
        permission: t,
      })) ?? []),
    ],
  })

  const cancel = () => {
    void SessionPrompt.cancel(session.id).catch((error) => {
      log.warn("failed to cancel parallel subagent", { sessionID: session.id, error })
    })
  }
  ctx.abort.addEventListener("abort", cancel, { once: true })
  using _ = defer(() => ctx.abort.removeEventListener("abort", cancel))

  const taskTools = {
    todowrite: false,
    todoread: false,
    task: false,
    task_parallel: false,
    ...Object.fromEntries((config.experimental?.primary_tools ?? []).map((t) => [t, false])),
  }

  try {
    if (ctx.abort.aborted) throw new DOMException("Aborted", "AbortError")
    const promptParts = await resolvePromptParts(params.prompt)
    let result = await withTimeout(
      SessionPrompt.prompt({
        messageID: MessageID.ascending(),
        sessionID: session.id,
        model,
        agent: agent.name,
        tools: taskTools,
        parts: promptParts,
      }),
      SUBAGENT_TIMEOUT_MS,
      `Subagent timed out after ${SUBAGENT_TIMEOUT_MS / 60_000} minutes`,
    )

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
            tools: { ...taskTools, task: false, task_parallel: false },
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

      const settled = await Promise.all(
        resolved.map(({ task, agent }) =>
          runOneTask({
            params: task,
            ctx: toolCtx,
            model: agent.model ?? defaultModel,
            config,
            agent,
          }),
        ),
      )

      const okCount = settled.filter((r) => r.ok).length
      const lines = settled.map((result, index) => {
        const header = `### ${index + 1}. ${result.description} (@${result.subagent_type})`
        const status = result.ok ? "ok" : "failed"
        const body = result.ok
          ? result.text
          : [result.error, result.text].filter(Boolean).join("\n") || "No output"
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
