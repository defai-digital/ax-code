import { Agent } from "../agent/agent"
import { MCP } from "../mcp"
import { Permission } from "../permission"
import { Session } from "."
import { agentInfo, modelInfo } from "./prompt-agent-model-info"
import { commandParts } from "./prompt-command-parts"
import { commandModel, commandUser } from "./prompt-command-selection"
import { commandTemplateText } from "./prompt-command-template"
import type { SessionID } from "./schema"

export async function commandSetup(input: {
  command: {
    agent?: string
    model?: string
    template: string | Promise<string>
    description?: string
    subtask?: boolean
    mcpPrompt?: {
      client: string
      name: string
    }
  }
  name: string
  arguments: string
  sessionID: SessionID
  agent?: string
  model?: string
  parts?: unknown[]
}) {
  const agentName = input.command.agent ?? input.agent ?? (await Agent.defaultAgent())
  const agent = await agentInfo({
    sessionID: input.sessionID,
    name: agentName,
  })

  if (input.command.mcpPrompt) {
    const session = await Session.get(input.sessionID)
    const pattern = `prompt:${input.command.mcpPrompt.name}`
    await Permission.ask({
      sessionID: input.sessionID,
      permission: MCP.permissionKey("mcp_prompt", input.command.mcpPrompt.client),
      patterns: [pattern],
      always: [pattern],
      metadata: {
        mcp: true,
        kind: "prompt",
        clientName: input.command.mcpPrompt.client,
        promptName: input.command.mcpPrompt.name,
      },
      ruleset: Permission.merge(agent.permission, session.permission ?? []),
      agent: agentName,
    })
  }

  const taskModel = await commandModel({
    command: input.command,
    model: input.model,
    sessionID: input.sessionID,
  })
  await modelInfo({
    sessionID: input.sessionID,
    providerID: taskModel.providerID,
    modelID: taskModel.modelID,
  })

  const template = await commandTemplateText({
    template: await input.command.template,
    arguments: input.arguments,
  })

  const result = await commandParts({
    agent,
    command: input.command,
    name: input.name,
    model: taskModel,
    template,
    parts: input.parts,
  })

  const user = await commandUser({
    subtask: result.subtask,
    inputAgent: input.agent,
    inputModel: input.model,
    agentName,
    taskModel,
    sessionID: input.sessionID,
  })

  return {
    agent,
    agentName,
    model: taskModel,
    parts: result.parts,
    subtask: result.subtask,
    template,
    user,
  }
}
