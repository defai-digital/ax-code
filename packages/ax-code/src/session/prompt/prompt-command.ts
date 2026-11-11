import { NamedError } from "@ax-code/util/error"
import { Command } from "../../command"
import { isCliProviderID } from "../../provider/cli/ids"
import { Session } from ".."
import type { SessionID } from "../schema"

/**
 * Built-ins that can only work by having the turn's model call an AX Code tool.
 * CLI providers run the vendor's own agent loop and never receive those tools,
 * so a CLI-model session can never run them. Custom and other built-in commands
 * are unaffected.
 */
const AX_TOOL_ONLY_BUILTINS = new Set<string>([Command.Default.COUNCIL, Command.Default.ARENA])

/** Whether a command is a built-in that can only work through an AX Code tool. */
export function isAxToolOnlyBuiltinCommand(command: { scope?: string; name: string }): boolean {
  return command.scope === "builtin" && AX_TOOL_ONLY_BUILTINS.has(command.name)
}

export function rejectAxToolOnlyCommandOnCliModel(input: {
  sessionID: SessionID
  command: NonNullable<Awaited<ReturnType<typeof Command.get>>>
  modelProviderID: string
}) {
  if (!isAxToolOnlyBuiltinCommand(input.command)) return
  if (!isCliProviderID(input.modelProviderID)) return
  const error = new NamedError.Unknown({
    message:
      `Command "/${input.command.name}" needs a non-CLI (API) model. ` +
      `The selected model uses CLI provider "${input.modelProviderID}", which runs the vendor's own agent loop ` +
      `and cannot call AX Code tools such as council or arena. Switch to an API model and retry.`,
  })
  Session.publishError({ sessionID: input.sessionID, error: error.toObject() })
  throw error
}

export async function resolveCommandForExecution(input: {
  sessionID: SessionID
  name: string
}): Promise<NonNullable<Awaited<ReturnType<typeof Command.get>>>> {
  const command = await Command.get(input.name)
  if (command) return command

  const available = await Command.list().then((cmds) => cmds.map((cmd) => cmd.name))
  const hint = available.length ? ` Available commands: ${available.join(", ")}` : ""
  const error = new NamedError.Unknown({ message: `Command not found: "${input.name}".${hint}` })
  Session.publishError({ sessionID: input.sessionID, error: error.toObject() })
  throw error
}

export function validateCommandArguments(input: {
  sessionID: SessionID
  command: NonNullable<Awaited<ReturnType<typeof Command.get>>>
  arguments: string
}) {
  if (!input.command.requiresArguments || input.arguments.trim()) return
  const hint = input.command.argumentHint ? ` ${input.command.argumentHint}` : " <argument>"
  const error = new NamedError.Unknown({
    message: `Command "${input.command.name}" requires an argument. Usage: /${input.command.name}${hint}`,
  })
  Session.publishError({ sessionID: input.sessionID, error: error.toObject() })
  throw error
}
