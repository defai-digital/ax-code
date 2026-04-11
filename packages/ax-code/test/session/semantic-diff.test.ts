import { describe, expect, test } from "bun:test"
import path from "path"
import { SessionSemanticDiff } from "../../src/session/semantic-diff"

describe("session semantic diff", () => {
  test("classifies guard-heavy changes as bug fixes", () => {
    const file = path.join("/tmp/demo", "src/auth/check.ts")
    const item = SessionSemanticDiff.change({
      file,
      before: "export function check(v?: string) {\n  return v.trim()\n}\n",
      after:
        "export function check(v?: string) {\n  if (!v) throw new Error('missing')\n  return v?.trim() ?? ''\n}\n",
      additions: 3,
      deletions: 1,
      status: "modified",
    })

    expect(item.kind).toBe("bug_fix")
    expect(item.risk).toBe("medium")
    expect(item.signals).toContain("guard or validation logic added")
  })

  test("classifies docs, tests, and rewrites distinctly", () => {
    const doc = SessionSemanticDiff.change({
      file: "/tmp/demo/README.md",
      before: "# Demo\n",
      after: "# Demo\n\nMore detail.\n",
      additions: 2,
      deletions: 0,
      status: "modified",
    })
    const spec = SessionSemanticDiff.change({
      file: "/tmp/demo/test/demo.test.ts",
      before: "",
      after: "test('demo', () => expect(true).toBe(true))\n",
      additions: 1,
      deletions: 0,
      status: "added",
    })
    const rewrite = SessionSemanticDiff.change({
      file: "/tmp/demo/src/server/routes/demo.ts",
      before: Array.from({ length: 90 }, (_, i) => `export const v${i} = ${i}\n`).join(""),
      after: Array.from({ length: 260 }, (_, i) => `export const n${i} = ${i}\n`).join(""),
      additions: 260,
      deletions: 90,
      status: "modified",
    })

    expect(doc.kind).toBe("documentation")
    expect(spec.kind).toBe("test")
    expect(rewrite.kind).toBe("rewrite")
    expect(rewrite.risk).toBe("high")
  })

  test("summarizes dominant semantic intent across files", () => {
    const sum = SessionSemanticDiff.summarize([
      {
        file: "/tmp/demo/src/a.ts",
        before: "export const a = 1\n",
        after: "export function a() {\n  return 1\n}\n",
        additions: 3,
        deletions: 1,
        status: "modified",
      },
      {
        file: "/tmp/demo/src/b.ts",
        before: "export const b = 1\n",
        after: "export function b() {\n  return 1\n}\n",
        additions: 3,
        deletions: 1,
        status: "modified",
      },
      {
        file: "/tmp/demo/test/a.test.ts",
        before: "",
        after: "test('a', () => {})\n",
        additions: 1,
        deletions: 0,
        status: "added",
      },
    ])

    expect(sum?.primary).toBe("refactor")
    expect(sum?.headline).toBe("refactor across 3 files")
    expect(sum?.counts[0]).toEqual({ kind: "refactor", count: 2 })
    expect(sum?.signals).toContain("4 lines touched")
  })
})
