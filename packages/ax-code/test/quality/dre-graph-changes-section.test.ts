import { describe, expect, test } from "vitest"
import { changesSection } from "../../src/quality/dre-graph-changes-section"
import type { SessionDre } from "../../src/session/dre"

function dre(
  changes?: NonNullable<NonNullable<SessionDre.Snapshot["detail"]>["semantic"]>["changes"],
): SessionDre.Snapshot {
  return {
    detail: changes
      ? {
          semantic: { changes },
        }
      : null,
  } as SessionDre.Snapshot
}

describe("quality.dre-graph-changes-section", () => {
  test("renders an empty state without semantic changes", () => {
    expect(changesSection({ dre: dre() })).toContain("No semantic diff recorded")
    expect(changesSection({ dre: dre([]) })).toContain("No semantic diff recorded")
  })

  test("renders changed files with escaped content and risk chips", () => {
    const html = changesSection({
      dre: dre([
        {
          file: `src/<file>&.ts`,
          status: "modified",
          kind: "api_contract" as any,
          risk: "high" as any,
          summary: "summary",
          additions: 12,
          deletions: 3,
          signals: [`touches <api>`, `other&signal`],
        },
      ]),
    })

    expect(html).toContain(`<h2>Changes</h2><p>1 file changed</p>`)
    expect(html).toContain(`class="risk-dot high"`)
    expect(html).toContain(`title="src/&lt;file&gt;&amp;.ts"`)
    expect(html).toContain(`src/&lt;file&gt;&amp;.ts`)
    expect(html).toContain(`<span class="chip high">api contract</span>`)
    expect(html).toContain(`<span class="diff-add">+12</span> <span class="diff-del">-3</span>`)
    expect(html).toContain(`title="touches &lt;api&gt; · other&amp;signal"`)
    expect(html).toContain(`touches &lt;api&gt;`)
  })

  test("renders plural count and empty signal placeholder", () => {
    const html = changesSection({
      dre: dre([
        {
          file: "a.ts",
          status: "added",
          kind: "test" as any,
          risk: "low" as any,
          summary: "summary",
          additions: 1,
          deletions: 0,
          signals: [],
        },
        {
          file: "b.ts",
          status: "modified",
          kind: "refactor" as any,
          risk: "medium" as any,
          summary: "summary",
          additions: 2,
          deletions: 1,
          signals: [],
        },
      ]),
    })

    expect(html).toContain(`<h2>Changes</h2><p>2 files changed</p>`)
    expect(html.split(`<span class="change-signal"></span>`).length - 1).toBe(2)
  })
})
