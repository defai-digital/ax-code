// Exercise real Solid dialogs with the native renderer and isolated user state.
import assert from "node:assert/strict"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import type { ParentProps } from "solid-js"

const state = await fs.mkdtemp(path.join(os.tmpdir(), "ax-code-locales-"))
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
const { DialogProvider, DialogStack, useDialog } = await import("../src/cli/tui/ui/dialog")
const { CommandProvider, useCommandDialog } = await import("../src/cli/tui/component/dialog-command")
const { SetupWizard } = await import("../src/cli/tui/component/setup-wizard")
const { DialogLanguage } = await import("../src/cli/tui/component/dialog-language")
const { DialogHelp } = await import("../src/cli/tui/ui/dialog-help")
const { footerSessionStatusView } = await import("../src/cli/tui/routes/session/footer-view-model")
const { DialogConfirm } = await import("../src/cli/tui/ui/dialog-confirm")
const { LOCALES, LANGUAGE_LABELS, translate } = await import("../src/cli/tui/i18n")
const { stringWidth } = await import("../src/bun/node-compat")
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
function StatusProbe() {
  const { t } = useLanguage()
  return (
    <text>{footerSessionStatusView({ t, status: { type: "busy", waitState: "tool", activeTool: "read" } }).label}</text>
  )
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

try {
  for (const [width, height] of [
    [36, 20],
    [80, 30],
  ]) {
    ready = false
    const setup = await testRender(() => <Providers />, { width, height })
    try {
      // KV hydration performs real filesystem I/O; render-idle is not I/O-idle.
      const hydrationDeadline = Date.now() + 5000
      while (!ready && Date.now() < hydrationDeadline) {
        await new Promise((resolve) => setTimeout(resolve, 5))
        await setup.flush()
      }
      assert(ready, "TUI preferences did not hydrate within five seconds")
      const selectionListeners = setup.renderer.listenerCount("selection")
      for (const locale of LOCALES) {
        language.setLocale(locale)
        language.setConversation("auto")
        kvStore.set("setup_language_done_v1", false)
        let setupAction = "none"
        const wizard = () => (
          <SetupWizard
            guidance={{
              state: "connect",
              showIntroduction: false,
              modelCommand: "provider.connect",
              message: translate(language.locale(), "setup.connectMessage"),
            }}
            onLanguages={() => {
              setupAction = "language"
            }}
            onConnect={() => {
              setupAction = "connect"
            }}
          />
        )
        dialog.replace(wizard)
        await setup.flush()
        assert(
          setup.captureCharFrame().includes(translate(locale, "setup.languages")),
          JSON.stringify({ locale, width, frame: setup.captureCharFrame() }),
        )
        setup.mockInput.pressKey("HOME")
        for (let i = 0; i < LOCALES.indexOf(locale); i++) setup.mockInput.pressArrow("down")
        setup.mockInput.pressKey("RETURN")
        await setup.flush()
        assert.equal(language.locale(), locale)
        assert(
          setup.captureCharFrame().includes(translate(locale, "setup.provider")),
          `${locale}: provider action missing\n${setup.captureCharFrame()}`,
        )
        setup.mockInput.pressKey("HOME")
        setup.mockInput.pressArrow("down")
        setup.mockInput.pressKey("RETURN")
        await setup.flush()
        assert.equal(setupAction, "connect")
        assert.equal(kvStore.get("setup_resume_v1"), true)
        setup.mockInput.pressKey("END")
        setup.mockInput.pressKey("RETURN")
        await setup.flush()
        assert.equal(kvStore.get("setup_resume_v1"), false, `${locale}: skip did not clear resume`)
        assert.equal(dialog.stack.length, 0, `${locale}: setup skip left dialog stack at ${dialog.stack.length}`)

        dialog.replace(() => (
          <SetupWizard
            guidance={{ state: "selected", showIntroduction: true, modelCommand: "model.list" }}
            onLanguages={() => {}}
            onConnect={() => {}}
          />
        ))
        await setup.flush()
        assert(
          setup.captureCharFrame().includes(translate(locale, "setup.ready")),
          `${locale}: first task action hidden at ${width}x${height}\n${setup.captureCharFrame()}`,
        )
        assert(
          setup.captureCharFrame().includes(translate(locale, "setup.skip")),
          `${locale}: skip action hidden at ${width}x${height}`,
        )
        dialog.replace(() => <DialogLanguage />)
        await setup.flush()
        const frame = setup.captureCharFrame()
        assert(
          frame.includes(translate(locale, "language.title")),
          `${locale}: language settings title missing at ${width}`,
        )
        assert(frame.includes(LANGUAGE_LABELS[locale]), `${locale}: current language missing`)
        for (const line of frame.split("\n")) assert(stringWidth(line) <= width, `${locale}: overflow at ${width}`)
        // Real keyboard path opens the interface picker; protocol locale ids
        // stay independent from translated/autonym display labels.
        setup.mockInput.pressKey("HOME")
        setup.mockInput.pressKey("RETURN")
        await setup.flush()
        setup.mockInput.pressKey("HOME")
        for (const target of LOCALES) {
          await setup.flush()
          assert(setup.captureCharFrame().includes(LANGUAGE_LABELS[target]), `${locale}: cannot reach ${target}`)
          setup.mockInput.pressArrow("down")
        }
        // AX TUI 0.1.6 holds a lone ESC for 100ms so split CSI sequences are
        // not typed as keys. Wait past that timeout before asserting dismiss.
        setup.renderer.clearSelection()
        setup.mockInput.pressKey("ESCAPE")
        await new Promise((resolve) => setTimeout(resolve, 150))
        await setup.flush()
        assert.equal(
          dialog.stack.length,
          0,
          `${locale}: language picker escape left dialog stack at ${dialog.stack.length}\n${setup.captureCharFrame()}`,
        )
        let decision = "none"
        dialog.replace(() => (
          <DialogConfirm
            title={translate(locale, "permission.required")}
            message={translate(locale, "permission.dynamicWarning")}
            onConfirm={() => {
              decision = "confirm"
            }}
            onCancel={() => {
              decision = "cancel"
            }}
          />
        ))
        await setup.flush()
        const warning = setup.captureCharFrame()
        assert(warning.includes(translate(locale, "common.confirm")))
        assert(warning.includes(translate(locale, "common.cancel")))
        setup.mockInput.pressArrow("left")
        setup.mockInput.pressKey("RETURN")
        await setup.flush()
        assert.equal(decision, "cancel", `${locale}: translated cancel changed action`)
        language.setLocale("en")
        dialog.replace(() => <DialogHelp />)
        await setup.flush()
        language.setLocale(locale)
        await setup.flush()
        assert(
          setup.captureCharFrame().includes(translate(locale, "ui.keyboardShortcuts")),
          `${locale}: help did not update`,
        )
        language.setLocale("en")
        dialog.replace(() => <StatusProbe />)
        await setup.flush()
        language.setLocale(locale)
        await setup.flush()
        assert(
          setup.captureCharFrame().includes(translate(locale, "ui.scanningFiles")),
          `${locale}: runtime status did not update`,
        )
        dialog.clear()
        await setup.flush()
        assert.equal(
          setup.renderer.listenerCount("selection"),
          selectionListeners,
          `${locale}: leaked selection listeners`,
        )
      }
      // defai-digital/ax-code#470: dialogs render inside DialogStack, which must
      // be mounted within CommandProvider. DialogSetup calls useCommandDialog()
      // and crashed on first run when the stack rendered outside the command
      // context.
      function CommandContextProbe() {
        const command = useCommandDialog()
        return <text>{`command-context:${typeof command.trigger}`}</text>
      }
      dialog.replace(() => <CommandContextProbe />)
      await setup.flush()
      assert(
        setup.captureCharFrame().includes("command-context:function"),
        "dialog rendered outside CommandProvider cannot use useCommandDialog()",
      )
      dialog.clear()
      await setup.flush()
      // Live switch without a remount updates the actual dialog tree.
      language.setLocale("en")
      dialog.replace(() => <DialogLanguage />)
      await setup.flush()
      language.setLocale("ja")
      await setup.flush()
      assert(setup.captureCharFrame().includes(translate("ja", "language.title")))
    } finally {
      setup.renderer.destroy()
    }
  }
  console.log(
    `Native locale dialogs passed: ${LOCALES.length} locales, 36/80 columns, live switch, picker, setup language/connect/skip, help/status live switching, listener disposal, and cancel action.`,
  )
} finally {
  await fs.rm(state, { recursive: true, force: true })
}
