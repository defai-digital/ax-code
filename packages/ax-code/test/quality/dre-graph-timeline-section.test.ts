import { describe, expect, test } from "bun:test"
import { timelineSection } from "../../src/quality/dre-graph-timeline-section"
import type { SessionDre } from "../../src/session/dre"

function dre(timeline: SessionDre.TimelineLine[], detail?: Partial<SessionDre.Detail>): SessionDre.Snapshot {
  return {
    timeline,
    detail: detail ? (detail as SessionDre.Detail) : null,
  }
}

describe("quality.dre-graph-timeline-section", () => {
  test("renders gantt timeline, tool timing, notes, and rollback empty state", () => {
    const detail = { notes: ["Note <one>&"] } as SessionDre.Detail
    const html = timelineSection(
      dre([
        { kind: "heading", text: "Timeline <heading>" },
        { kind: "step", text: "Step 0 · 2s · tokens 3/5" },
        { kind: "route", text: "main <agent> -> helper" },
        { kind: "tool", text: "read: src/a.ts → ok (500ms)" },
        { kind: "tool", text: "read: src/b.ts → ok (700ms)" },
        { kind: "tool", text: "bash → ERR (1200ms)" },
        { kind: "error", text: "Failed <tool>&" },
        { kind: "step", text: "Step 1 · 1s" },
        { kind: "tool", text: "edit: src/a.ts → ok (100ms)" },
      ]),
      [],
      detail,
    )

    expect(html).toContain(`<section class="band" id="timeline">`)
    expect(html).toContain(`Timeline &lt;heading&gt;`)
    expect(html).toContain(`<span class="gantt-label">Step 0</span>`)
    expect(html).toContain(`width:100.0%;background:var(--high)`)
    expect(html).toContain(`read <span class="gantt-tool-count">×2</span>`)
    expect(html).toContain(`<span class="gantt-tool-ms">1.2s</span>`)
    expect(html).toContain(`main &lt;agent&gt; -&gt; helper`)
    expect(html).toContain(`Failed &lt;tool&gt;&amp;`)
    expect(html).toContain(`Note &lt;one&gt;&amp;`)
    expect(html).toContain(`Run a session with assistant steps to populate rollback points.`)
  })

  test("renders empty timeline state", () => {
    const html = timelineSection(dre([]), [])

    expect(html).toContain(`<p class="empty">No timeline recorded.</p>`)
    expect(html).toContain(`<span class="rb-count">0</span>`)
  })

  test("uses turn labels when timeline steps share the same step index", () => {
    const html = timelineSection(
      dre([
        { kind: "step", text: "Step 0 · 1s" },
        { kind: "tool", text: "read → ok" },
        { kind: "step", text: "Step 0 · 1s" },
        { kind: "tool", text: "edit → ok" },
      ]),
      [],
    )

    expect(html).toContain(`<span class="gantt-label">Turn 1</span>`)
    expect(html).toContain(`<span class="gantt-label">Turn 2</span>`)
  })
})
