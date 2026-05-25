import { Agent } from "../agent/agent"
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
  }
  name: string
  arguments: string
  sessionID: SessionID
  agent?: string
  model?: string
  parts?: unknown[]
}) {
  const agentName = input.command.agent ?? input.agent ?? (await Agent.defaultAgent())
  const template = await commandTemplateText({
    template: await input.command.template,
    arguments: input.arguments,
  })

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

  const agent = await agentInfo({
    sessionID: input.sessionID,
    name: agentName,
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
