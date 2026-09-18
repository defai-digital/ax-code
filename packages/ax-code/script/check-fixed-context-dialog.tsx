// Exercise real Solid dialogs with the native renderer and isolated user state.
import assert from "node:assert/strict"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import type { ParentProps } from "solid-js"

const state = await fs.mkdtemp(path.join(os.tmpdir(), "ax-code-fixed-dialog-"))
process.env.XDG_STATE_HOME = state
process.env.XDG_CONFIG_HOME = state
process.env.XDG_DATA_HOME = state
process.env.AX_CODE_DISABLE_PROJECT_CONFIG = "true"
const { testRender } = await import("ax-tui/solid")
const { KVProvider, useKV } = await import("../src/cli/tui/context/kv")
const { TuiConfigProvider } = await import("../src/cli/tui/context/tui-config")
const { LanguageProvider, useLanguage } = await import("../src/cli/tui/context/language")
const { ThemeProvider } = await import("../src/cli/tui/context/theme")
const { KeybindProvider } = await import("../src/cli/tui/context/keybind")
const { ToastProvider } = await import("../src/cli/tui/ui/toast")
const { DialogProvider, useDialog } = await import("../src/cli/tui/ui/dialog")
const { FixedContextDialog } = await import("../src/cli/tui/component/dialog-fixed-context")
const { createEffect } = await import("solid-js")

let language!: ReturnType<typeof useLanguage>
let dialog!: ReturnType<typeof useDialog>
let kvStore!: ReturnType<typeof useKV>
let ready = false
function Controls() {
  language = useLanguage()
  dialog = useDialog()
  const kv = useKV()
  kvStore = kv
  createEffect(() => {
    ready = kv.ready
  })
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
                  <Controls />
                  {props.children}
                </DialogProvider>
              </KeybindProvider>
            </ThemeProvider>
          </ToastProvider>
        </LanguageProvider>
      </TuiConfigProvider>
    </KVProvider>
  )
}

try {
  for (const [width, height] of [
    [50, 24],
    [80, 30],
  ]) {
    ready = false
    const setup = await testRender(() => <Providers />, { width, height })
    try {
      const deadline = Date.now() + 5000
      while (!ready && Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 5))
        await setup.flush()
        await setup.renderOnce()
      }
      assert(ready)
      let requestSignal: AbortSignal | undefined
      let resolve!: (value: {
        answer: string
        cache: { status: "HIT" }
        contextDigest: string
        providerID: string
        modelID: string
      }) => void
      dialog.replace(() => (
        <FixedContextDialog
          model="trust/model"
          directory="/workspace"
          run={async (files, question, signal) => {
            assert.deepEqual(files, ["value.py"])
            assert.equal(question, "What does it return?")
            requestSignal = signal
            return new Promise((r) => {
              resolve = r
            })
          }}
        />
      ))
      await setup.flush()
      await setup.renderOnce()
      assert(setup.captureCharFrame().includes("Ask about fixed files"))
      await setup.mockInput.typeText("value.py")
      await new Promise((r) => setTimeout(r, 30))
      setup.mockInput.pressKey("RETURN")
      await new Promise((r) => setTimeout(r, 30))
      await setup.flush()
      await setup.renderOnce()
      assert(setup.captureCharFrame().includes("Question about selected files"), setup.captureCharFrame())
      await setup.mockInput.typeText("What does it return?")
      setup.mockInput.pressKey("RETURN")
      await new Promise((r) => setTimeout(r, 30))
      await setup.flush()
      await setup.renderOnce()
      assert(setup.captureCharFrame().includes("Asking AX Trust"))
      resolve({
        answer: "It returns 43.",
        cache: { status: "HIT" },
        contextDigest: "hash",
        providerID: "trust",
        modelID: "model",
      })
      await setup.flush()
      await setup.renderOnce()
      assert(setup.captureCharFrame().includes("It returns 43."))
      assert(setup.captureCharFrame().includes("cache: HIT"))
      setup.mockInput.pressKey("r")
      await setup.flush()
      await setup.renderOnce()
      setup.mockInput.pressKey("RETURN")
      await new Promise((r) => setTimeout(r, 30))
      await setup.flush()
      await setup.renderOnce()
      setup.mockInput.pressKey("ESCAPE")
      await new Promise((r) => setTimeout(r, 150))
      await setup.flush()
      await setup.renderOnce()
      assert(requestSignal?.aborted, "closing did not cancel")
      resolve({
        answer: "Late answer",
        cache: { status: "HIT" },
        contextDigest: "hash",
        providerID: "trust",
        modelID: "model",
      })
      await setup.flush()
      await setup.renderOnce()
      assert.equal(dialog.stack.length, 0)
      assert(!setup.captureCharFrame().includes("Late answer"))
    } finally {
      setup.renderer.destroy()
    }
  }
  console.log("Fixed-context native dialogs passed: file/question input, result, repeat and cancel at 50/80 columns.")
} finally {
  await fs.rm(state, { recursive: true, force: true })
}
