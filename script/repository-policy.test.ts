import { describe, expect, test } from "vitest"
import {
  APPROVED_TRACKED_INTERNAL_FILES,
  INTERNAL_ONLY_ROOTS,
  isApprovedTrackedInternalPath,
  isInternalOnlyPath,
  unapprovedTrackedInternalPaths,
} from "./repository-policy"

describe("repository internal-only path policy", () => {
  test("recognizes the canonical internal root only", () => {
    expect(INTERNAL_ONLY_ROOTS).toEqual([".internal"])
    expect(isInternalOnlyPath(".internal")).toBe(true)
    expect(isInternalOnlyPath("./.internal/reports/qa/self-scan.md")).toBe(true)
    expect(isInternalOnlyPath(".internal/plan.md")).toBe(true)
    expect(isInternalOnlyPath("docs/internal.md")).toBe(false)
    expect(isInternalOnlyPath(".internalized/file.md")).toBe(false)
    expect(isInternalOnlyPath("ax-internal/plan.md")).toBe(false)
  })

  test("normalizes Windows separators", () => {
    expect(isInternalOnlyPath(".internal\\reports\\qa\\self-scan.md")).toBe(true)
  })

  test("allows only the explicitly approved architecture records", () => {
    expect(APPROVED_TRACKED_INTERNAL_FILES).toHaveLength(14)
    expect(isApprovedTrackedInternalPath("./.internal/adr/ADR-058-ax-code-tui.md")).toBe(true)
    expect(isApprovedTrackedInternalPath(".internal\\prd\\PRD-2026-08-20-ax-code-tui.md")).toBe(true)
    expect(isApprovedTrackedInternalPath("./.internal/adr/ADR-060-instance-scoped-tool-execution.md")).toBe(true)
    expect(isApprovedTrackedInternalPath(".internal\\spec\\SPEC-2026-08-21-tool-execution-integrity.md")).toBe(true)
    expect(
      isApprovedTrackedInternalPath(".internal/prd/PRD-2026-08-21-ax-code-intel-stabilization-acceleration.md"),
    ).toBe(true)
    expect(isApprovedTrackedInternalPath(".internal/prd/PRD-2026-08-22-ax-code-reason-stabilization.md")).toBe(true)
    expect(isApprovedTrackedInternalPath(".internal/reports/qa/self-scan.md")).toBe(false)
    expect(
      unapprovedTrackedInternalPaths([...APPROVED_TRACKED_INTERNAL_FILES, ".internal/reports/qa/self-scan.md"]),
    ).toEqual([".internal/reports/qa/self-scan.md"])
  })
})
