import fs from "fs/promises"
import path from "path"
import { describe, expect, test } from "vitest"

// Regression guards (source-pattern tests, matching h-session-undo-redo-revert-error.test.ts):
// The v2 SDK client resolves `{error}` instead of rejecting when throwOnError is
// falsy (the default), so `.catch()` / try-catch around sdk.client.session.* is
// dead code for HTTP/network failures. Three handlers used to treat a failed
// call as success:
//   - session delete (both dialog-session-list variants) removed the session
//     locally even though the server delete failed.
//   - session list search / workspace-list load coerced the undefined `data`
//     into [] and truthy-replaced the real session list with an empty one.
//   - session rename fell through to dialog.clear() on a failed update.
// Each must now inspect `result.error` and route failures into the toast/error
// path (delete/list) or throw so DialogPrompt keeps the dialog open (rename).

const TUI_ROOT = path.join(__dirname, "../../../src/cli/cmd/tui")
const DIALOG_SESSION_LIST_SRC = path.join(TUI_ROOT, "component/dialog-session-list.tsx")
const WORKSPACE_SESSION_LIST_SRC = path.join(TUI_ROOT, "component/workspace/dialog-session-list.tsx")
const DIALOG_SESSION_RENAME_SRC = path.join(TUI_ROOT, "component/dialog-session-rename.tsx")

describe("tui session list/rename SDK-error handling", () => {
  test("session delete checks result.error instead of a dead .catch (both variants)", async () => {
    for (const src of [DIALOG_SESSION_LIST_SRC, WORKSPACE_SESSION_LIST_SRC]) {
      const contents = await fs.readFile(src, "utf8")
      // The delete result must be inspected, not assumed successful.
      expect(contents).toContain(".then((result) => !result.error)")
      // The dead "always true" success mapping must be gone.
      expect(contents).not.toContain(".then(() => true)")
    }
  })

  test("session list search checks result.error before replacing the session list", async () => {
    const contents = await fs.readFile(DIALOG_SESSION_LIST_SRC, "utf8")
    // The search fetcher must guard on the resolved error and fall back to the
    // previous value rather than normalizing an undefined `data` into [].
    expect(contents).toMatch(/if \(result\.error\)/)
    // Failures must surface a toast only when the request was not aborted.
    expect(contents).toContain("if (!signal.aborted)")
    expect(contents).toContain("return info.value")
  })

  test("workspace session list guards both the load and search resources", async () => {
    const contents = await fs.readFile(WORKSPACE_SESSION_LIST_SRC, "utf8")
    // Both resources (listed load + search) must check the resolved error.
    const guards = contents.match(/if \(result\.error\)/g) ?? []
    expect(guards.length).toBeGreaterThanOrEqual(2)
    expect(contents).toContain("if (!signal.aborted)")
    expect(contents).toContain("return info.value")
  })

  test("session rename throws on result.error so the dialog stays open", async () => {
    const contents = await fs.readFile(DIALOG_SESSION_RENAME_SRC, "utf8")
    // The update result must be captured and inspected.
    expect(contents).toContain("const result = await sdk.client.session.update")
    expect(contents).toMatch(/if \(result\.error\)[\s\S]*throw new Error/)
    // dialog.clear() must sit after the error guard so a failed rename cannot
    // reach the success path.
    const errorGuard = contents.indexOf("if (result.error)")
    const clear = contents.indexOf("dialog.clear()", errorGuard)
    expect(errorGuard).toBeGreaterThan(0)
    expect(clear).toBeGreaterThan(errorGuard)
  })
})
