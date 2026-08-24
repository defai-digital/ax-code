import { spawnSync } from "node:child_process"
import { readFileSync } from "node:fs"
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

  test("approves no .internal paths for version control", () => {
    expect(APPROVED_TRACKED_INTERNAL_FILES).toEqual([])
    expect(isApprovedTrackedInternalPath(".internal/adr/ADR-058-ax-code-tui.md")).toBe(false)
    expect(isApprovedTrackedInternalPath(".internal\\prd\\PRD-2026-08-20-ax-code-tui.md")).toBe(false)
    expect(unapprovedTrackedInternalPaths([".internal/reports/qa/self-scan.md"])).toEqual([
      ".internal/reports/qa/self-scan.md",
    ])
  })
})

describe("shared editor config", () => {
  test("publishes only workspace VS Code settings, with no secret-like keys", () => {
    const result = spawnSync("git", ["ls-files", ".vscode"], { encoding: "utf8" })
    expect(result.status).toBe(0)
    expect(
      result.stdout
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean),
    ).toEqual([".vscode/settings.json"])
    const settings = readFileSync(".vscode/settings.json", "utf8")
    expect(settings).toContain("typescript.tsdk")
    expect(settings).toContain("rust-analyzer.linkedProjects")
    expect(settings).not.toMatch(/token|password|secret|api[_-]?key/i)
  })
})
