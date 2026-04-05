import { describe, expect, test } from "bun:test"
import { createMemo, createRoot } from "solid-js"
import { createStore } from "solid-js/store"
import {
  createOpenReviewFile,
  createOpenSessionFileTab,
  createSessionTabs,
  filterReviewDiffs,
  focusTerminalById,
  getTabReorderIndex,
  isSessionBusy,
  lastCompletedAssistant,
  nextUserMessage,
  promptDraftLine,
  reviewStats,
  revertPlan,
  rolledMessages,
  restorePlan,
  selectedReviewFile,
  shouldFocusTerminalOnKeyDown,
  updateSessionInfo,
  updateSessionRevert,
  visibleUserMessages,
} from "./helpers"

const user = (id: string) =>
  ({
    id,
    role: "user",
    sessionID: "s",
    parts: [],
    time: { created: 0 },
  }) as any

const assistant = (input: { id: string; parentID?: string; completed?: number; error?: unknown }) =>
  ({
    id: input.id,
    role: "assistant",
    sessionID: "s",
    parentID: input.parentID,
    parts: [],
    time: { created: 0, completed: input.completed },
    error: input.error,
  }) as any

describe("createOpenReviewFile", () => {
  test("opens and loads selected review file", () => {
    const calls: string[] = []
    const openReviewFile = createOpenReviewFile({
      showAllFiles: () => calls.push("show"),
      tabForPath: (path) => {
        calls.push(`tab:${path}`)
        return `file://${path}`
      },
      openTab: (tab) => calls.push(`open:${tab}`),
      setActive: (tab) => calls.push(`active:${tab}`),
      loadFile: (path) => calls.push(`load:${path}`),
    })

    openReviewFile("src/a.ts")

    expect(calls).toEqual(["show", "load:src/a.ts", "tab:src/a.ts", "open:file://src/a.ts", "active:file://src/a.ts"])
  })
})

describe("createOpenSessionFileTab", () => {
  test("activates the opened file tab", () => {
    const calls: string[] = []
    const openTab = createOpenSessionFileTab({
      normalizeTab: (value) => {
        calls.push(`normalize:${value}`)
        return `file://${value}`
      },
      openTab: (tab) => calls.push(`open:${tab}`),
      pathFromTab: (tab) => {
        calls.push(`path:${tab}`)
        return tab.slice("file://".length)
      },
      loadFile: (path) => calls.push(`load:${path}`),
      openReviewPanel: () => calls.push("review"),
      setActive: (tab) => calls.push(`active:${tab}`),
    })

    openTab("src/a.ts")

    expect(calls).toEqual([
      "normalize:src/a.ts",
      "open:file://src/a.ts",
      "path:file://src/a.ts",
      "load:src/a.ts",
      "review",
      "active:file://src/a.ts",
    ])
  })
})

describe("focusTerminalById", () => {
  test("focuses textarea when present", () => {
    document.body.innerHTML = `<div id="terminal-wrapper-one"><div data-component="terminal"><textarea></textarea></div></div>`

    const focused = focusTerminalById("one")

    expect(focused).toBe(true)
    expect(document.activeElement?.tagName).toBe("TEXTAREA")
  })

  test("falls back to terminal element focus", () => {
    document.body.innerHTML = `<div id="terminal-wrapper-two"><div data-component="terminal" tabindex="0"></div></div>`
    const terminal = document.querySelector('[data-component="terminal"]') as HTMLElement
    let pointerDown = false
    terminal.addEventListener("pointerdown", () => {
      pointerDown = true
    })

    const focused = focusTerminalById("two")

    expect(focused).toBe(true)
    expect(document.activeElement).toBe(terminal)
    expect(pointerDown).toBe(true)
  })
})

describe("shouldFocusTerminalOnKeyDown", () => {
  test("skips pure modifier keys", () => {
    expect(shouldFocusTerminalOnKeyDown(new KeyboardEvent("keydown", { key: "Meta", metaKey: true }))).toBe(false)
    expect(shouldFocusTerminalOnKeyDown(new KeyboardEvent("keydown", { key: "Control", ctrlKey: true }))).toBe(false)
    expect(shouldFocusTerminalOnKeyDown(new KeyboardEvent("keydown", { key: "Alt", altKey: true }))).toBe(false)
    expect(shouldFocusTerminalOnKeyDown(new KeyboardEvent("keydown", { key: "Shift", shiftKey: true }))).toBe(false)
  })

  test("skips shortcut key combos", () => {
    expect(shouldFocusTerminalOnKeyDown(new KeyboardEvent("keydown", { key: "c", metaKey: true }))).toBe(false)
    expect(shouldFocusTerminalOnKeyDown(new KeyboardEvent("keydown", { key: "c", ctrlKey: true }))).toBe(false)
    expect(shouldFocusTerminalOnKeyDown(new KeyboardEvent("keydown", { key: "ArrowLeft", altKey: true }))).toBe(false)
  })

  test("keeps plain typing focused on terminal", () => {
    expect(shouldFocusTerminalOnKeyDown(new KeyboardEvent("keydown", { key: "a" }))).toBe(true)
    expect(shouldFocusTerminalOnKeyDown(new KeyboardEvent("keydown", { key: "A", shiftKey: true }))).toBe(true)
  })
})

describe("getTabReorderIndex", () => {
  test("returns target index for valid drag reorder", () => {
    expect(getTabReorderIndex(["a", "b", "c"], "a", "c")).toBe(2)
  })

  test("returns undefined for unknown droppable id", () => {
    expect(getTabReorderIndex(["a", "b", "c"], "a", "missing")).toBeUndefined()
  })
})

describe("createSessionTabs", () => {
  test("normalizes the effective file tab", () => {
    createRoot((dispose) => {
      const [state] = createStore({
        active: undefined as string | undefined,
        all: ["file://src/a.ts", "context"],
      })
      const tabs = createMemo(() => ({ active: () => state.active, all: () => state.all }))
      const result = createSessionTabs({
        tabs,
        pathFromTab: (tab) => (tab.startsWith("file://") ? tab.slice("file://".length) : undefined),
        normalizeTab: (tab) => (tab.startsWith("file://") ? `norm:${tab.slice("file://".length)}` : tab),
      })

      expect(result.activeTab()).toBe("norm:src/a.ts")
      expect(result.activeFileTab()).toBe("norm:src/a.ts")
      expect(result.closableTab()).toBe("norm:src/a.ts")
      dispose()
    })
  })

  test("prefers context and review fallbacks when no file tab is active", () => {
    createRoot((dispose) => {
      const [state] = createStore({
        active: undefined as string | undefined,
        all: ["context"],
      })
      const tabs = createMemo(() => ({ active: () => state.active, all: () => state.all }))
      const result = createSessionTabs({
        tabs,
        pathFromTab: () => undefined,
        normalizeTab: (tab) => tab,
        review: () => true,
        hasReview: () => true,
      })

      expect(result.activeTab()).toBe("context")
      expect(result.closableTab()).toBe("context")
      dispose()
    })

    createRoot((dispose) => {
      const [state] = createStore({
        active: undefined as string | undefined,
        all: [],
      })
      const tabs = createMemo(() => ({ active: () => state.active, all: () => state.all }))
      const result = createSessionTabs({
        tabs,
        pathFromTab: () => undefined,
        normalizeTab: (tab) => tab,
        review: () => true,
        hasReview: () => true,
      })

      expect(result.activeTab()).toBe("review")
      expect(result.activeFileTab()).toBeUndefined()
      expect(result.closableTab()).toBeUndefined()
      dispose()
    })
  })
})

describe("session review selectors", () => {
  test("filters visible user messages before a revert message", () => {
    expect(visibleUserMessages([user("1"), user("2"), user("3")], "3").map((item) => item.id)).toEqual(["1", "2"])
    expect(visibleUserMessages([user("1"), user("2")]).map((item) => item.id)).toEqual(["1", "2"])
  })

  test("prefers the latest completed assistant reply for the active parent", () => {
    const result = lastCompletedAssistant(
      [
        user("1"),
        assistant({ id: "a", completed: 1 }),
        assistant({ id: "b", parentID: "1", completed: 2 }),
        assistant({ id: "c", parentID: "1", error: new Error("fail"), completed: 3 }),
      ],
      "1",
    )

    expect(result?.id).toBe("b")
  })

  test("falls back to the latest completed assistant when no parent match exists", () => {
    const result = lastCompletedAssistant(
      [assistant({ id: "a", completed: 1 }), assistant({ id: "b", completed: 2 })],
      "missing",
    )
    expect(result?.id).toBe("b")
  })

  test("builds review stats and filters review diffs by pick", () => {
    const diffs = [
      { file: "a", kind: "added" },
      { file: "b", kind: "modified" },
      { file: "c", kind: "deleted" },
    ]
    const kind = (diff: (typeof diffs)[number]) => diff.kind as "added" | "modified" | "deleted"

    expect(reviewStats(diffs, kind)).toEqual({ all: 3, added: 1, modified: 1, deleted: 1 })
    expect(filterReviewDiffs(diffs, "all", kind).map((diff) => diff.file)).toEqual(["a", "b", "c"])
    expect(filterReviewDiffs(diffs, "modified", kind).map((diff) => diff.file)).toEqual(["b"])
  })

  test("keeps the selected review file when still visible", () => {
    const diffs = [{ file: "a" }, { file: "b" }]
    expect(selectedReviewFile(diffs, "b")).toBe("b")
    expect(selectedReviewFile(diffs, "missing")).toBe("a")
  })
})

describe("session state transforms", () => {
  test("formats prompt draft lines and falls back to attachment label", () => {
    expect(promptDraftLine([{ type: "text", content: "hello\nworld" }], "Attachment")).toBe("hello world")
    expect(promptDraftLine([{ type: "image", filename: "a.png" }], "Attachment")).toBe("[image:a.png]")
    expect(promptDraftLine([], "Attachment")).toBe("[Attachment]")
  })

  test("updates session info and revert state immutably", () => {
    const list: { id: string; revert?: { messageID: string }; title: string }[] = [
      { id: "a", revert: undefined, title: "one" },
      { id: "b", revert: undefined, title: "two" },
    ]

    expect(updateSessionInfo(list, { id: "b", revert: undefined, title: "next" })).toEqual([
      { id: "a", revert: undefined, title: "one" },
      { id: "b", revert: undefined, title: "next" },
    ])

    expect(updateSessionRevert(list, "a", { messageID: "m1" })).toEqual([
      { id: "a", revert: { messageID: "m1" }, title: "one" },
      { id: "b", revert: undefined, title: "two" },
    ])
  })

  test("detects busy sessions from status or pending assistant messages", () => {
    expect(isSessionBusy({ type: "busy" }, [user("1")])).toBe(true)
    expect(isSessionBusy(undefined, [assistant({ id: "a" })])).toBe(true)
    expect(isSessionBusy(undefined, [assistant({ id: "a", completed: 1 })])).toBe(false)
  })

  test("finds next user message and rolled messages from revert marker", () => {
    const users = [user("1"), user("2"), user("3")]
    expect(nextUserMessage(users, "1")?.id).toBe("2")
    expect(rolledMessages(users, "2", (id) => `draft:${id}`)).toEqual([
      { id: "2", text: "draft:2" },
      { id: "3", text: "draft:3" },
    ])
  })

  test("builds revert and restore plans", () => {
    const users = [user("1"), user("2"), user("3")]
    const draft = (id: string) => [{ type: "text", content: `draft:${id}`, start: 0, end: 7 }] as any

    expect(
      revertPlan({
        sessionID: "s",
        messageID: "2",
        draft,
      }),
    ).toEqual({
      request: { sessionID: "s", messageID: "2" },
      revert: { messageID: "2" },
      prompt: [{ type: "text", content: "draft:2", start: 0, end: 7 }],
    })

    expect(
      restorePlan({
        sessionID: "s",
        messageID: "1",
        messages: users,
        draft,
      }),
    ).toEqual({
      request: { type: "revert", sessionID: "s", messageID: "2" },
      revert: { messageID: "2" },
      prompt: [{ type: "text", content: "draft:2", start: 0, end: 7 }],
      reset: false,
    })

    expect(
      restorePlan({
        sessionID: "s",
        messageID: "3",
        messages: users,
        draft,
      }),
    ).toEqual({
      request: { type: "unrevert", sessionID: "s" },
      revert: undefined,
      reset: true,
    })
  })
})
