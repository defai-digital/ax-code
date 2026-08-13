import type { useI18n } from "@/lib/i18n"
import { fuzzyMatch } from "@/lib/utils"
import type { CommandInfo } from "./CommandAutocomplete"

type Translate = ReturnType<typeof useI18n>["t"]

interface BuiltInCommandsInput {
  hasSession: boolean
  hasMessagesInCurrentSession: boolean
  canStartSessionCommand: boolean
  t: Translate
}

export const buildBuiltInCommands = ({
  hasSession,
  hasMessagesInCurrentSession,
  t,
}: BuiltInCommandsInput): CommandInfo[] => {
  const commands: CommandInfo[] = []

  if (hasSession && !hasMessagesInCurrentSession) {
    commands.push({
      id: "openchamber:init",
      name: "init",
      source: "openchamber",
      description: t("chat.commandAutocomplete.command.initDescription"),
      isBuiltIn: true,
    })
  }

  if (hasSession) {
    commands.push(
      {
        id: "openchamber:undo",
        name: "undo",
        source: "openchamber",
        description: t("chat.commandAutocomplete.command.undoDescription"),
        isBuiltIn: true,
      },
      {
        id: "openchamber:redo",
        name: "redo",
        source: "openchamber",
        description: t("chat.commandAutocomplete.command.redoDescription"),
        isBuiltIn: true,
      },
      {
        id: "openchamber:timeline",
        name: "timeline",
        source: "openchamber",
        description: t("chat.commandAutocomplete.command.timelineDescription"),
        isBuiltIn: true,
      },
    )
  }

  commands.push({
    id: "openchamber:compact",
    name: "compact",
    source: "openchamber",
    description: t("chat.commandAutocomplete.command.compactDescription"),
    isBuiltIn: true,
  })

  if (hasSession) {
    commands.push({
      id: "openchamber:summary",
      name: "summary",
      source: "openchamber",
      description: t("chat.commandAutocomplete.command.summaryDescription"),
      isOpenChamber: true,
    })
  }

  return commands
}

export const filterCommandList = (
  commands: CommandInfo[],
  {
    searchQuery,
    allowInitCommand,
  }: {
    searchQuery: string
    allowInitCommand: boolean
  },
): CommandInfo[] => {
  const matched = searchQuery
    ? commands.filter(
        (command) =>
          fuzzyMatch(command.name, searchQuery) ||
          (command.description !== undefined && fuzzyMatch(command.description, searchQuery)),
      )
    : commands

  return matched.filter((command) => allowInitCommand || command.name !== "init")
}
