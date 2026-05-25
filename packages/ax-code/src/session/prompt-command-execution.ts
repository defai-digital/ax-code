import { Bus } from "../bus"
import { Command } from "../command"
import { Plugin } from "../plugin"
import { Log } from "../util/log"
import type { MessageV2 } from "./message-v2"
import { commandSetup } from "./prompt-command-setup"
import { resolveCommandForExecution } from "./prompt-command"
import { executeGoalCommand } from "./prompt-goal-command"
import type { CommandInput, PromptInput } from "./prompt-input"

const log = Log.create({ service: "session.prompt" })

type PromptRunner = (input: PromptInput) => Promise<MessageV2.WithParts>

export async function executePromptCommand(input: CommandInput, prompt: PromptRunner) {
  log.info("command", {
    command: "session.prompt.command",
    status: "started",
    sessionID: input.sessionID,
    commandName: input.command,
  })
  if (input.command === Command.Default.GOAL) {
    return executeGoalCommand(input, prompt)
  }
  const command = await resolveCommandForExecution({ sessionID: input.sessionID, name: input.command })
  const prepared = await commandSetup({
    command,
    name: input.command,
    arguments: input.arguments,
    sessionID: input.sessionID,
    agent: input.agent,
    model: input.model,
    parts: input.parts,
  })

  await Plugin.trigger(
    "command.execute.before",
    {
      command: input.command,
      sessionID: input.sessionID,
      arguments: input.arguments,
    },
    { parts: prepared.parts },
  )

  const result = await prompt({
    sessionID: input.sessionID,
    messageID: input.messageID,
    model: prepared.user.model,
    agent: prepared.user.agent,
    parts: prepared.parts,
    variant: input.variant,
  })

  Bus.publishDetached(Command.Event.Executed, {
    name: input.command,
    sessionID: input.sessionID,
    arguments: input.arguments,
    messageID: result.info.id,
  })

  return result
}
