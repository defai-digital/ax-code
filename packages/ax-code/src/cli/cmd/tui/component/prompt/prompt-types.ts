import type { Accessor, JSX } from "solid-js"
import type { PromptInfo } from "./history"

export type PromptProps = {
  sessionID?: string
  workspaceID?: string
  visible?: boolean
  disabled?: boolean
  onSubmit?: () => void
  ref?: (ref: PromptRef) => void
  hint?: JSX.Element
  showPlaceholder?: boolean
  sidebarVisible?: Accessor<boolean>
  statusTick?: Accessor<number>
}

export type PromptRef = {
  focused: boolean
  current: PromptInfo
  set(prompt: PromptInfo): void
  reset(): void
  blur(): void
  focus(): void
  submit(): void
}

export type AsyncSessionRoute = "prompt_async" | "command_async" | "shell_async"
