import assert from "node:assert/strict"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { writeSync } from "node:fs"
import type { ParentProps } from "solid-js"
import type { BoxRenderable, Renderable } from "ax-tui"

const state = await fs.mkdtemp(path.join(os.tmpdir(), "ax-code-webmcp-render-"))
process.env.AX_CODE_TEST_HOME = state
process.env.XDG_CONFIG_HOME = state
process.env.XDG_DATA_HOME = state
process.env.XDG_STATE_HOME = state
const { testRender } = await import("ax-tui/solid")
const { KVProvider } = await import("../src/cli/tui/context/kv")
const { TuiConfigProvider } = await import("../src/cli/tui/context/tui-config")
const { LanguageProvider } = await import("../src/cli/tui/context/language")
const { ThemeProvider, useTheme } = await import("../src/cli/tui/context/theme")
const { KeybindProvider } = await import("../src/cli/tui/context/keybind")
const { DialogProvider } = await import("../src/cli/tui/ui/dialog")
const { ToastProvider } = await import("../src/cli/tui/ui/toast")
const { PermissionChoicePrompt } = await import("../src/cli/tui/routes/session/permission")
let expectedColor: string
let selection = ""

function Preview() {
  const { theme } = useTheme()
  expectedColor = theme.error.toString()
  return (
    <PermissionChoicePrompt
      title="Experimental WebMCP bridge call"
      body={<text>Operation: list_pages</text>}
      options={{ once: "Allow once", allowlist: "Add to WebMCP allowlist", reject: "Reject" }}
      dangerOption="allowlist"
      escapeKey="reject"
      onSelect={(option) => {
        selection = option
      }}
    />
  )
}
function Providers(props: ParentProps) {
  return (
    <KVProvider>
      <TuiConfigProvider config={{ keybinds: { permission_option_next: "right", permission_option_previous: "left" } }}>
        <LanguageProvider>
          <ToastProvider>
            <ThemeProvider mode="dark">
              <KeybindProvider>
                <DialogProvider>{props.children}</DialogProvider>
              </KeybindProvider>
            </ThemeProvider>
          </ToastProvider>
        </LanguageProvider>
      </TuiConfigProvider>
    </KVProvider>
  )
}
function find(root: Renderable, id: string): Renderable | undefined {
  if (root.id === id) return root
  for (const child of root.getChildren()) {
    const found = find(child, id)
    if (found) return found
  }
}
try {
  for (const width of [40, 80, 120]) {
    selection = ""
    const setup = await testRender(
      () => (
        <Providers>
          <Preview />
        </Providers>
      ),
      { width, height: 28 },
    )
    try {
      await setup.flush()
      await setup.renderOnce()
      const frame = setup.captureCharFrame()
      assert(frame.includes("Add to WebMCP allowlist"), frame)
      assert(frame.includes("Reject"), frame)
      const button = find(setup.renderer.root, "permission-option-allowlist") as BoxRenderable
      assert(button)
      assert.equal(button.backgroundColor.toString(), expectedColor!)
      setup.mockInput.pressKey("RETURN")
      await setup.flush()
      assert.equal(selection, "once", "Enter must default to Allow once")
      setup.mockInput.pressArrow("right")
      await setup.flush()
      await setup.renderOnce()
      assert(setup.captureCharFrame().includes("› Add to WebMCP allowlist"), setup.captureCharFrame())
      assert.equal(button.backgroundColor.toString(), expectedColor!)
      setup.mockInput.pressKey("RETURN")
      await setup.flush()
      assert.equal(selection, "allowlist")
    } finally {
      setup.renderer.destroy()
    }
  }
  writeSync(1, "WebMCP allowlist native render checks passed (40, 80, 120 columns)\n")
} finally {
  await fs.rm(state, { recursive: true, force: true })
}
