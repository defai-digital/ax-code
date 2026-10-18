// Exercise the positioned context-menu overlay against the native renderer.
import assert from "node:assert/strict"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import type { ParentProps } from "solid-js"

const state = await fs.mkdtemp(path.join(os.tmpdir(), "ax-code-context-menu-"))
process.env.XDG_STATE_HOME = state
process.env.XDG_CONFIG_HOME = state
process.env.XDG_DATA_HOME = state
process.env.AX_CODE_DISABLE_PROJECT_CONFIG = "true"

const { testRender } = await import("ax-tui/solid")
const { MouseButton } = await import("ax-tui")
const { KVProvider } = await import("../src/cli/tui/context/kv")
const { TuiConfigProvider } = await import("../src/cli/tui/context/tui-config")
const { LanguageProvider, useLanguage } = await import("../src/cli/tui/context/language")
const { ThemeProvider } = await import("../src/cli/tui/context/theme")
const { KeybindProvider } = await import("../src/cli/tui/context/keybind")
const { ToastProvider } = await import("../src/cli/tui/ui/toast")
const { DialogProvider, DialogStack } = await import("../src/cli/tui/ui/dialog")
const { CommandProvider } = await import("../src/cli/tui/component/dialog-command")
const { useContextMenu } = await import("../src/cli/tui/ui/context-menu")

let menu!: ReturnType<typeof useContextMenu>
let t!: ReturnType<typeof useLanguage>["t"]
let deleted = 0

function Controls() {
  menu = useContextMenu()
  t = useLanguage().t
  return null
}

function Providers(props: ParentProps) {
  return (
    <KVProvider>
      <TuiConfigProvider config={{}}>
        <LanguageProvider>
          <ToastProvider>
            <ThemeProvider mode="dark">
              <KeybindProvider>
                <DialogProvider>
                  <CommandProvider>
                    <Controls />
                    {props.children}
                    <DialogStack />
                  </CommandProvider>
                </DialogProvider>
              </KeybindProvider>
            </ThemeProvider>
          </ToastProvider>
        </LanguageProvider>
      </TuiConfigProvider>
    </KVProvider>
  )
}

const setup = await testRender(() => <Providers />, { width: 60, height: 20 })
try {
  await setup.renderOnce()

  const deleteLabel = t("ui.deleteTask")
  const confirmLabel = t("ui.deleteTaskConfirm")
  const copyLabel = t("ui.copy")

  menu.openAt({ kind: "scheduled-task", x: 4, y: 3, taskID: "task-1", onDelete: () => deleted++ })
  await setup.flush()
  await setup.renderOnce()
  assert(setup.captureCharFrame().includes(deleteLabel), setup.captureCharFrame())

  // The menu content starts two columns after its offset (border + padding)
  // and one row below the offset (border).
  await setup.mockMouse.click(7, 4, MouseButton.LEFT)
  await setup.flush()
  await setup.renderOnce()
  assert(setup.captureCharFrame().includes(confirmLabel), setup.captureCharFrame())
  assert.equal(deleted, 0, "a single click armed the destructive action")

  await setup.mockMouse.click(7, 4, MouseButton.LEFT)
  await setup.flush()
  await setup.renderOnce()
  assert.equal(deleted, 1, "the second click did not delete")
  assert(!setup.captureCharFrame().includes(confirmLabel))

  menu.openAt({ kind: "clipboard", x: 2, y: 2, copy: true, paste: false })
  await setup.flush()
  await setup.renderOnce()
  assert(setup.captureCharFrame().includes(copyLabel), setup.captureCharFrame())

  menu.close()
  await setup.flush()
  await setup.renderOnce()
  assert(!setup.captureCharFrame().includes(copyLabel), "closing left the overlay mounted")

  console.log("context menu overlay checks passed")
} finally {
  setup.renderer.destroy()
  await fs.rm(state, { recursive: true, force: true })
}
