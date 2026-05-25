/**
 * Subtask execution logic for the prompt loop.
 *
 * Extracted from prompt.ts to reduce file size and improve maintainability.
 */

import { ulid } from "ulid"
import { SessionID, MessageID, PartID } from "./schema"
import { MessageV2 } from "./message-v2"
import { Log } from "../util/log"
import { Session } from "."
import { Agent } from "../agent/agent"
import { Provider } from "../provider/provider"
import { Plugin } from "../plugin"
import { Instance } from "../project/instance"
import { TaskTool } from "@/tool/task"
import { Tool } from "@/tool/tool"
import { Permission } from "@/permission"
import { SessionStatus } from "./status"
import { agentInfo } from "./prompt-agent-model-info"

const log = Log.create({ service: "session.prompt.subtask" })

export interface SubtaskContext {
  sessionID: SessionID
  lastUser: MessageV2.User
  model: Provider.Model
  abort: AbortSignal
  msgs: MessageV2.WithParts[]
  session: Awaited<ReturnType<typeof Session.get>>
}

/**
 * Execute a subtask (agent delegation) within the prompt loop.
 * Creates an assistant message, executes the task tool, and handles
 * the result including attachments and error states.
 */
export async function executeSubtask(task: MessageV2.SubtaskPart, ctx: SubtaskContext) {
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
      await Permission.ask(
        {
          ...req,
          sessionID,
          ruleset: Permission.merge(taskAgent.permission, session.permission ?? []),
        },
        { signal: abort },
      )
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
  const finalParts: MessageV2.Part[] = []
  if (result && part.state.status === "running") {
    finalParts.push({
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
    finalParts.push({
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
  await Session.updateMessageWithParts(assistantMessage, finalParts)

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
