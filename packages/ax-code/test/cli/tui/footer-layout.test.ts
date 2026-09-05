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

  test("hides the tip when stacked or when tipWidth is not supplied", () => {
    const tight = promptFooterLayout({
      contentWidth: 48,
      toggleWidth: 39,
      mode: "normal",
      variantsWidth: footerHintWidth("shift-tab", "variants"),
      shellWidth: footerHintWidth("esc", "exit shell mode"),
      clearWidth: footerHintWidth("ctrl+c", "clear"),
      tipWidth: 40,
    })
    expect(tight.stacked).toBe(true)
    expect(tight.showTip).toBe(false)

    const unspecified = promptFooterLayout({
      contentWidth: 124,
      toggleWidth: 39,
      mode: "normal",
      variantsWidth: footerHintWidth("shift-tab", "variants"),
      shellWidth: footerHintWidth("esc", "exit shell mode"),
      clearWidth: footerHintWidth("ctrl+c", "clear"),
    })
    expect(unspecified.showTip).toBe(false)
  })

  test("never shows the tip in shell mode", () => {
    const layout = promptFooterLayout({
      contentWidth: 124,
      toggleWidth: 0,
      mode: "shell",
      variantsWidth: 0,
      shellWidth: footerHintWidth("esc", "exit shell mode"),
      clearWidth: 0,
      tipWidth: 40,
    })

    expect(layout.stacked).toBe(false)
    expect(layout.showTip).toBe(false)
  })

  test("shows the tip only after the clear and variant hints fit", () => {
    const clearWidth = footerHintWidth("ctrl+c", "clear")
    const variantsWidth = footerHintWidth("shift-tab", "variants")
    const tipWidth = 40
    // Inline budget = contentWidth - 36 (INLINE_STATUS_RESERVE); the layout
    // also spends one gap column between the clear and variant hints, so the
    // tip fits exactly when spare width reaches tipWidth.
    const base = 36 + clearWidth + variantsWidth + tipWidth

    // One column short: clear + variants fit, the tip does not.
    const noTipRoom = promptFooterLayout({
      contentWidth: base + 1,
      toggleWidth: 0,
      mode: "normal",
      variantsWidth,
      shellWidth: 0,
      clearWidth,
      tipWidth,
    })
    expect(noTipRoom.showClearHint).toBe(true)
    expect(noTipRoom.showVariants).toBe(true)
    expect(noTipRoom.showTip).toBe(false)

    // Two spare columns: the tip fits.
    const withTip = promptFooterLayout({
      contentWidth: base + 2,
      toggleWidth: 0,
      mode: "normal",
      variantsWidth,
      shellWidth: 0,
      clearWidth,
      tipWidth,
    })
    expect(withTip.showClearHint).toBe(true)
    expect(withTip.showVariants).toBe(true)
    expect(withTip.showTip).toBe(true)

    // Width that fits clear but not variants or tip keeps clear only.
    const clearOnly = promptFooterLayout({
      contentWidth: 36 + clearWidth + 1,
      toggleWidth: 0,
      mode: "normal",
      variantsWidth,
      shellWidth: 0,
      clearWidth,
      tipWidth,
    })
    expect(clearOnly.showClearHint).toBe(true)
    expect(clearOnly.showVariants).toBe(false)
    expect(clearOnly.showTip).toBe(false)
  })
})
