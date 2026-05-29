import { describe, expect, test } from "bun:test"
import {
  COMPOSER_DRAFT_STORAGE_KEY,
  readStoredComposerDraft,
  writeStoredComposerDraft,
} from "../src/runtime/composer-draft"

describe("composer draft persistence", () => {
  test("reads legacy text-only drafts", () => {
    const storage = memoryStorage([[COMPOSER_DRAFT_STORAGE_KEY, "Review the staged diff"]])

    expect(readStoredComposerDraft(storage)).toEqual({ text: "Review the staged diff" })
  })

  test("persists mode, selectors, target worktree, and path-based attachments", () => {
    const storage = memoryStorage()

    writeStoredComposerDraft(
      {
        text: "Run review",
        mode: "command",
        agent: "review",
        modelKey: "openai:gpt-5-codex",
        worktreeDirectory: "/workspace/.ax-code/worktrees/gui-a",
        attachments: [
          {
            id: "att_file",
            kind: "context",
            path: "packages/app/src/App.tsx",
            mime: "text/plain",
            filename: "App.tsx",
            startLine: 10,
            endLine: 20,
          },
          {
            id: "att_inline",
            kind: "image",
            path: "data:image/png;base64,private",
            mime: "image/png",
            filename: "private.png",
          },
        ],
      },
      storage,
    )

    const raw = storage.getItem(COMPOSER_DRAFT_STORAGE_KEY)
    expect(raw).toContain('"version":2')
    expect(raw).not.toContain("base64,private")
    expect(readStoredComposerDraft(storage)).toEqual({
      text: "Run review",
      mode: "command",
      agent: "review",
      modelKey: "openai:gpt-5-codex",
      worktreeDirectory: "/workspace/.ax-code/worktrees/gui-a",
      attachments: [
        {
          id: "att_file",
          kind: "context",
          path: "packages/app/src/App.tsx",
          mime: "text/plain",
          filename: "App.tsx",
          startLine: 10,
          endLine: 20,
        },
      ],
    })
  })

  test("removes storage for an empty default draft", () => {
    const storage = memoryStorage([[COMPOSER_DRAFT_STORAGE_KEY, "old"]])

    writeStoredComposerDraft({ text: "", mode: "prompt", attachments: [] }, storage)

    expect(storage.getItem(COMPOSER_DRAFT_STORAGE_KEY)).toBeNull()
  })
})

function memoryStorage(initial: Array<[string, string]> = []) {
  const values = new Map(initial)
  return {
    getItem(key: string) {
      return values.get(key) ?? null
    },
    setItem(key: string, value: string) {
      values.set(key, value)
    },
    removeItem(key: string) {
      values.delete(key)
    },
  }
}
