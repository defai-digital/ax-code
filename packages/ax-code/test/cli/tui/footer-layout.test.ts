import { describe, expect, test } from "vitest"
import { footerHintWidth, promptFooterLayout } from "../../../src/cli/tui/component/prompt/footer-layout"

describe("promptFooterLayout", () => {
  test("measures terminal cells rather than UTF-16 code units", () => {
    expect(footerHintWidth("esc", "中断")).toBe(8)
    expect(footerHintWidth("esc", "interrupt")).toBe(13)
    expect(footerHintWidth("esc", "e\u0301")).toBe(5)
  })

  test.each([20, 40, 80, 120, 200])("isolates busy status from secondary widgets at %i columns", (contentWidth) => {
    expect(
      promptFooterLayout({
        contentWidth,
        toggleWidth: 0,
        mode: "normal",
        busy: true,
        clearWidth: 11,
        variantsWidth: 16,
        shellWidth: 0,
      }).stacked,
    ).toBe(true)
  })

  test("accounts for the two-cell gap between rendered shortcuts", () => {
    const input = {
      contentWidth: 64,
      toggleWidth: 0,
      mode: "normal" as const,
      clearWidth: 11,
      variantsWidth: 16,
      shellWidth: 0,
    }
    expect(promptFooterLayout(input).showVariants).toBe(false)
    expect(promptFooterLayout({ ...input, contentWidth: 67 }).showVariants).toBe(true)
  })
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
