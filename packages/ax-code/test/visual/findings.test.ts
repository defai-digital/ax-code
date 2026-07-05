import { describe, expect, test } from "vitest"
import {
  createFinding,
  updateFindingStatus,
  mergeFindings,
  summarizeFindings,
  openFindings,
  allFindingsResolved,
} from "../../src/visual/findings"
import type { VisualFinding } from "../../src/visual/run"

function makeFinding(overrides: Partial<VisualFinding> = {}): VisualFinding {
  return {
    id: "finding_1",
    severity: "warning",
    category: "layout",
    title: "Test finding",
    evidenceArtifactIDs: [],
    status: "open",
    ...overrides,
  }
}

describe("visual.findings", () => {
  test("createFinding generates unique ID", () => {
    const f1 = createFinding({ severity: "error", category: "layout", title: "Overflow" })
    const f2 = createFinding({ severity: "error", category: "layout", title: "Overflow" })
    expect(f1.id).not.toBe(f2.id)
    expect(f1.id).toMatch(/^finding_[a-f0-9]{16}$/)
    expect(f1.status).toBe("open")
    expect(f1.severity).toBe("error")
  })

  test("createFinding includes suggested fix", () => {
    const f = createFinding({
      severity: "warning",
      category: "accessibility",
      title: "Missing alt",
      suggestedFix: "Add alt attribute to img tag",
    })
    expect(f.suggestedFix).toBe("Add alt attribute to img tag")
  })

  test("updateFindingStatus changes status by ID", () => {
    const findings = [makeFinding({ id: "f1", status: "open" }), makeFinding({ id: "f2", status: "open" })]
    const updated = updateFindingStatus(findings, "f1", "fixed")
    expect(updated[0]?.status).toBe("fixed")
    expect(updated[1]?.status).toBe("open")
  })

  test("updateFindingStatus is immutable", () => {
    const findings = [makeFinding({ id: "f1", status: "open" })]
    const updated = updateFindingStatus(findings, "f1", "fixed")
    expect(findings[0]?.status).toBe("open")
    expect(updated[0]?.status).toBe("fixed")
  })

  test("mergeFindings marks disappeared findings as fixed", () => {
    const existing = [
      makeFinding({ title: "A", category: "layout", status: "open" }),
      makeFinding({ title: "B", category: "layout", status: "open" }),
    ]
    const incoming = [makeFinding({ title: "B", category: "layout", status: "open" })]

    const merged = mergeFindings(existing, incoming)
    expect(merged.length).toBe(2)
    expect(merged.find((f) => f.title === "A")?.status).toBe("fixed")
    expect(merged.find((f) => f.title === "B")?.status).toBe("open")
  })

  test("mergeFindings adds new findings", () => {
    const existing = [makeFinding({ title: "A", category: "layout", status: "open" })]
    const incoming = [
      makeFinding({ title: "A", category: "layout", status: "open" }),
      makeFinding({ title: "C", category: "accessibility", status: "open" }),
    ]

    const merged = mergeFindings(existing, incoming)
    expect(merged.length).toBe(2)
    expect(merged.find((f) => f.title === "C")).toBeDefined()
  })

  test("mergeFindings preserves already-fixed findings", () => {
    const existing = [
      makeFinding({ title: "A", category: "layout", status: "fixed" }),
      makeFinding({ title: "B", category: "layout", status: "open" }),
    ]
    const incoming = [makeFinding({ title: "B", category: "layout", status: "open" })]

    const merged = mergeFindings(existing, incoming)
    expect(merged.find((f) => f.title === "A")?.status).toBe("fixed")
  })

  test("mergeFindings reopens fixed findings that reappear", () => {
    const existing = [
      makeFinding({
        id: "existing-finding",
        title: "A",
        category: "layout",
        status: "fixed",
        evidenceArtifactIDs: ["before"],
      }),
    ]
    const incoming = [
      makeFinding({
        id: "incoming-finding",
        title: "A",
        category: "layout",
        status: "open",
        severity: "error",
        evidenceArtifactIDs: ["after"],
      }),
    ]

    const merged = mergeFindings(existing, incoming)
    expect(merged).toHaveLength(1)
    expect(merged[0]).toMatchObject({
      id: "existing-finding",
      title: "A",
      status: "open",
      severity: "error",
      evidenceArtifactIDs: ["after"],
    })
  })

  test("summarizeFindings counts by status and severity", () => {
    const findings: VisualFinding[] = [
      makeFinding({ severity: "critical", status: "open" }),
      makeFinding({ severity: "error", status: "open" }),
      makeFinding({ severity: "warning", status: "fixed" }),
      makeFinding({ severity: "info", status: "accepted" }),
      makeFinding({ severity: "warning", status: "false-positive" }),
    ]

    const summary = summarizeFindings(findings)
    expect(summary.total).toBe(5)
    expect(summary.open).toBe(2)
    expect(summary.fixed).toBe(1)
    expect(summary.accepted).toBe(1)
    expect(summary.falsePositive).toBe(1)
    expect(summary.bySeverity.critical).toBe(1)
    expect(summary.bySeverity.error).toBe(1)
    expect(summary.bySeverity.warning).toBe(2)
    expect(summary.bySeverity.info).toBe(1)
  })

  test("openFindings returns only open findings sorted by severity", () => {
    const findings: VisualFinding[] = [
      makeFinding({ title: "Info issue", severity: "info", status: "open" }),
      makeFinding({ title: "Critical issue", severity: "critical", status: "open" }),
      makeFinding({ title: "Fixed issue", severity: "critical", status: "fixed" }),
      makeFinding({ title: "Error issue", severity: "error", status: "open" }),
    ]

    const open = openFindings(findings)
    expect(open.length).toBe(3)
    expect(open[0]?.severity).toBe("critical")
    expect(open[1]?.severity).toBe("error")
    expect(open[2]?.severity).toBe("info")
  })

  test("allFindingsResolved returns true when no open findings", () => {
    expect(allFindingsResolved([])).toBe(true)
    expect(allFindingsResolved([makeFinding({ status: "fixed" }), makeFinding({ status: "accepted" })])).toBe(true)
  })

  test("allFindingsResolved returns false when open findings exist", () => {
    expect(allFindingsResolved([makeFinding({ status: "open" })])).toBe(false)
  })
})
