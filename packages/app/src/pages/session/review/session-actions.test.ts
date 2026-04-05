import { describe, expect, test } from "bun:test"

import { createTodoFollowupDraft, openHandoffReviewAction, runPromptAction } from "./session-actions"

describe("runPromptAction", () => {
  test("sets a quick prompt and schedules focus", () => {
    const seen: { text?: string; cursor?: number; focused: boolean } = { focused: false }

    runPromptAction({
      text: "Explain this change",
      set: (prompt, cursor) => {
        seen.text = prompt[0]?.type === "text" ? prompt[0].content : undefined
        seen.cursor = cursor
      },
      focus: () => {
        seen.focused = true
      },
      defer: (fn) => fn(),
    })

    expect(seen).toEqual({
      text: "Explain this change",
      cursor: "Explain this change".length,
      focused: true,
    })
  })
})

describe("openHandoffReviewAction", () => {
  test("opens mobile changes when not on desktop", () => {
    const seen: string[] = []

    openHandoffReviewAction({
      desktop: false,
      file: "src/app.ts",
      setMobileTab: () => seen.push("mobile"),
      focusReviewDiff: () => seen.push("file"),
      openReviewPanel: () => seen.push("panel"),
    })

    expect(seen).toEqual(["mobile"])
  })

  test("focuses the first diff on desktop when available", () => {
    const seen: string[] = []

    openHandoffReviewAction({
      desktop: true,
      file: "src/app.ts",
      setMobileTab: () => seen.push("mobile"),
      focusReviewDiff: (file) => seen.push(file),
      openReviewPanel: () => seen.push("panel"),
    })

    expect(seen).toEqual(["src/app.ts"])
  })

  test("opens the review panel on desktop when no diff is selected", () => {
    const seen: string[] = []

    openHandoffReviewAction({
      desktop: true,
      setMobileTab: () => seen.push("mobile"),
      focusReviewDiff: () => seen.push("file"),
      openReviewPanel: () => seen.push("panel"),
    })

    expect(seen).toEqual(["panel"])
  })
})

describe("createTodoFollowupDraft", () => {
  test("builds a followup draft from the current agent and model", () => {
    const draft = createTodoFollowupDraft({
      sessionID: "s1",
      sessionDirectory: "/tmp/project",
      step: "run tests",
      agent: { name: "build" },
      model: { id: "gpt-5", provider: { id: "openai" } },
      variant: "fast",
      t: (key, vars) => (key === "session.todo.queue.prompt" ? `Queue ${vars?.step}` : key),
    })

    expect(draft).toEqual({
      sessionID: "s1",
      sessionDirectory: "/tmp/project",
      prompt: [{ type: "text", content: "Queue run tests", start: 0, end: 15 }],
      context: [],
      agent: "build",
      model: { providerID: "openai", modelID: "gpt-5" },
      variant: "fast",
    })
  })

  test("returns nothing when queue context is incomplete", () => {
    expect(
      createTodoFollowupDraft({
        sessionDirectory: "/tmp/project",
        step: "run tests",
        t: (key) => key,
      }),
    ).toBeUndefined()
  })
})
