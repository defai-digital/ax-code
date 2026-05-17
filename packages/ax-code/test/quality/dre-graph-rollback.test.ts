import { describe, expect, test } from "bun:test"
import { renderDreGraphRollbackBars, summarizeRollbackToolKinds } from "../../src/quality/dre-graph-rollback"
import { MessageID, PartID } from "../../src/session/schema"
import type { SessionRollback } from "../../src/session/rollback"

function point(input: { duration?: number; kinds?: string[] }): SessionRollback.Point {
  return {
    step: 1,
    messageID: MessageID.make("msg"),
    partID: PartID.make("part"),
    tools: [],
    kinds: input.kinds ?? [],
    duration: input.duration,
  }
}

describe("quality.dre-graph-rollback", () => {
  test("summarizes rollback tool kinds with counts", () => {
    expect(summarizeRollbackToolKinds(["read", "edit", "read", "bash<script>"])).toBe("read ×2, edit, bash<script>")
  })

  test("renders rollback bars with duration and escaped tool summaries", () => {
    const html = renderDreGraphRollbackBars(
      [point({ duration: 1000, kinds: ["read", "read", "edit<script>"] }), point({ duration: 250, kinds: ["bash"] })],
      "No rollback points.",
    )

    expect(html).toContain(`<div class="rb-bars-list">`)
    expect(html).toContain(`<span class="rb-idx">1</span>`)
    expect(html).toContain(`width:100%;background:var(--warn)`)
    expect(html).toContain(`<span class="rb-dur">1s</span>`)
    expect(html).toContain(`read ×2, edit&lt;script&gt;`)
    expect(html).toContain(`width:25%;background:var(--accent)`)
    expect(html).toContain(`<span class="rb-dur">0s</span>`)
  })

  test("renders escaped empty state", () => {
    expect(renderDreGraphRollbackBars([], "No <points>&")).toBe(`<p class="empty">No &lt;points&gt;&amp;</p>`)
  })
})
