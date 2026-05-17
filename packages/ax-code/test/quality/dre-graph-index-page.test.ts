import { describe, expect, test } from "bun:test"
import { index } from "../../src/quality/dre-graph-index-page"
import type { Session } from "../../src/session"

function session(input: { id: string; title: string; directory: string; parentID?: string }): Session.Info {
  return {
    id: input.id,
    slug: input.id,
    projectID: "project",
    directory: input.directory,
    title: input.title,
    version: "1",
    parentID: input.parentID,
    time: {
      created: 1_700_000_000_000,
      updated: 1_700_000_001_000,
    },
  } as unknown as Session.Info
}

describe("quality.dre-graph-index-page", () => {
  test("renders sessions with escaped titles and preserves index query parameters", () => {
    const html = index({
      search: "?directory=/tmp/a b&quality=true",
      list: [
        session({ id: "session-1", title: "Session <one>&", directory: "/tmp/a b" }),
        session({ id: "session-2", title: "Child", directory: "/tmp/a b", parentID: "session-1" }),
      ],
    })

    expect(html).toContain(`<title>AX Code · DRE Sessions</title>`)
    expect(html).toContain(`2 sessions in this workspace`)
    expect(html).toContain(`Session &lt;one&gt;&amp;`)
    expect(html).toContain(`/dre-graph/session/session-1?directory=%2Ftmp%2Fa+b&amp;quality=true`)
    expect(html).toContain(`<span class="chip neutral">root</span>`)
    expect(html).toContain(`<span class="chip neutral">fork</span>`)
    expect(html).toContain(`/dre-graph/fingerprint?directory=%2Ftmp%2Fa%20b`)
  })

  test("renders empty state and falls back to query directory for live refresh", () => {
    const html = index({ search: "?directory=/tmp/empty", list: [] })

    expect(html).toContain(`0 sessions in this workspace`)
    expect(html).toContain(`No sessions recorded. Run ax-code to create your first session.`)
    expect(html).toContain(`/dre-graph/fingerprint?directory=%2Ftmp%2Fempty`)
  })
})
