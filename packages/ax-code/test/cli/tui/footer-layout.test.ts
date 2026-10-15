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

  describe("measured footer content", () => {
    const base = {
      contentWidth: 76,
      toggleWidth: 0,
      mode: "normal" as const,
      clearWidth: footerHintWidth("ctrl+c", "exit"),
      variantsWidth: footerHintWidth("ctrl+t", "effort"),
      shellWidth: footerHintWidth("esc", "exit shell mode"),
    }

    test("drops the effort hint as a whole group when Home chips fill the 80-column row", () => {
      // 80x24 Home: mode + WebMCP chips measure 58 cells inside a 76-cell row.
      const layout = promptFooterLayout({ ...base, measured: { leftWidth: 0, gaugeWidth: 0, extraWidth: 58 } })
      expect(layout.stacked).toBe(false)
      expect(layout.showClearHint).toBe(true)
      expect(layout.showVariants).toBe(false)
    })

    test("keeps every hint when the measured row has room", () => {
      const layout = promptFooterLayout({
        ...base,
        contentWidth: 116,
        measured: { leftWidth: 0, gaugeWidth: 0, extraWidth: 58 },
      })
      expect(layout.showClearHint).toBe(true)
      expect(layout.showVariants).toBe(true)
    })

    test("never lets the right group exceed the row, including the idle left text and gauge", () => {
      for (let contentWidth = 0; contentWidth <= 140; contentWidth++) {
        for (const measured of [
          { leftWidth: 0, gaugeWidth: 0, extraWidth: 0 },
          { leftWidth: 8, gaugeWidth: 0, extraWidth: 0 },
          { leftWidth: 8, gaugeWidth: 14, extraWidth: 0 },
          { leftWidth: 0, gaugeWidth: 14, extraWidth: 40 },
        ]) {
          const layout = promptFooterLayout({ ...base, contentWidth, measured })
          const fixed = measured.gaugeWidth + measured.extraWidth + (measured.gaugeWidth && measured.extraWidth ? 1 : 0)
          const shown = [
            layout.showClearHint ? base.clearWidth : 0,
            layout.showVariants ? base.variantsWidth : 0,
          ].filter(Boolean)
          const leading = measured.extraWidth ? 2 : measured.gaugeWidth ? 1 : 0
          const hints = shown.reduce((sum, width, index) => sum + width + (index === 0 ? leading : 2), 0)
          const left = measured.leftWidth ? measured.leftWidth + 1 : 0
          if (shown.length > 0) expect(left + fixed + hints).toBeLessThanOrEqual(contentWidth)
        }
      }
    })

    test("uses the full row once busy status stacks onto its own line", () => {
      const layout = promptFooterLayout({
        ...base,
        contentWidth: 40,
        busy: true,
        measured: { leftWidth: 0, gaugeWidth: 30, extraWidth: 0 },
      })
      expect(layout.stacked).toBe(true)
      expect(layout.showClearHint).toBe(true)
      expect(layout.showVariants).toBe(true)
    })

    test("keeps the shell escape hint whole or drops it", () => {
      const shell = { ...base, mode: "shell" as const }
      expect(
        promptFooterLayout({ ...shell, contentWidth: 41, measured: { leftWidth: 0, gaugeWidth: 0, extraWidth: 20 } })
          .showShellHint,
      ).toBe(true)
      expect(
        promptFooterLayout({ ...shell, contentWidth: 40, measured: { leftWidth: 0, gaugeWidth: 0, extraWidth: 20 } })
          .showShellHint,
      ).toBe(false)
    })
  })
})
