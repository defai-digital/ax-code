import fs from "fs/promises"
import path from "path"
import { describe, expect, test } from "vitest"

// Regression guards (source-pattern tests, matching dialogs-action-dispatch.test.ts):
// The v2 SDK client resolves `{error}` instead of rejecting when throwOnError is
// falsy (the default), so `.catch()` on sdk.client.session.* is dead code for
// HTTP/network failures. The /undo, /redo, and message-dialog Revert handlers
// used to run their success path (clobber/clear the prompt, close the dialog,
// scroll) on a FAILED revert. Each must now inspect `result.error` and route
// failures into the toast/error path, and must only clear the dialog on success.

const TUI_ROOT = path.join(__dirname, "../../../src/cli/cmd/tui")
const SESSION_INDEX_SRC = path.join(TUI_ROOT, "routes/session/index.tsx")
const DIALOG_MESSAGE_SRC = path.join(TUI_ROOT, "routes/session/dialog-message.tsx")

function sliceHandler(src: string, marker: string, length = 900) {
  const index = src.indexOf(marker)
  expect(index).toBeGreaterThan(0)
  return src.slice(index, index + length)
}

describe("tui session undo/redo/revert SDK-error handling", () => {
  test("undo checks abort and revert result.error and only clears on success", async () => {
    const src = await fs.readFile(SESSION_INDEX_SRC, "utf8")
    const block = sliceHandler(src, '"session.undo"', 2400)

    // The pre-undo abort must inspect the resolved error, not rely on try/catch.
    expect(block).toContain("const aborted = await sdk.client.session.abort")
    expect(block).toContain("if (aborted.error)")
    // The revert must be captured and checked instead of a dead .then/.catch.
    expect(block).toContain("const result = await sdk.client.session.revert")
    expect(block).toContain("if (result.error)")
    expect(block).not.toMatch(/\.revert\([^)]*\)\s*\n\s*\.then\(/)

    // The success side-effects (prompt clobber, scroll, dialog close) must sit
    // after the error guard so a failed revert cannot reach them.
    const errorGuard = block.indexOf("if (result.error)")
    const promptSet = block.indexOf("prompt.set(promptState", errorGuard)
    const clear = block.indexOf("dialog.clear()", errorGuard)
    expect(promptSet).toBeGreaterThan(errorGuard)
    expect(clear).toBeGreaterThan(errorGuard)
  })

  test("redo checks unrevert/revert result.error and only clears the dialog on success", async () => {
    const src = await fs.readFile(SESSION_INDEX_SRC, "utf8")
    const block = sliceHandler(src, '"session.redo"', 1600)

    // The unrevert branch must check the result before wiping the typed prompt.
    expect(block).toContain("const result = await sdk.client.session.unrevert")
    expect(block).toContain("if (result.error)")
    // The revert branch must check the result too (previously a dead .catch).
    expect(block).toContain("const result = await sdk.client.session.revert")
    expect(block).not.toMatch(/\.revert\([^)]*\)\s*\n\s*\.catch\(/)

    // dialog.clear() must have moved out of the top of the handler so a failed
    // redo does not close the dialog; every clear sits after an error guard.
    const handlerStart = block.indexOf("onSelect: async (dialog) => {")
    const firstStatement = block.slice(handlerStart, block.indexOf("\n", handlerStart + 40))
    expect(firstStatement).not.toContain("dialog.clear()")
    for (const clearIndex of allIndexesOf(block, "dialog.clear()")) {
      const preceding = block.lastIndexOf("if (result.error)", clearIndex)
      expect(preceding).toBeGreaterThan(0)
      expect(preceding).toBeLessThan(clearIndex)
    }
  })

  test("message-dialog Revert checks result.error and only clears on success", async () => {
    const src = await fs.readFile(DIALOG_MESSAGE_SRC, "utf8")
    const block = sliceHandler(src, '"session.revert"', 2000)

    expect(block).toContain("const result = await sdk.client.session.revert")
    // The generated type doesn't surface .error here, so it's read through a cast.
    expect(block).toContain("if (revertError)")
    expect(block).not.toMatch(/\.revert\([^)]*\)\s*\n\s*\.then\(/)

    // setPrompt + dialog.clear() must sit after the error guard.
    const errorGuard = block.indexOf("if (revertError)")
    const setPrompt = block.indexOf("props.setPrompt(", errorGuard)
    const clear = block.indexOf("dialog.clear()", errorGuard)
    expect(setPrompt).toBeGreaterThan(errorGuard)
    expect(clear).toBeGreaterThan(errorGuard)
  })
})

function allIndexesOf(haystack: string, needle: string) {
  const out: number[] = []
  let from = 0
  for (;;) {
    const found = haystack.indexOf(needle, from)
    if (found < 0) break
    out.push(found)
    from = found + needle.length
  }
  return out
}
