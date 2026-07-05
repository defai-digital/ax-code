import { describe, expect, test } from "vitest"
import { compareVisualRuns, formatCompareSummary, type CompareResult } from "../../src/visual/compare"
import type { VisualRun, VisualFinding } from "../../src/visual/run"

function makeRun(overrides: Partial<VisualRun> = {}): VisualRun {
  return {
    id: "run-1",
    sessionID: "ses_test",
    projectID: "proj_test",
    target: { type: "url", url: "http://localhost:3000", profile: "isolated" },
    mode: "browser",
    status: "passed",
    createdAt: "2026-07-05T00:00:00Z",
    updatedAt: "2026-07-05T00:00:00Z",
    artifacts: [],
    findings: [],
    ...overrides,
  }
}

function makeFinding(overrides: Partial<VisualFinding> = {}): VisualFinding {
  return {
    id: "finding_1",
    severity: "warning",
    category: "layout",
    title: "Text overflow in header",
    evidenceArtifactIDs: [],
    status: "open",
    ...overrides,
  }
}

describe("visual.compare", () => {
  test("compareVisualRuns detects resolved findings", () => {
    const before = makeRun({
      id: "run-before",
      findings: [
        makeFinding({ title: "Overflow in header", status: "open" }),
        makeFinding({ title: "Missing alt text", category: "accessibility", status: "open" }),
      ],
    })
    const after = makeRun({
      id: "run-after",
      findings: [
        makeFinding({ title: "Overflow in header", status: "fixed" }),
        makeFinding({ title: "Missing alt text", category: "accessibility", status: "fixed" }),
      ],
    })

    const result = compareVisualRuns(before, after)
    expect(result.resolvedCount).toBe(2)
    expect(result.unresolvedCount).toBe(0)
    expect(result.introducedCount).toBe(0)
  })

  test("compareVisualRuns detects persistent findings", () => {
    const before = makeRun({
      id: "run-before",
      findings: [makeFinding({ title: "Overflow", status: "open" })],
    })
    const after = makeRun({
      id: "run-after",
      findings: [makeFinding({ title: "Overflow", status: "open" })],
    })

    const result = compareVisualRuns(before, after)
    expect(result.unresolvedCount).toBe(1)
    expect(result.delta.persistent[0]?.title).toBe("Overflow")
  })

  test("compareVisualRuns detects introduced findings", () => {
    const before = makeRun({ id: "run-before", findings: [] })
    const after = makeRun({
      id: "run-after",
      findings: [makeFinding({ title: "New regression", status: "open" })],
    })

    const result = compareVisualRuns(before, after)
    expect(result.introducedCount).toBe(1)
    expect(result.delta.introduced[0]?.title).toBe("New regression")
  })

  test("compareVisualRuns handles missing findings in after as resolved", () => {
    const before = makeRun({
      id: "run-before",
      findings: [makeFinding({ title: "Old issue", status: "open" })],
    })
    const after = makeRun({ id: "run-after", findings: [] })

    const result = compareVisualRuns(before, after)
    expect(result.resolvedCount).toBe(1)
    expect(result.delta.resolved[0]?.title).toBe("Old issue")
  })

  test("compareVisualRuns matches artifacts by viewport label", () => {
    const before = makeRun({
      id: "run-before",
      artifacts: [
        { id: "a1", kind: "screenshot", label: "viewport-desktop", path: "/tmp/a1.png" },
        { id: "a2", kind: "screenshot", label: "viewport-mobile", path: "/tmp/a2.png" },
      ],
    })
    const after = makeRun({
      id: "run-after",
      artifacts: [
        { id: "b1", kind: "screenshot", label: "viewport-desktop", path: "/tmp/b1.png" },
        { id: "b2", kind: "screenshot", label: "viewport-mobile", path: "/tmp/b2.png" },
      ],
    })

    const result = compareVisualRuns(before, after)
    expect(result.matches.length).toBe(2)
  })

  test("compareVisualRuns skips non-matching viewport labels", () => {
    const before = makeRun({
      id: "run-before",
      artifacts: [{ id: "a1", kind: "screenshot", label: "viewport-desktop", path: "/tmp/a1.png" }],
    })
    const after = makeRun({
      id: "run-after",
      artifacts: [{ id: "b1", kind: "screenshot", label: "viewport-tablet", path: "/tmp/b1.png" }],
    })

    const result = compareVisualRuns(before, after)
    expect(result.matches.length).toBe(0)
  })

  test("compareVisualRuns returns empty matches for non-URL targets", () => {
    const before = makeRun({
      id: "run-before",
      target: { type: "snapshot", source: "desktop" },
    })
    const after = makeRun({
      id: "run-after",
      target: { type: "snapshot", source: "desktop" },
    })

    const result = compareVisualRuns(before, after)
    expect(result.matches.length).toBe(0)
  })

  test("formatCompareSummary produces readable output", () => {
    const before = makeRun({
      id: "run-before",
      findings: [
        makeFinding({ title: "Overflow", status: "open" }),
        makeFinding({ title: "Bad contrast", category: "accessibility", status: "open" }),
      ],
    })
    const after = makeRun({
      id: "run-after",
      findings: [
        makeFinding({ title: "Overflow", status: "fixed" }),
        makeFinding({ title: "Bad contrast", category: "accessibility", status: "open" }),
      ],
    })

    const result = compareVisualRuns(before, after)
    const text = formatCompareSummary(result)
    expect(text).toContain("Resolved: 1")
    expect(text).toContain("Unresolved: 1")
    expect(text).toContain("Overflow")
    expect(text).toContain("Bad contrast")
  })

  test("compareVisualRuns tracks status transitions", () => {
    const before = makeRun({
      id: "run-before",
      findings: [makeFinding({ id: "f1", title: "Issue A", status: "open" })],
    })
    const after = makeRun({
      id: "run-after",
      findings: [makeFinding({ id: "f2", title: "Issue A", status: "fixed" })],
    })

    const result = compareVisualRuns(before, after)
    expect(result.delta.statusTransitions.length).toBe(1)
    expect(result.delta.statusTransitions[0]).toEqual({
      findingID: "f1",
      from: "open",
      to: "fixed",
    })
  })
})
