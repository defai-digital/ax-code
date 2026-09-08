import { describe, expect, test } from "vitest"
import { barChart, chip, dailyChart, flow, gauge, stat, stepSummary } from "../../src/quality/dre-graph-widgets"

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

  test("escapes a non-enum gauge level so it can never inject SVG content", () => {
    // Regression for the latent XSS finding: gauge's `<text>` interpolates
    // a level string. The helper must self-enforce escape regardless of
    // caller. The actual output uppercases the input via toUpperCase()
    // before esc(); the brackets are entity-encoded but their case is
    // preserved.
    const html = gauge({ score: 50, max: 100, level: "<script>foo</script>" })
    expect(html).toContain("&lt;SCRIPT&gt;FOO&lt;/SCRIPT&gt;")
    // The literal `<script>` tag must not survive.
    expect(html).not.toContain("<script>foo</script>")
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
})

describe("quality.dre-graph-widgets.dailyChart", () => {
  test("slices the MM-DD suffix when day is YYYY-MM-DD", () => {
    const html = dailyChart({ days: [{ day: "2026-09-08", sessions: 1, tokens: 10 }] })
    expect(html).toContain(`>09-08</span>`)
  })

  test("renders the full day string when the format is not YYYY-MM-DD", () => {
    // Defensive against a future dayKey change: never silently truncate.
    const html = dailyChart({ days: [{ day: "Sep 8", sessions: 1, tokens: 10 }] })
    expect(html).toContain(`>Sep 8</span>`)
  })

  test("escapes the day label", () => {
    const html = dailyChart({ days: [{ day: "<2026>&", sessions: 1, tokens: 10 }] })
    expect(html).toContain("&lt;2026&gt;&amp;")
    expect(html).not.toContain("<2026>&")
  })
})
