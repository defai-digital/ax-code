import { describe, expect, test } from "vitest"
import { footerHintWidth, promptFooterLayout } from "../../../src/cli/cmd/tui/component/prompt/footer-layout"

describe("promptFooterLayout", () => {
  test("stacks and hides secondary hints when inline budget is tight", () => {
    const layout = promptFooterLayout({
      contentWidth: 48,
      toggleWidth: 39,
      mode: "normal",
      variantsWidth: footerHintWidth("shift-tab", "variants"),
      shellWidth: footerHintWidth("esc", "exit shell mode"),
      clearWidth: footerHintWidth("ctrl+c", "clear"),
    })

    expect(layout.stacked).toBe(true)
    expect(layout.showVariants).toBe(false)
    expect(layout.showClearHint).toBe(false)
  })

  test("keeps the footer inline and reveals the variant hint as width allows", () => {
    const layout = promptFooterLayout({
      contentWidth: 124,
      toggleWidth: 39,
      mode: "normal",
      variantsWidth: footerHintWidth("shift-tab", "variants"),
      shellWidth: footerHintWidth("esc", "exit shell mode"),
      clearWidth: footerHintWidth("ctrl+c", "clear"),
    })

    expect(layout.stacked).toBe(false)
    expect(layout.showVariants).toBe(true)
    expect(layout.showClearHint).toBe(true)
  })

  test("prioritizes the clear/exit hint over the variant hint", () => {
    const layout = promptFooterLayout({
      contentWidth: 100,
      toggleWidth: 39,
      mode: "normal",
      variantsWidth: footerHintWidth("shift-tab", "variants"),
      shellWidth: footerHintWidth("esc", "exit shell mode"),
      clearWidth: footerHintWidth("ctrl+c", "clear"),
    })

    expect(layout.showClearHint).toBe(true)
    expect(layout.showVariants).toBe(false)
  })

  test("prioritizes the shell escape hint over normal-mode shortcuts", () => {
    const layout = promptFooterLayout({
      contentWidth: 92,
      toggleWidth: 39,
      mode: "shell",
      variantsWidth: 0,
      shellWidth: footerHintWidth("esc", "exit shell mode"),
      clearWidth: footerHintWidth("ctrl+c", "clear"),
    })

    expect(layout.stacked).toBe(true)
    expect(layout.showShellHint).toBe(true)
    expect(layout.showVariants).toBe(false)
    expect(layout.showClearHint).toBe(false)
  })
})
