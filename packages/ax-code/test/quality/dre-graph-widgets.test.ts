import { describe, expect, test } from "vitest"
import { barChart, chip, donut, flow, gauge, stat, stepSummary } from "../../src/quality/dre-graph-widgets"

describe("quality.dre-graph-widgets", () => {
  test("escapes chip and stat text", () => {
    expect(chip({ label: `<label&>`, kind: `x"y` })).toContain(`class="chip x&quot;y"`)
    expect(chip({ label: `<label&>`, kind: `x"y` })).toContain("&lt;label&amp;&gt;")

    const html = stat({ label: `<label>`, value: `5&6`, kind: `danger"zone`, icon: "!" })
    expect(html).toContain(`class="stat danger&quot;zone"`)
    expect(html).toContain("&lt;label&gt;")
    expect(html).toContain("5&amp;6")
    expect(html).toContain(`<span class="stat-icon">!</span>`)
  })

  test("compresses and truncates flow nodes", () => {
    expect(flow([])).toBe(`<p class="empty">No recorded nodes.</p>`)

    const html = flow(["read", "read", "edit<script>", "write"], { max: 2 })
    expect(html).toContain(`<span class="node group">read<span class="node-count">×2</span></span>`)
    expect(html).toContain("edit&lt;script&gt;")
    expect(html).toContain(`<span class="node trunc">+1 more</span>`)
  })

  test("summarizes tool calls and skips result or step marker nodes", () => {
    expect(stepSummary([])).toBe(`<span class="muted">empty</span>`)

    const html = stepSummary(["Step 1", "Start session", "read: file", "read ok", "edit:<x>", "edit:<x>", "glob ERR"])
    expect(html).toContain(`<span class="step-bar-label">edit</span>`)
    expect(html).toContain(`<span class="step-bar-count">2</span>`)
    expect(html).toContain(`<span class="step-bar-label">read</span>`)
    expect(html).not.toContain("Step 1")
    expect(html).not.toContain("read ok")
  })

  test("renders risk gauge with tone color", () => {
    const html = gauge({ score: 50, max: 100, level: "HIGH" })
    expect(html).toContain(`class="gauge"`)
    expect(html).toContain(`stroke="#ef4444"`)
    expect(html).toContain(`>50</text>`)
    expect(html).toContain(`>HIGH</text>`)
  })

  test("renders bar chart data and escapes labels", () => {
    expect(barChart({ items: [] })).toBe(`<p class="empty">No data.</p>`)

    const html = barChart({
      items: [{ label: `unsafe<script>`, value: 5, detail: `detail&` }],
      max: 10,
      unit: `%<`,
      colorFn: () => "#fff",
    })
    expect(html).toContain(`width:50.0%;background:#fff`)
    expect(html).toContain("unsafe&lt;script&gt;")
    expect(html).toContain("5%&lt;")
    expect(html).toContain("detail&amp;")
  })

  test("renders donut legend percentages and escapes labels", () => {
    expect(donut({ segments: [{ label: "empty", value: 0, color: "#fff" }] })).toBe(`<p class="empty">No data.</p>`)

    const html = donut({
      segments: [
        { label: "input<script>", value: 25, color: "#38bdf8" },
        { label: "output", value: 75, color: "#f97316" },
      ],
      size: 96,
    })
    expect(html).toContain(`width="96" height="96"`)
    expect(html).toContain("input&lt;script&gt;")
    expect(html).toContain("(25%)")
    expect(html).toContain("(75%)")
  })
})
