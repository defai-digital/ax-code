export type FocusDialog =
  | "command"
  | "workspace"
  | "provider"
  | "model"
  | "agent"
  | "session"
  | "confirm"
  | "alert"
  | "custom"

export type FocusSelectionTarget = "transcript" | "prompt"

export type FocusOwner =
  | { type: "app" }
  | { type: "prompt" }
  | { type: "selection"; target: FocusSelectionTarget }
  | { type: "dialog"; dialog: FocusDialog }
  | { type: "permission"; sessionID?: string }
  | { type: "question"; sessionID?: string }

export type FocusSnapshot = {
  prompt: {
    visible: boolean
    disabled?: boolean
  }
  selection?: FocusSelectionTarget
  dialog?: FocusDialog
  permissionSessionID?: string
  questionSessionID?: string
}

export function resolveFocusOwner(input: FocusSnapshot): FocusOwner {
  if (input.questionSessionID) {
    return {
      type: "question",
      sessionID: input.questionSessionID,
    }
  }

  if (input.permissionSessionID) {
    return {
      type: "permission",
      sessionID: input.permissionSessionID,
    }
  }

  if (input.dialog) {
    return {
      type: "dialog",
      dialog: input.dialog,
    }
  }

  if (input.selection) {
    return {
      type: "selection",
      target: input.selection,
    }
  }

  if (input.prompt.visible && input.prompt.disabled !== true) {
    return { type: "prompt" }
  }

  return { type: "app" }
}

export function blocksPromptInput(owner: FocusOwner) {
  return owner.type !== "prompt"
}
