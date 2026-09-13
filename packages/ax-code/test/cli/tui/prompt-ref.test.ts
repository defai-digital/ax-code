import { readFileSync } from "node:fs"
import path from "node:path"
import { describe, expect, test } from "vitest"
import { createPromptRefState } from "../../../src/cli/cmd/tui/context/prompt"
import type { PromptRef } from "../../../src/cli/cmd/tui/component/prompt"

function stubPrompt(input: string): PromptRef {
  const prompt = { input, parts: [] as PromptRef["current"]["parts"] }
  return {
    focused: false,
    get current() {
      return prompt
    },
    set() {},
    reset() {},
    blur() {},
    focus() {},
    submit() {},
  }
}

describe("prompt ref", () => {
  test("stores the mounted Prompt so recap can read input after Prompt appears", () => {
    const promptRef = createPromptRefState()
    expect(promptRef.current).toBeUndefined()
    promptRef.set(stubPrompt("hello"))
    expect(promptRef.current?.current.input).toBe("hello")
  })

  test("IdleRecap reads prompt input through the reactive PromptRef current getter", () => {
    const root = path.resolve(import.meta.dirname, "../../../src/cli/cmd/tui")
    const prompt = readFileSync(path.join(root, "context/prompt.tsx"), "utf8")
    const recap = readFileSync(path.join(root, "routes/session/idle-recap.tsx"), "utf8")
    expect(prompt).toContain("createSignal")
    expect(prompt).toContain("createPromptRefState")
    expect(recap).toContain("promptRef.current?.current.input")
  })
})
