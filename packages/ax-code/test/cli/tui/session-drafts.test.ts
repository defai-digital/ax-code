import { describe, expect, test, vi } from "vitest"
import {
  applyInitialPromptDraft,
  createSessionPromptDraftLifecycle,
  createSessionPromptDrafts,
  promptDraftKey,
  type SessionPromptDraft,
} from "../../../src/cli/cmd/tui/component/prompt/session-drafts"
import { promptPartExtmarkView } from "../../../src/cli/cmd/tui/component/prompt/prompt-helpers"

function draft(text = ""): SessionPromptDraft {
  return { prompt: { input: text, parts: [] }, mode: "normal", cursor: text.length, expandedPastes: [] }
}

function editor(drafts: ReturnType<typeof createSessionPromptDrafts>, sessionID?: string, directory = "/workspace") {
  let current = draft()
  const restore = vi.fn((saved: SessionPromptDraft) => {
    current = saved
  })
  const lifecycle = createSessionPromptDraftLifecycle({
    drafts,
    key: promptDraftKey(directory, sessionID),
    read: () => current,
    restore,
  })
  lifecycle.restore()
  return {
    lifecycle,
    restore,
    get current() {
      return current
    },
    edit(next: SessionPromptDraft) {
      current = next
      lifecycle.edited()
    },
  }
}

describe("session-owned prompt drafts", () => {
  test("does not carry A input into B and restores each draft on return", () => {
    const drafts = createSessionPromptDrafts()
    const a = editor(drafts, "A")
    a.edit(draft("Only for session A"))
    a.lifecycle.dispose()
    const b = editor(drafts, "B")
    expect(b.current.prompt.input).toBe("")
    b.edit(draft("Only for session B"))
    b.lifecycle.dispose()
    expect(editor(drafts, "A").current.prompt.input).toBe("Only for session A")
    expect(editor(drafts, "B").current.prompt.input).toBe("Only for session B")
  })

  test("isolates Home and equal session IDs belonging to different workspaces", () => {
    const drafts = createSessionPromptDrafts()
    const home = editor(drafts)
    home.edit(draft("Unsubmitted Home draft"))
    home.lifecycle.dispose()
    const a = editor(drafts, "A")
    a.edit(draft("Workspace A"))
    a.lifecycle.dispose()
    expect(editor(drafts, "A", "/elsewhere").current.prompt.input).toBe("")
    expect(editor(drafts, "A").current.prompt.input).toBe("Workspace A")
    expect(editor(drafts).current.prompt.input).toBe("Unsubmitted Home draft")
  })

  test("preserves attachment bodies, reconstructible extmark ranges, cursor, shell mode and paste previews", () => {
    const drafts = createSessionPromptDrafts()
    const a = editor(drafts, "A")
    const attachment: SessionPromptDraft = {
      prompt: {
        input: "Review [Pasted text]",
        parts: [
          {
            type: "text",
            text: "Full multiline source\nSecond line",
            source: { text: { start: 7, end: 20, value: "[Pasted text]" } },
          },
        ],
      },
      mode: "shell",
      cursor: 4,
      expandedPastes: [0],
    }
    a.edit(attachment)
    a.lifecycle.dispose()
    const restored = editor(drafts, "A").current
    expect(restored).toEqual(attachment)
    expect(
      promptPartExtmarkView(restored.prompt.parts[0], { fileStyleId: 1, pasteStyleId: 2, agentStyleId: 3 }),
    ).toMatchObject({ start: 7, end: 20, styleId: 2, virtualText: "[Pasted text]" })
    expect(editor(drafts, "B").current).toEqual(draft())
  })

  test("snapshots parts independently so a disposed editor cannot mutate another mount", () => {
    const drafts = createSessionPromptDrafts()
    const a = editor(drafts, "A")
    const original = draft("keep")
    original.prompt.parts.push({ type: "text", text: "keep attachment" })
    a.edit(original)
    a.lifecycle.dispose()
    original.prompt.input = "late mutation"
    original.prompt.parts[0] = { type: "text", text: "late attachment" }
    expect(editor(drafts, "A").current.prompt).toEqual({
      input: "keep",
      parts: [{ type: "text", text: "keep attachment" }],
    })
  })

  test("does not resurrect a successful Home submission left visible during route handoff", () => {
    const drafts = createSessionPromptDrafts()
    const home = editor(drafts)
    home.edit(draft("Submitted task"))
    home.lifecycle.submitted()
    home.lifecycle.dispose()
    expect(editor(drafts, "created-session").current.prompt.input).toBe("")
    expect(editor(drafts).current.prompt.input).toBe("")
  })

  test("preserves unsubmitted input after failed or cancelled submission", () => {
    const drafts = createSessionPromptDrafts()
    const home = editor(drafts)
    home.edit(draft("Retry this task"))
    // Failure/cancellation does not call the accepted-submit callback.
    home.lifecycle.dispose()
    expect(editor(drafts).current.prompt.input).toBe("Retry this task")
  })

  test("keeps newly typed input after a previous successful submission", () => {
    const drafts = createSessionPromptDrafts()
    const a = editor(drafts, "A")
    a.edit(draft("Submitted"))
    a.lifecycle.submitted()
    a.edit(draft("Next instruction"))
    a.lifecycle.dispose()
    expect(editor(drafts, "A").current.prompt.input).toBe("Next instruction")
  })

  test("clearing a restored draft prevents it from returning on another mount", () => {
    const drafts = createSessionPromptDrafts()
    const a = editor(drafts, "A")
    a.edit(draft("To clear"))
    a.lifecycle.dispose()
    const restored = editor(drafts, "A")
    restored.edit(draft())
    restored.lifecycle.dispose()
    expect(editor(drafts, "A").restore).not.toHaveBeenCalled()
  })

  test("retains empty shell mode while new sessions begin in normal mode", () => {
    const drafts = createSessionPromptDrafts()
    const a = editor(drafts, "A")
    a.edit({ ...draft(), mode: "shell" })
    a.lifecycle.dispose()
    expect(editor(drafts, "A").current.mode).toBe("shell")
    expect(editor(drafts, "B").current.mode).toBe("normal")
  })
})

describe("route draft mount handoff", () => {
  test("does not overwrite the previous editor while the next session is loading", () => {
    const drafts = createSessionPromptDrafts()
    const old = editor(drafts, "A")
    old.edit(draft("Keep A untouched"))
    old.lifecycle.dispose()
    // No ref exists while B loads; application occurs only after B mounts.
    let initial: SessionPromptDraft["prompt"] | undefined = { input: "Fork draft for B", parts: [] }
    const next = editor(drafts, "B")
    applyInitialPromptDraft({
      initial,
      set: (prompt) => next.edit({ ...draft(), prompt }),
      consume: () => {
        initial = undefined
      },
    })
    expect(initial).toBeUndefined()
    expect(next.current.prompt.input).toBe("Fork draft for B")
    expect(editor(drafts, "A").current.prompt.input).toBe("Keep A untouched")
  })

  test("keeps the route draft available when the mounted editor rejects restoration", () => {
    const consume = vi.fn()
    expect(() =>
      applyInitialPromptDraft({
        initial: { input: "Retry restore", parts: [] },
        set: () => {
          throw new Error("Editor unavailable")
        },
        consume,
      }),
    ).toThrow("Editor unavailable")
    expect(consume).not.toHaveBeenCalled()
  })
})
