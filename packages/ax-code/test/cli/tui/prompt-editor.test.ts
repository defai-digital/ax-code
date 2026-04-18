import { describe, expect, test } from "bun:test"
import {
  canSubmitPromptEditor,
  createPromptEditorState,
  promptEditorSubmission,
  reducePromptEditor,
} from "../../../src/cli/cmd/tui/input/prompt-editor"

describe("tui prompt editor", () => {
  test("tracks pasted text parts as pure state and expands them on submission", () => {
    const state = reducePromptEditor(
      createPromptEditorState({
        input: "before after",
      }),
      {
        type: "paste.text",
        text: "line 1\nline 2",
        label: "[Pasted]",
        range: { start: 7, end: 7 },
      },
    )

    expect(state.input).toBe("before [Pasted]after")
    expect(state.parts).toHaveLength(1)
    expect(promptEditorSubmission(state)).toMatchObject({
      text: "before line 1\nline 2after",
      parts: [],
      mode: "normal",
    })
  })

  test("drops stale virtual parts when the visible token is edited away", () => {
    const pasted = reducePromptEditor(createPromptEditorState(), {
      type: "paste.text",
      text: "hello",
      label: "[Paste]",
    })

    const edited = reducePromptEditor(pasted, {
      type: "input.changed",
      value: pasted.input.replace("[Paste]", "hello"),
    })

    expect(edited.parts).toEqual([])
  })

  test("navigates prompt history and restores the draft when moving back", () => {
    let state = createPromptEditorState()
    state = reducePromptEditor(state, {
      type: "history.loaded",
      entries: [
        { input: "older", parts: [], mode: "normal" },
        { input: "newer", parts: [], mode: "shell" },
      ],
    })
    state = reducePromptEditor(state, {
      type: "input.changed",
      value: "draft",
    })

    state = reducePromptEditor(state, { type: "history.previous" })
    expect(state.input).toBe("newer")
    expect(state.mode).toBe("shell")

    state = reducePromptEditor(state, { type: "history.previous" })
    expect(state.input).toBe("older")

    state = reducePromptEditor(state, { type: "history.next" })
    expect(state.input).toBe("newer")

    state = reducePromptEditor(state, { type: "history.next" })
    expect(state.input).toBe("draft")
    expect(state.mode).toBe("normal")
  })

  test("clears and cancels without leaking shell mode or interrupt state", () => {
    let state = createPromptEditorState({
      input: "echo hi",
      mode: "shell",
      interrupt: 2,
      parts: [
        {
          type: "file",
          mime: "text/plain",
          url: "file:///repo/a.ts",
          filename: "a.ts",
        },
      ],
    })

    state = reducePromptEditor(state, { type: "prompt.cancelled" })
    expect(state.mode).toBe("normal")
    expect(state.input).toBe("echo hi")

    state = reducePromptEditor(state, { type: "prompt.cleared" })
    expect(state.input).toBe("")
    expect(state.parts).toEqual([])
    expect(state.interrupt).toBe(0)
  })

  test("commits successful submissions into local history and resets the editor", () => {
    let state = createPromptEditorState({
      input: "ship it",
    })

    expect(canSubmitPromptEditor(state)).toBe(true)

    state = reducePromptEditor(state, { type: "submission.committed" })

    expect(state.input).toBe("")
    expect(state.history.at(-1)).toMatchObject({ input: "ship it" })
    expect(canSubmitPromptEditor(state)).toBe(false)
  })
})
