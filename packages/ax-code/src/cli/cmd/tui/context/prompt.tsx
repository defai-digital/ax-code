import { createSignal } from "solid-js"
import { createSimpleContext } from "./helper"
import type { PromptRef } from "../component/prompt"

/** Holds the mounted Prompt ref. `current` is a Solid signal so readers that
 *  mount above Prompt (IdleRecap) re-run when the prompt appears and can then
 *  subscribe to `store.prompt.input`. A plain `let` never notified them. */
export function createPromptRefState() {
  const [current, setCurrent] = createSignal<PromptRef | undefined>()
  return {
    get current() {
      return current()
    },
    set(ref: PromptRef | undefined) {
      setCurrent(() => ref)
    },
  }
}

export const { use: usePromptRef, provider: PromptRefProvider } = createSimpleContext({
  name: "PromptRef",
  init: createPromptRefState,
})
