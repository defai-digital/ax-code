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
import { resolvePromptParts } from "../session/prompt-helpers"
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
const SUBAGENT_FINALIZE_TIMEOUT_MS = 2 * 60 * 1000
const log = Log.create({ service: "task-tool" })

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
    return {
      name: "Error",
      message: error,
    }
  }
  return {
    name: "Error",
    message: "Unknown error",
  }
}

function isAbortError(error: unknown) {
  return error instanceof DOMException && error.name === "AbortError"
}

function needsRecoveredResultReview(text: string) {
  return /\b(?:incomplete|unresolved|insufficient|no usable|not enough evidence|unable to determine|could not verify|needs? validation|requires? validation)\b/i.test(
    text,
  )
}

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

      ctx.abort.addEventListener("abort", markAborted, { once: true })
      using _ = defer(() => ctx.abort.removeEventListener("abort", markAborted))
      ctx.abort.addEventListener("abort", cancelSubagent, { once: true })
      using _cancelSubagent = defer(() => ctx.abort.removeEventListener("abort", cancelSubagent))

      const config = await Config.get()
      ensureNotAborted()
      while (parent) {
        ensureNotAborted()
        const current: Awaited<ReturnType<typeof Session.get>> | undefined = await Session.get(parent).catch((e) => {
          if (NotFoundError.isInstance(e)) return undefined
          throw e
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
      ensureNotAborted()
      if (!agent) throw new Error(`Unknown agent type: ${params.subagent_type} is not a valid agent type`)

      const hasTaskPermission = agent.permission.some((rule) => rule.permission === "task")

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

      const taskTools = {
        todowrite: false,
        todoread: false,
        ...(hasTaskPermission ? {} : { task: false }),
        ...Object.fromEntries((config.experimental?.primary_tools ?? []).map((t) => [t, false])),
      }
      let result: Awaited<ReturnType<typeof SessionPrompt.prompt>>
      let finalizeAttempted = false
      let finalizeError: ReturnType<typeof errorDetails> | undefined
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

        result = await withTimeout(
          SessionPrompt.prompt({
            messageID,
            sessionID: session.id,
            model: {
              modelID: model.modelID,
              providerID: model.providerID,
            },
            agent: agent.name,
            tools: taskTools,
            parts: promptParts,
          }),
          SUBAGENT_TIMEOUT_MS,
          `Subagent timed out after ${SUBAGENT_TIMEOUT_MS / 60_000} minutes — provider may be unresponsive`,
        )

        let text = result.parts.findLast((x) => x.type === "text")?.text ?? ""
        const firstError = assistantError(result)
        if (text.trim().length === 0 && !firstError) {
          finalizeAttempted = true
          const finalizeMessageID = MessageID.ascending()
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
                tools: {
                  ...taskTools,
                  task: false,
                },
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
        return {
          title: params.description,
          metadata: {
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
          },
          output: [
            `task_id: ${session.id} (for resuming to continue this task if needed)`,
            "",
            "<task_result>",
            recoverableText,
            "</task_result>",
          ].join("\n"),
        }
      }

      const text = result.parts.findLast((x) => x.type === "text")?.text ?? ""
      const error = assistantError(result)
      const emptyResult = text.trim().length === 0
      const recoveredFromEmpty = finalizeAttempted && !emptyResult
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
      ].join("\n")

      return {
        title: params.description,
        metadata: {
          sessionId: session.id,
          model,
          emptyResult,
          finalizeAttempted,
          recoveredFromEmpty,
          recoveredResultNeedsReview,
          subagentError: !!error || !!finalizeError,
          errorName: error?.name ?? finalizeError?.name,
          errorMessage: error ? assistantErrorMessage(error) : finalizeError?.message,
          finalizeError: !!finalizeError,
          finalizeErrorName: finalizeError?.name,
          finalizeErrorMessage: finalizeError?.message,
        },
        output,
      }
    },
  }
})
