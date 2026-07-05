import type { useI18n } from "@/lib/i18n"
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
  canStartSessionCommand,
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

  if (canStartSessionCommand) {
    commands.push(
      {
        id: "openchamber:workspace-review",
        name: "workspace-review",
        source: "openchamber",
        description: t("chat.commandAutocomplete.command.workspaceReviewDescription"),
        isOpenChamber: true,
      },
      {
        id: "openchamber:plan-feature",
        name: "plan-feature",
        source: "openchamber",
        description: t("chat.commandAutocomplete.command.featurePlanDescription"),
        isOpenChamber: true,
      },
      {
        id: "openchamber:catch-up",
        name: "catch-up",
        source: "openchamber",
        description: t("chat.commandAutocomplete.command.catchUpDescription"),
        isOpenChamber: true,
      },
      {
        id: "openchamber:debug",
        name: "debug",
        source: "openchamber",
        description: t("chat.commandAutocomplete.command.debugDescription"),
        isOpenChamber: true,
      },
      {
        id: "openchamber:weigh",
        name: "weigh",
        source: "openchamber",
        description: t("chat.commandAutocomplete.command.weighDescription"),
        isOpenChamber: true,
      },
      {
        id: "openchamber:explore",
        name: "explore",
        source: "openchamber",
        description: t("chat.commandAutocomplete.command.exploreDescription"),
        isOpenChamber: true,
      },
    )
  }

  return commands
}
