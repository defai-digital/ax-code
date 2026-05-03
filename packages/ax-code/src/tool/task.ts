import { Tool } from "./tool"
import DESCRIPTION from "./task.txt"
import z from "zod"
import { Session } from "../session"
import { SessionID, MessageID } from "../session/schema"
import { NotFoundError } from "../storage/db"
import { MessageV2 } from "../session/message-v2"
import { Identifier } from "../id/id"
import { Agent } from "../agent/agent"
import { SessionPrompt } from "../session/prompt"
import { iife } from "@/util/iife"
import { defer } from "@/util/defer"
import { Config } from "../config/config"
import { Permission } from "@/permission"
import { Log } from "@/util/log"
import { withTimeout } from "@/util/timeout"

const MAX_DEPTH = 5
// 10 minutes: subagent tasks that exceed this are likely stuck on a
// non-responsive provider or in an infinite tool loop. The step limit
// (200) catches runaway tool loops, but a provider that accepts the
// request and then never streams tokens would hang forever without
// this timeout.
const SUBAGENT_TIMEOUT_MS = 10 * 60 * 1000
const log = Log.create({ service: "task-tool" })

const parameters = z.object({
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
})

export const TaskTool = Tool.define("task", async (ctx) => {
  const agents = await Agent.list().then((x) =>
    x.filter((a) => {
      const tier = Agent.resolveTier(a)
      return tier === "subagent" || tier === "specialist"
    }),
  )

  // Filter agents by permissions if agent provided
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
    async execute(params: z.infer<typeof parameters>, ctx) {
      let depth = 0
      let parent: SessionID | undefined = ctx.sessionID
      let aborted = false

      const markAborted = () => {
        aborted = true
      }
      const ensureNotAborted = () => {
        if (ctx.abort.aborted || aborted) throw new DOMException("Aborted", "AbortError")
      }

      ctx.abort.addEventListener("abort", markAborted, { once: true })
      using _ = defer(() => ctx.abort.removeEventListener("abort", markAborted))

      const config = await Config.get()
      ensureNotAborted()
      while (parent) {
        ensureNotAborted()
        const current: Awaited<ReturnType<typeof Session.get>> | undefined = await Session.get(parent).catch((e) => {
          log.warn("failed to look up parent session for depth check", { parent, error: e })
          return undefined
        })
        ensureNotAborted()
        if (!current?.parentID) break
        depth++
        if (depth >= MAX_DEPTH) {
          throw new Error(`Maximum subagent nesting depth (${MAX_DEPTH}) exceeded`)
        }
        parent = current.parentID
      }

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
      if (!agent) throw new Error(`Unknown agent type: ${params.subagent_type} is not a valid agent type`)

      const hasTaskPermission = agent.permission.some((rule) => rule.permission === "task")
      let subagentSessionID: SessionID | undefined

      function cancelSubagent() {
        if (!subagentSessionID) return
        void SessionPrompt.cancel(subagentSessionID).catch((error) => {
          log.warn("failed to cancel aborted subagent session", {
            sessionID: subagentSessionID,
            error,
          })
        })
      }
      ctx.abort.addEventListener("abort", cancelSubagent, { once: true })
      using _cancelSubagent = defer(() => ctx.abort.removeEventListener("abort", cancelSubagent))

      const session = await iife(async () => {
        if (params.task_id) {
          const found = await Session.get(SessionID.make(params.task_id)).catch((e) => {
            if (NotFoundError.isInstance(e)) return undefined
            throw e
          })
          if (found && found.parentID === ctx.sessionID) return found
          if (found) throw new Error("Cannot resume a session that is not a child of the current session")
        }

        return await Session.create({
          parentID: ctx.sessionID,
          title: params.description + ` (@${agent.name} subagent)`,
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
      })
      subagentSessionID = session.id
      if (ctx.abort.aborted || aborted) cancelSubagent()
      const msg = await MessageV2.get({ sessionID: ctx.sessionID, messageID: ctx.messageID })
      ensureNotAborted()
      if (msg.info.role !== "assistant") throw new Error("Not an assistant message")

      const model = agent.model ?? {
        modelID: msg.info.modelID,
        providerID: msg.info.providerID,
      }

      let result: Awaited<ReturnType<typeof SessionPrompt.prompt>>
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
        const promptParts = await SessionPrompt.resolvePromptParts(params.prompt)

        result = await withTimeout(
          SessionPrompt.prompt({
            messageID,
            sessionID: session.id,
            model: {
              modelID: model.modelID,
              providerID: model.providerID,
            },
            agent: agent.name,
            tools: {
              todowrite: false,
              todoread: false,
              ...(hasTaskPermission ? {} : { task: false }),
              ...Object.fromEntries((config.experimental?.primary_tools ?? []).map((t) => [t, false])),
            },
            parts: promptParts,
          }),
          SUBAGENT_TIMEOUT_MS,
          `Subagent timed out after ${SUBAGENT_TIMEOUT_MS / 60_000} minutes — provider may be unresponsive`,
        )
      } catch (e) {
        // Cancel the in-flight processor before removing the session.
        // Without this, a timed-out subagent's processor continues
        // running (making LLM calls, executing tools) in the background
        // even though the parent has moved on.
        await SessionPrompt.cancel(session.id).catch((error) => {
          log.warn("failed to cancel subagent session after task error", {
            sessionID: session.id,
            error,
          })
        })
        await Session.remove(session.id).catch((error) => {
          log.warn("failed to remove session after task error", { sessionID: session.id, error })
        })
        throw e
      }

      const text = result.parts.findLast((x) => x.type === "text")?.text ?? ""

      const output = [
        `task_id: ${session.id} (for resuming to continue this task if needed)`,
        "",
        "<task_result>",
        text,
        "</task_result>",
      ].join("\n")

      return {
        title: params.description,
        metadata: {
          sessionId: session.id,
          model,
        },
        output,
      }
    },
  }
})
