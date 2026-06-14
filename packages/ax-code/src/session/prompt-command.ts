import { NamedError } from "@ax-code/util/error"
import { Command } from "../command"
import { Session } from "."
import type { SessionID } from "./schema"

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
