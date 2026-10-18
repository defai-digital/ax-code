// Exercise real Solid dialogs with the native renderer and isolated user state.
import assert from "node:assert/strict"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import type { ParentProps } from "solid-js"
import type { Renderable } from "ax-tui"

const state = await fs.mkdtemp(path.join(os.tmpdir(), "ax-code-locales-"))
process.env.XDG_STATE_HOME = state
process.env.XDG_CONFIG_HOME = state
process.env.XDG_DATA_HOME = state
process.env.AX_CODE_DISABLE_PROJECT_CONFIG = "true"
const { testRender } = await import("ax-tui/solid")
const { getKeymap, InputRenderable, MouseButton, ScrollBoxRenderable, TextRenderable } = await import("ax-tui")
const { KVProvider, useKV } = await import("../src/cli/tui/context/kv")
const { TuiConfigProvider } = await import("../src/cli/tui/context/tui-config")
const { LanguageProvider, useLanguage } = await import("../src/cli/tui/context/language")
const { ThemeProvider } = await import("../src/cli/tui/context/theme")
const { KeybindProvider, useKeybind } = await import("../src/cli/tui/context/keybind")
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
const { Keybinds } = await import("../src/config/schema")
const { createEffect } = await import("solid-js")

let language!: ReturnType<typeof useLanguage>
let dialog!: ReturnType<typeof useDialog>
let kvStore!: ReturnType<typeof useKV>
let ready = false
let keybind!: ReturnType<typeof useKeybind>
let backgroundCommands = 0
function findRenderable(node: Renderable, matches: (node: Renderable) => boolean): Renderable | undefined {
  if (matches(node)) return node
  for (const child of node.getChildren()) {
    const found = findRenderable(child, matches)
    if (found) return found
  }
}
function Controls() {
  language = useLanguage()
  dialog = useDialog()
  const kv = useKV()
  kvStore = kv
  keybind = useKeybind()
  useCommandDialog().register(() => [
    {
      title: "Background command probe",
      value: "test.background-command",
      keybind: "session_new",
      onSelect: () => backgroundCommands++,
    },
  ])
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
      <TuiConfigProvider config={{ keybinds: Keybinds.parse({}) }}>
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
    const setup = await testRender(() => <Providers />, { width, height, exitOnCtrlC: false })
    try {
      // KV hydration performs real filesystem I/O; render-idle is not I/O-idle.
      const hydrationDeadline = Date.now() + 5000
      while (!ready && Date.now() < hydrationDeadline) {
        await new Promise((resolve) => setTimeout(resolve, 5))
        await setup.flush()
      }
      assert(ready, "TUI preferences did not hydrate within five seconds")
      const keymap = getKeymap(setup.renderer)
      const keymapBindings = () => keymap.getActiveBindings().map((binding) => binding.id)
      const initialBindings = keymapBindings()
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
        const searchInput = setup.renderer.currentFocusedRenderable
        assert(searchInput instanceof InputRenderable, `${locale}: help search did not receive focus`)
        await setup.mockInput.typeText("session_new")
        await setup.flush()
        assert.equal(searchInput.value, "session_new", `${locale}: help search lost keyboard input`)
        assert(
          setup.captureCharFrame().includes(keybind.print("session_new")) &&
            setup.captureCharFrame().includes(translate(locale, "help.keybind.session_new").slice(0, 4)),
          `${locale}: help did not filter by schema id\n${setup.captureCharFrame()}`,
        )
        assert(
          !setup.captureCharFrame().includes(keybind.print("session_list")),
          `${locale}: help retained a non-matching binding`,
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
      assert.deepEqual(keymapBindings(), initialBindings, "help left keymap registrations after replacement")

      const background = new InputRenderable(setup.renderer, { id: "help-background-input", width: 10 })
      setup.renderer.root.add(background)
      background.focus()
      language.setLocale("en")
      dialog.replace(() => <DialogHelp />)
      await setup.flush()
      let searchInput = setup.renderer.currentFocusedRenderable
      assert(searchInput instanceof InputRenderable, "help search was not focused")
      const helpBindings = keymapBindings()
      assert.equal(helpBindings.filter((id) => id.startsWith("help.")).length, 5)
      const helpScroll = findRenderable(setup.renderer.root, (node) => node instanceof ScrollBoxRenderable)
      assert(helpScroll instanceof ScrollBoxRenderable, "help scrollbox was not found")
      setup.mockInput.pressKey("\x1b[6~")
      await setup.flush()
      assert(helpScroll.scrollTop > 0, "the focused help keymap did not scroll")
      const previousScroll = helpScroll.scrollTop
      helpScroll.focus()
      setup.mockInput.pressArrow("down")
      await setup.flush()
      assert(helpScroll.scrollTop > previousScroll, "help navigation stopped when the scrollbox gained focus")
      searchInput.focus()
      assert(setup.captureCharFrame().includes(translate("en", "ui.keyboardShortcuts")), "help title disappeared")
      await setup.mockInput.typeText("no_matching_shortcut_987")
      await setup.flush()
      assert(
        setup.captureCharFrame().includes(translate("en", "common.noResults")),
        "empty help results were not shown",
      )
      assert.equal(helpScroll.scrollTop, 0, "filtering did not reset the help scroll position")
      setup.mockInput.pressArrow("down")
      await setup.flush()
      assert.equal(dialog.stack.length, 1, "navigation in empty help dismissed the dialog")
      setup.mockInput.pressKey("ESCAPE")
      await new Promise((resolve) => setTimeout(resolve, 150))
      await setup.flush()
      assert.equal(dialog.stack.length, 1, "first Escape dismissed help instead of clearing search")
      assert.equal(searchInput.value, "", "Escape did not clear the native editor")
      assert.equal(setup.renderer.currentFocusedRenderable, searchInput)
      assert.deepEqual(keymapBindings(), helpBindings, "filtering duplicated keymap registrations")
      assert(!setup.captureCharFrame().includes(translate("en", "common.noResults")), "Escape left stale filtered rows")
      assert(
        findRenderable(
          setup.renderer.root,
          (node) => node instanceof TextRenderable && node.plainText === translate("en", "help.keybind.session_list"),
        ),
        "Escape did not restore the unfiltered shortcut list",
      )
      setup.mockInput.pressKey("ESCAPE")
      await new Promise((resolve) => setTimeout(resolve, 150))
      await setup.flush()
      assert.equal(dialog.stack.length, 0, "second Escape did not close the cleared help")
      assert.deepEqual(keymapBindings(), initialBindings)
      dialog.replace(() => <DialogHelp />)
      await setup.flush()
      searchInput = setup.renderer.currentFocusedRenderable
      assert(searchInput instanceof InputRenderable, "reopened help search was not focused")
      const heading = findRenderable(
        setup.renderer.root,
        (node) => node instanceof TextRenderable && node.plainText === translate("en", "ui.keyboardShortcuts"),
      )
      assert(heading, "help heading was not found")
      setup.renderer.startSelection(heading, heading.x, heading.y)
      setup.renderer.updateSelection(heading, heading.x + 4, heading.y, { finishDragging: true })
      assert(setup.renderer.getSelection()?.getSelectedText(), "selection probe did not select help text")
      setup.mockInput.pressKey("ESCAPE")
      await new Promise((resolve) => setTimeout(resolve, 150))
      await setup.flush()
      assert.equal(dialog.stack.length, 1, "Escape dismissed help while terminal text was selected")
      setup.renderer.clearSelection()
      await setup.mockInput.typeText("session_new")
      await setup.flush()
      setup.resize(width === 36 ? 80 : 36, 20)
      await setup.flush()
      assert.equal(searchInput.value, "session_new", "resizing lost the search")
      language.setLocale("zh-TW")
      await setup.flush()
      assert.equal(searchInput.value, "session_new", "locale switch lost the search")
      assert(
        setup.captureCharFrame().includes(translate("zh-TW", "help.keybind.session_new")),
        `localized help match disappeared: ${setup.captureCharFrame()}`,
      )
      searchInput.value = translate("zh-TW", "help.keybind.session_new")
      await setup.flush()
      assert(!setup.captureCharFrame().includes(translate("zh-TW", "common.noResults")), "localized search failed")
      setup.resize(width, height)
      await setup.flush()
      // Context-menu Escape must dismiss only the menu; the help query stays.
      dialog.contextMenu.openAt({ kind: "clipboard", x: 4, y: 3, copy: true, paste: false })
      await setup.flush()
      setup.mockInput.pressKey("ESCAPE")
      await new Promise((resolve) => setTimeout(resolve, 150))
      await setup.flush()
      assert.equal(dialog.contextMenu.current, undefined)
      assert.equal(dialog.stack.length, 1)
      assert.equal(searchInput.value, translate("zh-TW", "help.keybind.session_new"))
      setup.mockInput.pressCtrlC()
      await setup.flush()
      assert.equal(dialog.stack.length, 0, "Ctrl+C did not dismiss filtered help")
      assert(searchInput.isDestroyed, "closing help left the search editor alive")
      assert.deepEqual(keymapBindings(), initialBindings)
      assert.equal(setup.renderer.currentFocusedRenderable, background, "closing help did not restore focus")

      // A leader started before opening help must not run a background action.
      const previousCommands = backgroundCommands
      setup.mockInput.pressKey("x", { ctrl: true })
      await setup.flush()
      assert(keybind.leader, "the legacy leader did not activate")
      dialog.replace(() => <DialogHelp />)
      await setup.flush()
      setup.mockInput.pressKey("n")
      await setup.flush()
      assert.equal(backgroundCommands, previousCommands, "help dispatched a background leader command")
      setup.mockInput.pressKey("RETURN")
      await setup.flush()
      assert.equal(dialog.stack.length, 0, "Enter did not dismiss help")
      assert.deepEqual(keymapBindings(), initialBindings)
      dialog.replace(() => <DialogHelp />)
      await setup.flush()
      setup.mockInput.pressKey("ESCAPE")
      await new Promise((resolve) => setTimeout(resolve, 150))
      await setup.flush()
      assert.equal(dialog.stack.length, 0, "empty-search Escape did not dismiss help")
      assert.deepEqual(keymapBindings(), initialBindings, "reopening help leaked keymap registrations")
      dialog.replace(() => <DialogHelp />)
      await setup.flush()
      const clickedSearch = setup.renderer.currentFocusedRenderable
      assert(clickedSearch instanceof InputRenderable, "help search was not focused before clicking Escape")
      await setup.mockInput.typeText("no_matching_shortcut_987")
      await setup.flush()
      const escapeButton = findRenderable(
        setup.renderer.root,
        (node) => node instanceof TextRenderable && node.plainText === "esc",
      )
      assert(escapeButton, "help Escape action was not found")
      await setup.mockMouse.click(escapeButton.x, escapeButton.y, MouseButton.LEFT)
      await setup.flush()
      assert.equal(clickedSearch.value, "", "clicking Escape did not clear search")
      assert.equal(dialog.stack.length, 1, "clicking Escape dismissed filtered help")
      assert(!setup.captureCharFrame().includes(translate(language.locale(), "common.noResults")))
      await setup.mockMouse.click(escapeButton.x, escapeButton.y, MouseButton.LEFT)
      await setup.flush()
      assert.equal(dialog.stack.length, 0, "clicking Escape again did not close help")
      assert.deepEqual(keymapBindings(), initialBindings)
      background.destroyRecursively()
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
    `Native locale dialogs passed: ${LOCALES.length} locales, 36/80 columns, live switch, picker, setup language/connect/skip, searchable help, scoped navigation, selection/Escape policy, focus restoration, keymap disposal, and cancel action.`,
  )
} finally {
  // Preference writes can finish after renderer disposal; do not let transient
  // ENOTEMPTY errors hide a rendering assertion during temporary-state cleanup.
  await fs.rm(state, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
}
