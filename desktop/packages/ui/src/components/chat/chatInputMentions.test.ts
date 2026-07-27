import { beforeEach, describe, expect, test, vi } from "vitest"

import {
  collectComposerMentionRanges,
  detectMentionQueryAtCursor,
  extractInlineFileMentions,
  getConfirmedMentionsKey,
  loadConfirmedMentions,
  pruneConfirmedMentions,
  resolveFileMentionDeletion,
  saveConfirmedMentions,
  toProjectRelativeMentionPath,
  toServerFileUrl,
} from "./chatInputMentions"

// Mirrors the closure in ChatInput-impl.tsx: a mention path "looks like" a file
// when it has path separators, an extension, or was explicitly confirmed.
const makeIsConfirmedFilePath = (confirmed: Set<string>) => (text: string) =>
  text.includes("/") || text.includes("\\") || text.includes(".") || confirmed.has(text)

const noAgents = new Set<string>()
const notAnAgent = () => false

// jsdom in this repo provides no localStorage — install the same Map-backed
// mock used by neighboring store tests (see useOpenInAppsStore.test.ts).
const installMockLocalStorage = (): Storage => {
  const values = new Map<string, string>()
  const storage: Storage = {
    get length() {
      return values.size
    },
    clear: () => values.clear(),
    getItem: (key) => values.get(String(key)) ?? null,
    key: (index) => Array.from(values.keys())[index] ?? null,
    removeItem: (key) => {
      values.delete(String(key))
    },
    setItem: (key, value) => {
      values.set(String(key), String(value))
    },
  }
  Object.defineProperty(window, "localStorage", {
    configurable: true,
    value: storage,
  })
  return storage
}

describe("confirmed mentions persistence", () => {
  let storage: Storage

  beforeEach(() => {
    storage = installMockLocalStorage()
    vi.restoreAllMocks()
  })

  test("builds per-session keys with a 'new' fallback for null sessions", () => {
    expect(getConfirmedMentionsKey("session-1")).toBe("openchamber_chat_confirmed_mentions_session-1")
    expect(getConfirmedMentionsKey(null)).toBe("openchamber_chat_confirmed_mentions_new")
  })

  test("save/load round-trips confirmed mentions per session", () => {
    saveConfirmedMentions("session-1", new Set(["src/app.ts", "README.md"]))
    expect(loadConfirmedMentions("session-1")).toEqual(new Set(["src/app.ts", "README.md"]))
    expect(loadConfirmedMentions("other")).toEqual(new Set())
  })

  test("saving an empty set clears the stored value", () => {
    saveConfirmedMentions("session-1", new Set(["src/app.ts"]))
    saveConfirmedMentions("session-1", new Set())
    expect(loadConfirmedMentions("session-1")).toEqual(new Set())
    expect(storage.getItem(getConfirmedMentionsKey("session-1"))).toBeNull()
  })

  test("returns an empty set for corrupt or non-array payloads", () => {
    storage.setItem(getConfirmedMentionsKey("session-1"), "not json")
    expect(loadConfirmedMentions("session-1")).toEqual(new Set())

    storage.setItem(getConfirmedMentionsKey("session-1"), JSON.stringify({ a: 1 }))
    expect(loadConfirmedMentions("session-1")).toEqual(new Set())

    storage.setItem(getConfirmedMentionsKey("session-1"), JSON.stringify(["ok.ts", 42, null]))
    expect(loadConfirmedMentions("session-1")).toEqual(new Set(["ok.ts"]))
  })

  test("pruneConfirmedMentions keeps only mentions still present in the draft", () => {
    const confirmed = new Set(["src/app.ts", "README.md", "plain"])
    const pruned = pruneConfirmedMentions(confirmed, "see @src/app.ts and @plain")
    expect(pruned).toEqual(new Set(["src/app.ts", "plain"]))
  })
})

describe("collectComposerMentionRanges", () => {
  test("highlights file mentions for paths and confirmed plain tokens", () => {
    const confirmed = new Set(["LICENSE"])
    const ranges = collectComposerMentionRanges("open @src/app.ts and @LICENSE now", noAgents, makeIsConfirmedFilePath(confirmed))
    expect(ranges).toEqual([
      { start: 5, end: 16, kind: "file" },
      { start: 21, end: 29, kind: "file" },
    ])
  })

  test("highlights agent mentions with the agent kind", () => {
    const agents = new Set(["build"])
    const ranges = collectComposerMentionRanges("hey @build run it", agents, makeIsConfirmedFilePath(new Set()))
    expect(ranges).toEqual([{ start: 4, end: 10, kind: "agent" }])
  })

  test("ignores email addresses (no boundary before @)", () => {
    const ranges = collectComposerMentionRanges("mail user@example.com today", noAgents, makeIsConfirmedFilePath(new Set()))
    expect(ranges).toEqual([])
  })

  test("ignores unconfirmed plain words", () => {
    const ranges = collectComposerMentionRanges("hey @john how are you", noAgents, makeIsConfirmedFilePath(new Set()))
    expect(ranges).toEqual([])
  })

  test("handles mentions at the very start and end of the message", () => {
    const ranges = collectComposerMentionRanges("@a.ts mid @b.ts", noAgents, makeIsConfirmedFilePath(new Set()))
    expect(ranges).toEqual([
      { start: 0, end: 5, kind: "file" },
      { start: 10, end: 15, kind: "file" },
    ])
  })

  test("trailing punctuation is excluded from the mention but the range covers the raw token", () => {
    const ranges = collectComposerMentionRanges("see @file.ts, thanks", noAgents, makeIsConfirmedFilePath(new Set()))
    expect(ranges).toEqual([{ start: 4, end: 13, kind: "file" }])
  })

  test("collects multiple mentions in one message", () => {
    const agents = new Set(["review"])
    const ranges = collectComposerMentionRanges(
      "@review check @src/a.ts and @src/b.ts",
      agents,
      makeIsConfirmedFilePath(new Set()),
    )
    expect(ranges).toEqual([
      { start: 0, end: 7, kind: "agent" },
      { start: 14, end: 23, kind: "file" },
      { start: 28, end: 37, kind: "file" },
    ])
  })
})

describe("detectMentionQueryAtCursor", () => {
  test("returns the query after @ at a word boundary", () => {
    expect(detectMentionQueryAtCursor("@src/ap")).toBe("src/ap")
    expect(detectMentionQueryAtCursor("hello @src/ap")).toBe("src/ap")
    expect(detectMentionQueryAtCursor("hello @")).toBe("")
  })

  test("returns null when there is no @ or the query already ended", () => {
    expect(detectMentionQueryAtCursor("hello world")).toBeNull()
    expect(detectMentionQueryAtCursor("@foo bar")).toBeNull()
    expect(detectMentionQueryAtCursor("@foo\nbar")).toBeNull()
  })

  test("returns null for emails (no word boundary before @)", () => {
    expect(detectMentionQueryAtCursor("user@example")).toBeNull()
  })

  test("uses the last @ in the text", () => {
    expect(detectMentionQueryAtCursor("@done now @par")).toBe("par")
  })
})

describe("resolveFileMentionDeletion", () => {
  const confirmedPath = makeIsConfirmedFilePath(new Set())

  test("removes the whole mention token and one trailing space", () => {
    const result = resolveFileMentionDeletion("hello @src/app.ts world", 12, notAnAgent, confirmedPath)
    expect(result).toEqual({
      nextMessage: "hello world",
      cursorPosition: 6,
      mentionContent: "src/app.ts",
    })
  })

  test("keeps the following text when there is no trailing space", () => {
    const result = resolveFileMentionDeletion("@a.ts end", 2, notAnAgent, confirmedPath)
    expect(result).toEqual({
      nextMessage: "end",
      cursorPosition: 0,
      mentionContent: "a.ts",
    })
  })

  test("returns null for agent mentions", () => {
    const result = resolveFileMentionDeletion("hey @build x", 6, () => true, confirmedPath)
    expect(result).toBeNull()
  })

  test("returns null for unconfirmed plain tokens and out-of-range probes", () => {
    expect(resolveFileMentionDeletion("hey @john x", 6, notAnAgent, makeIsConfirmedFilePath(new Set()))).toBeNull()
    expect(resolveFileMentionDeletion("hey", -1, notAnAgent, confirmedPath)).toBeNull()
    expect(resolveFileMentionDeletion("hey", 3, notAnAgent, confirmedPath)).toBeNull()
  })
})

describe("toProjectRelativeMentionPath", () => {
  test("makes paths under the root relative", () => {
    expect(toProjectRelativeMentionPath("/repo/src/app.ts", "/repo")).toBe("src/app.ts")
    expect(toProjectRelativeMentionPath("/repo/", "/repo")).toBe("")
  })

  test("returns the path unchanged outside the root or without a root", () => {
    expect(toProjectRelativeMentionPath("/other/a.ts", "/repo")).toBe("/other/a.ts")
    expect(toProjectRelativeMentionPath("/repo/src/app.ts", "")).toBe("/repo/src/app.ts")
    expect(toProjectRelativeMentionPath("/repo/src/app.ts", null)).toBe("/repo/src/app.ts")
  })

  test("normalizes windows separators", () => {
    expect(toProjectRelativeMentionPath("C:\\repo\\src\\app.ts", "C:\\repo")).toBe("src/app.ts")
  })
})

describe("toServerFileUrl", () => {
  test("wraps plain paths in a file:// URL with encoded segments", () => {
    expect(toServerFileUrl("/repo/src/app.ts")).toBe("file:///repo/src/app.ts")
    expect(toServerFileUrl("/repo/my file.ts")).toBe("file:///repo/my%20file.ts")
  })

  test("passes through existing file:// URLs", () => {
    expect(toServerFileUrl("file:///repo/app.ts")).toBe("file:///repo/app.ts")
  })

  test("handles windows drive paths", () => {
    expect(toServerFileUrl("C:\\repo\\app.ts")).toBe("file:///C:/repo/app.ts")
  })
})

describe("extractInlineFileMentions", () => {
  const baseOptions = {
    root: "/repo",
    isKnownAgent: notAnAgent,
    isConfirmedFilePath: makeIsConfirmedFilePath(new Set()),
  }

  test("passes text through unchanged when there is no @", () => {
    expect(extractInlineFileMentions("plain message", baseOptions)).toEqual({
      sanitizedText: "plain message",
      attachments: [],
    })
  })

  test("attaches relative mentions against the root directory", () => {
    const { sanitizedText, attachments } = extractInlineFileMentions("check @src/app.ts please", baseOptions)
    expect(sanitizedText).toBe("check @src/app.ts please")
    expect(attachments).toHaveLength(1)
    expect(attachments[0]).toMatchObject({
      filename: "app.ts",
      mimeType: "text/plain",
      source: "server",
      serverPath: "/repo/src/app.ts",
      dataUrl: "file:///repo/src/app.ts",
    })
  })

  test("keeps absolute mention paths as-is", () => {
    const { attachments } = extractInlineFileMentions("see @/etc/hosts", baseOptions)
    expect(attachments).toHaveLength(1)
    expect(attachments[0].serverPath).toBe("/etc/hosts")
    expect(attachments[0].filename).toBe("hosts")
  })

  test("skips emails, agent mentions, and unconfirmed plain words", () => {
    const options = {
      ...baseOptions,
      isKnownAgent: (name: string) => name === "build",
    }
    const { attachments } = extractInlineFileMentions("mail user@example.com, hey @build and @john", options)
    expect(attachments).toEqual([])
  })

  test("handles multiple mentions and dedupes repeated paths", () => {
    const { attachments } = extractInlineFileMentions("@a.ts @src/b.ts @a.ts", baseOptions)
    expect(attachments.map((a) => a.serverPath)).toEqual(["/repo/a.ts", "/repo/src/b.ts"])
  })

  test("handles mentions at start and end, stripping surrounding punctuation", () => {
    const { attachments } = extractInlineFileMentions("@a.ts then (@src/b.ts)", baseOptions)
    expect(attachments.map((a) => a.filename)).toEqual(["a.ts", "b.ts"])
  })

  test("attaches confirmed plain tokens without path separators", () => {
    const options = {
      ...baseOptions,
      isConfirmedFilePath: makeIsConfirmedFilePath(new Set(["LICENSE"])),
    }
    const { attachments } = extractInlineFileMentions("read @LICENSE please", options)
    expect(attachments).toHaveLength(1)
    expect(attachments[0].serverPath).toBe("/repo/LICENSE")
  })

  test("skips relative mentions when no root directory is available", () => {
    const { attachments } = extractInlineFileMentions("check @src/app.ts", { ...baseOptions, root: "" })
    expect(attachments).toEqual([])
  })
})
