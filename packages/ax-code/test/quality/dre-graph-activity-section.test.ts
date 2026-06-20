import { describe, expect, test } from "vitest"
import { activitySection } from "../../src/quality/dre-graph-activity-section"
import type { SessionDre } from "../../src/session/dre"
import type { SessionGraph } from "../../src/session/graph"
import type { SessionRollback } from "../../src/session/rollback"

function graph(agents: string[]): SessionGraph.Snapshot {
  return {
    graph: {
      sessionID: "session",
      nodes: [],
      edges: [],
      metadata: {
        duration: 0,
        tokens: { input: 0, output: 0 },
        risk: { level: "LOW", score: 0, summary: "ok" },
        agents,
        tools: [],
        steps: 0,
        errors: 0,
      },
    },
    topology: [],
  } as SessionGraph.Snapshot
}

function dre(timeline: SessionDre.TimelineLine[], detail?: Partial<SessionDre.Detail>): SessionDre.Snapshot {
  return {
    timeline,
    detail: detail ? (detail as SessionDre.Detail) : null,
  }
}

describe("quality.dre-graph-activity-section", () => {
  test("renders ranked activity cards, agents, tool usage, notes, and rollback points", () => {
    const html = activitySection(
      graph(["main-agent", "helper-agent"]),
      dre(
        [
          { kind: "step", text: "Step 0 · 1s" },
          { kind: "route", text: "main-agent -> helper-agent" },
          { kind: "tool", text: "read: src/a.ts → ok (500ms)" },
          { kind: "tool", text: "edit: src/a.ts → ok (300ms)" },
          { kind: "step", text: "Step 1 · 3s" },
          { kind: "tool", text: "bash: bun test → ERR (1200ms)" },
          { kind: "error", text: "Failed <test>&" },
        ],
        {
          routes: [{ from: "main-agent", to: "helper-agent", confidence: 0.91 }],
          tools: ["read", "edit", "bash", "read"],
          notes: ["Note <one>&"],
        },
      ),
      [
        {
          step: 1,
          messageID: "msg",
          partID: "part",
          duration: 500,
          tools: [],
          kinds: ["read", "read"],
        } as unknown as SessionRollback.Point,
      ],
    )

    expect(html).toContain(`<section class="band" id="activity">`)
    expect(html).toContain(`<span class="act-label">Step 1</span>`)
    expect(html).toContain(`class="act-card act-card-err"`)
    expect(html).toContain(`Failed &lt;test&gt;&amp;`)
    expect(html).toContain(`read a.ts`)
    expect(html).toContain(`edited a.ts`)
    expect(html).toContain(`Helper-agent`)
    expect(html).toContain(`routed · 91% conf`)
    expect(html).toContain(`Note &lt;one&gt;&amp;`)
    expect(html).toContain(`read ×2`)
    expect(html).toContain(`<span class="rb-count">1</span>`)
  })

  test("renders empty states without timeline detail", () => {
    const html = activitySection(graph([]), dre([]), [])

    expect(html).toContain(`<p class="empty">No steps recorded yet.</p>`)
    expect(html).toContain(`<p class="empty">No agent data.</p>`)
    expect(html).toContain(`<p class="empty">No tool data.</p>`)
    expect(html).toContain(`<p class="empty">No rollback points recorded.</p>`)
  })
})
