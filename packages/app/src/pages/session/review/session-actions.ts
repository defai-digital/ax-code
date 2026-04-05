import { quickPrompt } from "@/components/quick-starts"
import type { FollowupDraft } from "@/components/prompt-input/submit"
import type { Prompt } from "@/context/prompt"

type Agent = {
  name: string
}

type Model = {
  provider: {
    id: string
  }
  id: string
}

export const runPromptAction = (input: {
  text: string
  set: (prompt: Prompt, cursor?: number) => void
  focus: () => void
  defer?: (fn: () => void) => void
}) => {
  input.set(quickPrompt(input.text), input.text.length)
  ;(input.defer ?? requestAnimationFrame)(() => input.focus())
}

export const openHandoffReviewAction = (input: {
  desktop: boolean
  file?: string
  setMobileTab: () => void
  focusReviewDiff: (file: string) => void
  openReviewPanel: () => void
}) => {
  if (!input.desktop) {
    input.setMobileTab()
    return
  }
  if (input.file) {
    input.focusReviewDiff(input.file)
    return
  }
  input.openReviewPanel()
}

export const createTodoFollowupDraft = (input: {
  sessionID?: string
  sessionDirectory: string
  step: string
  agent?: Agent
  model?: Model
  variant?: string
  t: (key: string, vars?: Record<string, string | number | boolean>) => string
}) => {
  if (!input.sessionID || !input.agent || !input.model) return

  const text = input.t("session.todo.queue.prompt", { step: input.step })
  const draft: FollowupDraft = {
    sessionID: input.sessionID,
    sessionDirectory: input.sessionDirectory,
    prompt: quickPrompt(text),
    context: [],
    agent: input.agent.name,
    model: {
      providerID: input.model.provider.id,
      modelID: input.model.id,
    },
    variant: input.variant,
  }
  return draft
}
