import { describe, expect, test } from "bun:test"
import {
  commentCount,
  buildSlashCommands,
  contextItems,
  historyComments,
  hasUserPrompt,
  isSeedable,
  promptPopover,
  promptText,
  recentPaths,
  shouldIgnoreWorkingSubmit,
  shouldResetPrompt,
  togglePin,
  touchRecipe,
} from "./state"

describe("prompt-input state", () => {
  test("orders recent paths with the active tab first and no duplicates", () => {
    expect(
      recentPaths(["file://b", "file://a", "file://b"], "file://a", (tab) => tab.replace("file://", "/repo/")),
    ).toEqual(["/repo/a", "/repo/b"])
  })

  test("counts and filters comment items by mode", () => {
    const items = [
      { type: "file" as const, path: "/repo/a.ts", comment: "review me" },
      { type: "file" as const, path: "/repo/b.ts" },
    ]

    expect(commentCount(items, "normal")).toBe(1)
    expect(commentCount(items, "shell")).toBe(0)
    expect(contextItems(items, "normal")).toEqual(items)
    expect(contextItems(items, "shell")).toEqual([{ type: "file", path: "/repo/b.ts" }])
  })

  test("detects whether the session already has a user prompt", () => {
    expect(hasUserPrompt(undefined)).toBe(false)
    expect(hasUserPrompt([{ role: "assistant" }, { role: "user" }])).toBe(true)
  })

  test("gates quick-start seeding from prompt state", () => {
    expect(
      isSeedable({
        mode: "normal",
        suggest: true,
        dirty: false,
        working: false,
        imageCount: 0,
        contextCount: 0,
      }),
    ).toBe(true)
    expect(
      isSeedable({
        mode: "shell",
        suggest: true,
        dirty: false,
        working: false,
        imageCount: 0,
        contextCount: 0,
      }),
    ).toBe(false)
  })

  test("builds prompt history comments from current context and saved comments", () => {
    const items = [
      {
        type: "file" as const,
        path: "/repo/a.ts",
        comment: "fix this",
        commentID: "c1",
        commentOrigin: "review" as const,
        preview: "line",
      },
      {
        type: "file" as const,
        path: "/repo/b.ts",
        comment: "local note",
        selection: { startLine: 4, endLine: 6, startChar: 0, endChar: 10 },
      },
    ]
    const comments = [
      {
        id: "c1",
        file: "/repo/a.ts",
        selection: { start: 1, end: 3 },
        comment: "fix this",
        time: 42,
      },
    ]

    expect(historyComments(items, comments)).toEqual([
      {
        id: "c1",
        path: "/repo/a.ts",
        selection: { start: 1, end: 3 },
        comment: "fix this",
        time: 42,
        origin: "review",
        preview: "line",
      },
      {
        id: "/repo/b.ts",
        path: "/repo/b.ts",
        selection: { start: 4, end: 6 },
        comment: "local note",
        time: expect.any(Number),
        origin: undefined,
        preview: undefined,
      },
    ])
  })

  test("builds slash commands with pinned, recent, and recommended grouping", () => {
    const commands = buildSlashCommands({
      options: [
        { id: "builtin.run", title: "Run", slash: "run", description: "run it" },
        { id: "suggested.skip", title: "Skip", slash: "skip" },
      ],
      commands: [
        { name: "deploy", description: "deploy app", source: "command" },
        { name: "lookup", description: "lookup docs", source: "mcp" },
      ],
      recipes: {
        pin: ["builtin.run"],
        recent: ["custom.lookup"],
      },
      t: (key) => key,
    })

    expect(commands).toEqual([
      {
        id: "builtin.run",
        trigger: "run",
        title: "Run",
        description: "run it",
        category: "prompt.recipe.group.pinned",
        keybind: undefined,
        type: "builtin",
      },
      {
        id: "custom.lookup",
        trigger: "lookup",
        title: "lookup",
        description: "lookup docs",
        category: "prompt.recipe.group.recent",
        type: "custom",
        source: "mcp",
      },
      {
        id: "custom.deploy",
        trigger: "deploy",
        title: "deploy",
        description: "deploy app",
        category: "prompt.recipe.group.recommended",
        type: "custom",
        source: "command",
      },
    ])
  })

  test("updates recent and pinned recipe lists without duplicates", () => {
    expect(touchRecipe(["a", "b", "c"], "b", 3)).toEqual(["b", "a", "c"])
    expect(togglePin(["a", "b"], "b")).toEqual(["a"])
    expect(togglePin(["a", "b"], "c")).toEqual(["c", "a", "b"])
  })

  test("builds prompt text from text-only and mixed prompt parts", () => {
    expect(promptText([{ type: "text", content: "hello" }])).toBe("hello")
    expect(
      promptText([
        { type: "text", content: "hello " },
        { type: "file", content: "@/a.ts" },
        { type: "agent", content: "@worker" },
      ]),
    ).toBe("hello @/a.ts@worker")
  })

  test("detects when the prompt should reset to the default empty state", () => {
    expect(shouldResetPrompt({ text: "  \u200B", parts: [{ type: "text" }], imageCount: 0 })).toBe(true)
    expect(shouldResetPrompt({ text: "  \u200B", parts: [{ type: "file" }], imageCount: 0 })).toBe(false)
    expect(shouldResetPrompt({ text: "hello", parts: [{ type: "text" }], imageCount: 0 })).toBe(false)
  })

  test("detects active at and slash popovers from prompt text", () => {
    expect(promptPopover({ mode: "normal", text: "@wor", cursor: 4 })).toEqual({ type: "at", query: "wor" })
    expect(promptPopover({ mode: "normal", text: "/run", cursor: 4 })).toEqual({ type: "slash", query: "run" })
    expect(promptPopover({ mode: "shell", text: "@wor", cursor: 4 })).toBeUndefined()
    expect(promptPopover({ mode: "normal", text: "hello world", cursor: 11 })).toBeUndefined()
  })

  test("ignores empty working submit only when nothing is queued", () => {
    expect(shouldIgnoreWorkingSubmit({ working: true, text: " ", imageCount: 0, commentCount: 0 })).toBe(true)
    expect(shouldIgnoreWorkingSubmit({ working: true, text: "go", imageCount: 0, commentCount: 0 })).toBe(false)
    expect(shouldIgnoreWorkingSubmit({ working: false, text: " ", imageCount: 0, commentCount: 0 })).toBe(false)
  })
})
