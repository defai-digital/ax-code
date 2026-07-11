import fs from "fs/promises"
import path from "path"
import { describe, expect, test } from "vitest"

// Regression guards for dialog action dispatch ordering and promise handling
// (source-pattern tests, matching the render-anti-patterns.test.ts approach):
// - DialogConfirm.show must resolve true/false, not undefined, which requires
//   the confirm/cancel handlers to run synchronously before dialog.clear().
// - DialogSelect must not discard async onSelect promises (double-fired
//   actions; unhandled rejections exit the whole TUI) and the mouse path must
//   share the confirmInFlight latch.
// - The heap-snapshot palette action must not float rejections.
// - Multi-prompt provider auth must keep each DialogPrompt open (autoClose)
//   so the deferred clear cannot kill the next prompt in the loop.

const TUI_ROOT = path.join(__dirname, "../../../src/cli/cmd/tui")
const DIALOG_CONFIRM_SRC = path.join(TUI_ROOT, "ui/dialog-confirm.tsx")
const DIALOG_SELECT_SRC = path.join(TUI_ROOT, "ui/dialog-select.tsx")
const DIALOG_PROVIDER_SRC = path.join(TUI_ROOT, "component/dialog-provider.tsx")
const APP_SRC = path.join(TUI_ROOT, "app.tsx")

describe("tui dialog action dispatch", () => {
  test("dialog confirm invokes the handler synchronously so show() resolves the choice", async () => {
    const dialogConfirm = await fs.readFile(DIALOG_CONFIRM_SRC, "utf8")

    // The action must be invoked before Promise.resolve wraps its result; a
    // deferred `.then(action)` loses the race against dialog.clear()'s
    // synchronous onClose → resolve(undefined).
    expect(dialogConfirm).toContain("void Promise.resolve(action()).catch(fail)")
    expect(dialogConfirm).not.toMatch(/Promise\.resolve\(\)\s*\.then\(action\)/)
    // The keyboard path runs the action before clearing the dialog.
    const keyboardIndex = dialogConfirm.indexOf('if (evt.name === "return")')
    expect(keyboardIndex).toBeGreaterThan(0)
    const keyboardBlock = dialogConfirm.slice(keyboardIndex, keyboardIndex + 700)
    const actionIndex = keyboardBlock.indexOf("runDialogConfirmAction")
    const clearIndex = keyboardBlock.indexOf("dialog.clear()")
    expect(actionIndex).toBeGreaterThan(0)
    expect(clearIndex).toBeGreaterThan(actionIndex)
  })

  test("dialog select returns the handlers' promises and latches the mouse path", async () => {
    const dialogSelect = await fs.readFile(DIALOG_SELECT_SRC, "utf8")

    // The wrapper lambda must forward the async handlers' promises so the
    // confirmInFlight latch spans the real work and rejections hit the toast.
    expect(dialogSelect).toContain("() => Promise.all([option.onSelect?.(dialog), props.onSelect?.(option)])")
    // Row clicks go through confirmSelected (latch + toast) instead of a
    // bare runDialogSelectAction with no double-fire protection.
    const mouseUpIndex = dialogSelect.indexOf("onMouseUp={() => {")
    const mouseUpBlock = dialogSelect.slice(mouseUpIndex, mouseUpIndex + 600)
    expect(mouseUpBlock).toContain("confirmSelected()")
    expect(mouseUpBlock).not.toContain("runDialogSelectAction")
  })

  test("heap snapshot palette action cannot float an unhandled rejection", async () => {
    const app = await fs.readFile(APP_SRC, "utf8")

    const snapshotIndex = app.indexOf("props.onSnapshot?.()")
    expect(snapshotIndex).toBeGreaterThan(0)
    const block = app.slice(snapshotIndex - 400, snapshotIndex + 700)
    expect(block).toContain("try {")
    expect(block).toContain("} catch (error) {")
    expect(block).toContain('"Failed to write heap snapshot"')
  })

  test("multi-prompt provider auth keeps every text prompt open across the loop", async () => {
    const dialogProvider = await fs.readFile(DIALOG_PROVIDER_SRC, "utf8")

    const promptsMethodIndex = dialogProvider.indexOf("async function PromptsMethod(")
    expect(promptsMethodIndex).toBeGreaterThan(0)
    const promptsMethodBlock = dialogProvider.slice(promptsMethodIndex)
    // Without autoClose={false} the deferred dialog.clear() from prompt N
    // closes prompt N+1, resolving it null and silently aborting the flow.
    expect(promptsMethodBlock).toContain("autoClose={false}")
    // The abort is surfaced to the user instead of being silent.
    expect(dialogProvider).toContain("Canceled connecting ${provider.name}")
  })
})
