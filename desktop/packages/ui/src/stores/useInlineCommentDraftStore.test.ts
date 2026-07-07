import { beforeEach, describe, expect, test } from "vitest"
import { buildInlineCommentSessionKey, useInlineCommentDraftStore } from "./useInlineCommentDraftStore"

const makeDraft = (sessionKey: string, text: string) => ({
  sessionKey,
  source: "diff" as const,
  fileLabel: "src/app.ts",
  startLine: 1,
  endLine: 1,
  code: "const value = 1",
  language: "ts",
  text,
})

describe("inline comment draft keys", () => {
  beforeEach(() => {
    useInlineCommentDraftStore.setState({ drafts: {} })
  })

  test("uses active session id before draft scope", () => {
    expect(
      buildInlineCommentSessionKey({
        sessionId: " ses_123 ",
        draftDirectory: "/repo/a",
      }),
    ).toBe("ses_123")
  })

  test("scopes new-session draft keys by normalized directory", () => {
    expect(buildInlineCommentSessionKey({ draftDirectory: "/repo/a/" })).toBe("draft:/repo/a")
    expect(buildInlineCommentSessionKey({ draftDirectory: "/repo/b" })).toBe("draft:/repo/b")
    expect(buildInlineCommentSessionKey({ draftDirectory: "C:\\repo\\a\\" })).toBe("draft:C:/repo/a")
  })

  test("falls back to project id when a draft has no directory", () => {
    expect(buildInlineCommentSessionKey({ draftProjectId: "proj_123" })).toBe("draft:project:proj_123")
  })

  test("keeps draft buckets isolated by scoped key", () => {
    const store = useInlineCommentDraftStore.getState()
    const firstKey = buildInlineCommentSessionKey({ draftDirectory: "/repo/a" })
    const secondKey = buildInlineCommentSessionKey({ draftDirectory: "/repo/b" })

    if (!firstKey || !secondKey) {
      throw new Error("Expected scoped draft keys")
    }

    store.addDraft(makeDraft(firstKey, "review a"))
    store.addDraft(makeDraft(secondKey, "review b"))

    expect(
      useInlineCommentDraftStore
        .getState()
        .getDrafts(firstKey)
        .map((draft) => draft.text),
    ).toEqual(["review a"])
    expect(
      useInlineCommentDraftStore
        .getState()
        .getDrafts(secondKey)
        .map((draft) => draft.text),
    ).toEqual(["review b"])
    expect(useInlineCommentDraftStore.getState().getDrafts("draft")).toEqual([])
  })
})
