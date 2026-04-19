import { unwrap } from "solid-js/store"
import type { PromptInfo } from "../../component/prompt/history"
import type { SessionRoute } from "../../context/route"

export function createAutoSubmitSessionRoute(input: {
  sessionID: string
  initialPrompt: PromptInfo
}): SessionRoute {
  return {
    type: "session",
    sessionID: input.sessionID,
    initialPrompt: structuredClone(unwrap(input.initialPrompt)),
    autoSubmit: true,
  }
}

export function initialPromptAutoSubmitKey(input: {
  sessionID: string
  autoSubmit?: boolean
  initialPromptInput?: string
}) {
  if (!input.autoSubmit) return
  if (!input.initialPromptInput) return
  return `${input.sessionID}:${input.initialPromptInput}`
}

export function shouldAutoSubmitInitialPrompt(input: {
  sessionID: string
  autoSubmit?: boolean
  initialPromptInput?: string
  currentInput?: string
  syncReady: boolean
  modelReady: boolean
  submittedKey?: string
}) {
  const key = initialPromptAutoSubmitKey(input)
  if (!key) return false
  if (input.submittedKey === key) return false
  if (!input.syncReady || !input.modelReady) return false
  return input.currentInput === input.initialPromptInput
}
