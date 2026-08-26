import { describe, expect, test, vi } from "vitest"

import { saveFilesViewDraft } from "./filesViewEditorSave"

describe("files view editor save", () => {
  test("skips clean drafts and writes dirty ones", async () => {
    const writeFile = vi.fn(async () => ({ success: true }))
    await expect(
      saveFilesViewDraft({
        path: "/repo/a.ts",
        draftContent: "a\nb",
        displayedContent: "a\nb",
        lineEnding: "\n",
        writeFile,
      }),
    ).resolves.toEqual({ ok: true, skipped: true })
    await expect(
      saveFilesViewDraft({
        path: "/repo/a.ts",
        draftContent: "changed",
        displayedContent: "original",
        lineEnding: "\n",
        writeFile,
      }),
    ).resolves.toEqual({ ok: true, skipped: false })
  })
})
