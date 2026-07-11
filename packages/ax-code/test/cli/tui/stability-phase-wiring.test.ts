import { describe, expect, test } from "vitest"
import fs from "fs/promises"
import path from "path"

/**
 * Lightweight wiring locks for ADR-047 Phase 1–2. Prefer behavioral tests for
 * logic (terminal-suspend, sync-session-store); these only ensure call sites
 * stay on the lifecycle/prune helpers.
 */

const TUI_ROOT = path.resolve(import.meta.dirname, "../../../src/cli/cmd/tui")

describe("tui stability phase wiring (ADR-047)", () => {
  test("app uses lifecycle terminal suspend and scheduleTuiTimeout for putJson", async () => {
    const app = await fs.readFile(path.join(TUI_ROOT, "app.tsx"), "utf8")

    expect(app).toContain('from "@tui/util/terminal-suspend"')
    expect(app).toContain("createTerminalSuspendController")
    expect(app).toContain("terminalSuspend.suspend(")
    expect(app).toContain("terminalSuspend.dispose()")
    expect(app).not.toMatch(/process\.once\(\s*["']SIGCONT["']/)
    expect(app).not.toMatch(/process\.kill\(\s*0\s*,\s*["']SIGTSTP["']/)
    expect(app).toContain('name: "app-put-json-timeout"')
    expect(app).toContain("scheduleTuiTimeout(() => ctrl.abort()")
  })

  test("session route prunes heavy projection on leave and clears session sync", async () => {
    const session = await fs.readFile(path.join(TUI_ROOT, "routes/session/index.tsx"), "utf8")

    expect(session).toContain("applySessionLeavePrune")
    expect(session).toContain("applySessionLeavePrune(draft, sessionID)")
    // Without clear(), fullSyncedSessions keeps re-entry from reloading.
    expect(session).toContain("sync.session.clear(sessionID)")
  })

  test("leave prune helper keeps permission/question/status fields", async () => {
    const store = await fs.readFile(path.join(TUI_ROOT, "context/sync-session-store.ts"), "utf8")

    expect(store).toContain("export function applySessionLeavePrune")
    // Must not delete interactive maps or the session list row.
    const leaveFn = store.slice(store.indexOf("export function applySessionLeavePrune"))
    const nextExport = leaveFn.indexOf("\nexport ", 1)
    const body = nextExport >= 0 ? leaveFn.slice(0, nextExport) : leaveFn
    expect(body).not.toContain("delete store.permission")
    expect(body).not.toContain("delete store.question")
    expect(body).not.toContain("delete store.session_status")
    expect(body).not.toContain("removeByID(store.session")
    expect(body).toContain("delete store.message[sessionID]")
    expect(body).toContain("delete store.part[message.id]")
  })
})
