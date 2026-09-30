import fs from "node:fs/promises"
import path from "node:path"
import { describe, expect, test } from "vitest"
import {
  readWikiBuildReport,
  summarizeWikiBuildReport,
  wikiBuildReportPath,
  writeWikiBuildReport,
  WIKI_BUILD_REPORT_SCHEMA_VERSION,
  type WikiBuildReport,
} from "../../src/wiki/build-report"
import { tmpdir } from "../fixture/fixture"

function report(overrides: Partial<WikiBuildReport> = {}): WikiBuildReport {
  return {
    schemaVersion: WIKI_BUILD_REPORT_SCHEMA_VERSION,
    action: "update",
    outcome: "completed",
    model: "test/model",
    generator: { version: "1.0.0", promptVersion: "p1" },
    repositoryHead: "abc123",
    startedAt: "2026-01-01T00:00:00.000Z",
    finishedAt: "2026-01-01T00:01:00.000Z",
    durationMs: 60_000,
    written: ["quickstart.md"],
    notAttemptedCount: 0,
    ...overrides,
  }
}

describe("wiki build report", () => {
  test("round-trips an atomic write", async () => {
    await using tmp = await tmpdir()
    await writeWikiBuildReport(tmp.path, "ax-wiki", report())

    const loaded = await readWikiBuildReport(tmp.path, "ax-wiki")
    expect(loaded?.schemaVersion).toBe(WIKI_BUILD_REPORT_SCHEMA_VERSION)
    expect(loaded?.outcome).toBe("completed")
    expect(loaded?.written).toEqual(["quickstart.md"])
  })

  test("keeps an unsafe wiki directory inside the repository", () => {
    const root = path.resolve("/tmp/ax-wiki-report-root")
    const target = wikiBuildReportPath(root, "../outside")
    const relative = path.relative(root, target)
    expect(relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)).toBe(false)
    expect(target).toBe(path.join(root, "ax-wiki", ".build-report.json"))
  })

  test("treats a missing report as absent", async () => {
    await using tmp = await tmpdir()
    expect(await readWikiBuildReport(tmp.path, "ax-wiki")).toBeUndefined()
  })

  test("treats a corrupt report as absent", async () => {
    await using tmp = await tmpdir()
    await fs.mkdir(path.join(tmp.path, "ax-wiki"), { recursive: true })
    await fs.writeFile(wikiBuildReportPath(tmp.path, "ax-wiki"), "{ not json", "utf8")
    expect(await readWikiBuildReport(tmp.path, "ax-wiki")).toBeUndefined()
  })

  test("ignores a report written by another schema version", async () => {
    await using tmp = await tmpdir()
    await writeWikiBuildReport(tmp.path, "ax-wiki", report({ schemaVersion: 999 }))
    expect(await readWikiBuildReport(tmp.path, "ax-wiki")).toBeUndefined()
  })

  test("summarizes a failure with the page, class, and pending pages", () => {
    const text = summarizeWikiBuildReport(
      report({
        outcome: "failed",
        written: [],
        notAttemptedCount: 11,
        failed: { path: "quickstart.md", status: "failed", attempts: 2, durationMs: 12, failureClass: "length" },
      }),
    )
    expect(text).toContain("failed")
    expect(text).toContain("quickstart.md")
    expect(text).toContain("length")
    expect(text).toContain("11 page(s) not attempted")
  })

  test("summarizes a completed build with the written count", () => {
    expect(summarizeWikiBuildReport(report())).toContain("1 page(s) written")
  })

  test("accepts and summarizes a partial build", async () => {
    await using tmp = await tmpdir()
    const partial = report({
      outcome: "partial",
      failed: { path: "modules/ax-code.md", status: "failed", attempts: 2, durationMs: 5, failureClass: "length" },
    })
    await writeWikiBuildReport(tmp.path, "ax-wiki", partial)
    expect((await readWikiBuildReport(tmp.path, "ax-wiki"))?.outcome).toBe("partial")

    const text = summarizeWikiBuildReport(partial)
    expect(text).toContain("partial")
    expect(text).toContain("modules/ax-code.md")
    expect(text).toContain("1 page(s) written")
  })
})
