import { describe, expect, test } from "vitest"
import {
  computeRiskLevel,
  computeResidualRisk,
  formatResidualRisk,
  type ResidualRiskLevel,
} from "../../src/visual/risk-summary"
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

describe("visual.risk-summary", () => {
  test("computeRiskLevel returns none for empty findings", () => {
    expect(computeRiskLevel([])).toBe("none")
  })

  test("computeRiskLevel returns low for info-only findings", () => {
    expect(computeRiskLevel([makeFinding({ severity: "info" })])).toBe("low")
  })

  test("computeRiskLevel returns low for few warnings", () => {
    expect(computeRiskLevel([makeFinding({ severity: "warning" }), makeFinding({ severity: "warning" })])).toBe("low")
  })

  test("computeRiskLevel returns medium for single error", () => {
    expect(computeRiskLevel([makeFinding({ severity: "error" })])).toBe("medium")
  })

  test("computeRiskLevel returns medium for 5+ warnings", () => {
    const findings = Array.from({ length: 5 }, (_, i) => makeFinding({ id: `f${i}`, severity: "warning" }))
    expect(computeRiskLevel(findings)).toBe("medium")
  })

  test("computeRiskLevel returns high for 3+ errors", () => {
    const findings = Array.from({ length: 3 }, (_, i) => makeFinding({ id: `f${i}`, severity: "error" }))
    expect(computeRiskLevel(findings)).toBe("high")
  })

  test("computeRiskLevel returns critical for any critical finding", () => {
    expect(computeRiskLevel([makeFinding({ severity: "critical" })])).toBe("critical")
    expect(
      computeRiskLevel([makeFinding({ id: "f1", severity: "info" }), makeFinding({ id: "f2", severity: "critical" })]),
    ).toBe("critical")
  })

  test("computeResidualRisk builds full report", () => {
    const findings: VisualFinding[] = [
      makeFinding({ severity: "error", status: "open" }),
      makeFinding({ id: "f2", severity: "warning", status: "open" }),
      makeFinding({ id: "f3", severity: "warning", status: "fixed" }),
      makeFinding({ id: "f4", severity: "info", status: "accepted" }),
    ]

    const report = computeResidualRisk(findings)
    expect(report.level).toBe("medium")
    expect(report.openCount).toBe(2)
    expect(report.errorCount).toBe(1)
    expect(report.warningCount).toBe(1)
    expect(report.summary.total).toBe(4)
    expect(report.summary.fixed).toBe(1)
    expect(report.summary.accepted).toBe(1)
  })

  test("computeResidualRisk with all resolved returns none", () => {
    const findings: VisualFinding[] = [makeFinding({ status: "fixed" }), makeFinding({ id: "f2", status: "accepted" })]
    const report = computeResidualRisk(findings)
    expect(report.level).toBe("none")
    expect(report.openCount).toBe(0)
    expect(report.recommendation).toContain("passed")
  })

  test("formatResidualRisk produces readable markdown", () => {
    const findings: VisualFinding[] = [
      makeFinding({ title: "Overflow bug", severity: "error", status: "open", suggestedFix: "Fix CSS overflow" }),
      makeFinding({ id: "f2", title: "Info notice", severity: "info", status: "open" }),
      makeFinding({ id: "f3", severity: "warning", status: "fixed" }),
    ]

    const report = computeResidualRisk(findings)
    const text = formatResidualRisk(report)
    expect(text).toContain("MEDIUM")
    expect(text).toContain("Open findings: 2")
    expect(text).toContain("Error: 1")
    expect(text).toContain("Overflow bug")
    expect(text).toContain("Fix CSS overflow")
    expect(text).toContain("Fixed: 1")
  })

  test("formatResidualRisk shows critical level", () => {
    const findings = [makeFinding({ severity: "critical", title: "Security issue", status: "open" })]
    const report = computeResidualRisk(findings)
    const text = formatResidualRisk(report)
    expect(text).toContain("CRITICAL")
    expect(text).toContain("Must be resolved")
  })

  test("formatResidualRisk for high risk mentions shipping block", () => {
    const findings = Array.from({ length: 3 }, (_, i) =>
      makeFinding({ id: `f${i}`, severity: "error", title: `Error ${i}`, status: "open" }),
    )
    const report = computeResidualRisk(findings)
    const text = formatResidualRisk(report)
    expect(text).toContain("HIGH")
    expect(text).toContain("Block shipping")
  })
})
