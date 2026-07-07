import { describe, expect, test } from "vitest"
import { style } from "../../src/quality/dre-graph-style"

describe("quality.dre-graph-style", () => {
  test("renders theme variables and core DRE graph selectors", () => {
    const css = style()

    expect(css).toContain(`:root, [data-theme="dark"]`)
    expect(css).toContain(`[data-theme="light"]`)
    expect(css).toContain(`--accent: #3b82f6`)
    expect(css).toContain(`.summary-grid`)
    expect(css).toContain(`.verdict-grid`)
    expect(css).toContain(`.gviz-summary-bar`)
    expect(css).toContain(`.bar-chart`)
    expect(css).toContain(`@media (max-width: 900px)`)
  })
})
