// Native renderer regression for #454; no model requests or real user state.
import assert from "node:assert/strict"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import type { ParentProps } from "solid-js"

const state = await fs.mkdtemp(path.join(os.tmpdir(), "ax-code-footer-"))
process.env.XDG_STATE_HOME = state
process.env.XDG_CONFIG_HOME = state
process.env.XDG_DATA_HOME = state
process.env.AX_CODE_DISABLE_PROJECT_CONFIG = "true"
const { testRender } = await import("ax-tui/solid")
const { createSignal } = await import("solid-js")
const { KVProvider } = await import("../src/cli/tui/context/kv")
const { TuiConfigProvider } = await import("../src/cli/tui/context/tui-config")
const { LanguageProvider } = await import("../src/cli/tui/context/language")
const { ThemeProvider } = await import("../src/cli/tui/context/theme")
const { ToastProvider } = await import("../src/cli/tui/ui/toast")
const { FooterStatusRow } = await import("../src/cli/tui/component/prompt/footer-status-row")
const { KeyHint } = await import("../src/cli/tui/ui/primitives/key-hint")
const { LOCALES, translate } = await import("../src/cli/tui/i18n")
const { footerHintWidth, promptFooterLayout } = await import("../src/cli/tui/component/prompt/footer-layout")

function Providers(props: ParentProps) {
  return (
    <KVProvider>
      <TuiConfigProvider config={{}}>
        <LanguageProvider>
          <ToastProvider>
            <ThemeProvider mode="dark">{props.children}</ThemeProvider>
          </ToastProvider>
        </LanguageProvider>
      </TuiConfigProvider>
    </KVProvider>
  )
}

let cases = 0
try {
  // Keep the same mounted component while shrinking and expanding the terminal.
  const [width, setWidth] = createSignal(120)
  const [label, setLabel] = createSignal("interrupt")
  const [message, setMessage] = createSignal("")
  const [interrupt, setInterrupt] = createSignal(true)
  const layout = () =>
    promptFooterLayout({
      contentWidth: width(),
      toggleWidth: 0,
      mode: "normal",
      variantsWidth: 16,
      shellWidth: 0,
      clearWidth: 11,
      busy: true,
    })
  const setup = await testRender(
    () => (
      <Providers>
        <box flexDirection={layout().stacked ? "column" : "row"}>
          <FooterStatusRow width={width()} interrupt={interrupt() ? label() : undefined}>
            <box flexDirection="row" flexShrink={0} gap={1}>
              <text wrapMode="none">{"??"}</text>
              <text wrapMode="none">{message()}</text>
            </box>
          </FooterStatusRow>
          <text wrapMode="none">{"context 99% compacted 100 times ctrl+c clear shift-tab effort"}</text>
        </box>
      </Providers>
    ),
    { width: 120, height: 6 },
  )
  try {
    for (const locale of LOCALES) {
      setLabel(translate(locale, "ui.interrupt"))
      for (const text of [
        "Working",
        "input tokens 999.9k output tokens 999.9k - 999.9 tok/s",
        "Retry: " + "long provider error ".repeat(20),
      ]) {
        setMessage(text)
        for (const columns of [120, 80, 40, 20, 13, 8, 3, 80]) {
          setWidth(columns)
          setup.resize(columns, 6)
          await setup.flush()
          const frame = setup.captureCharFrame()
          const lines = frame.split("\n")
          const context = JSON.stringify({ locale, columns, text, frame })
          assert(lines[0].includes("esc"), context)
          if (columns >= footerHintWidth("esc", label())) assert(lines[0].includes("esc " + label()), context)
          assert(
            lines.slice(2).every((line) => !line.trim()),
            context,
          )
          cases++
        }
      }
    }
    setInterrupt(false)
    setMessage("Subagent working")
    await setup.flush()
    assert(!setup.captureCharFrame().includes("esc"), "idle parent must not advertise interrupt")
  } finally {
    setup.renderer.destroy()
  }
  // Demonstrate that the original unprotected flex row actually wraps the hint.
  const legacy = await testRender(
    () => (
      <Providers>
        <box flexDirection="row" width={20}>
          <box flexShrink={0} width={15}>
            <text>long status</text>
          </box>
          <KeyHint keys="esc" label="interrupt" />
        </box>
      </Providers>
    ),
    { width: 20, height: 6 },
  )
  try {
    await legacy.flush()
    const lines = legacy.captureCharFrame().split("\n")
    assert(!lines[0].includes("esc interrupt"))
    assert(
      lines.slice(1).some((line) => line.trim()),
      "legacy control must reproduce wrapping",
    )
  } finally {
    legacy.renderer.destroy()
  }
  console.log(
    `PASS: ${cases} native footer frames, ${LOCALES.length} locales, live resize, long tokens/retries, idle parent, and failing legacy control.`,
  )
} finally {
  await fs.rm(state, { recursive: true, force: true })
}
