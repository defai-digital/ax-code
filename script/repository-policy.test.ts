import { spawnSync } from "node:child_process"
import { readFileSync } from "node:fs"
import { describe, expect, test } from "vitest"
import {
  APPROVED_TRACKED_INTERNAL_FILES,
  INTERNAL_ONLY_ROOTS,
  isApprovedTrackedInternalPath,
  isInternalOnlyPath,
  LOCAL_ONLY_PATHSPECS,
  LOCAL_ONLY_ROOT_FILES,
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

  test("keeps root agent-instruction files local-only", () => {
    expect(LOCAL_ONLY_ROOT_FILES).toEqual(["AGENTS.md", "CLAUDE.md", "GEMINI.md"])
    // Exact root names keep nested fixtures trackable, so no path separators.
    expect(LOCAL_ONLY_ROOT_FILES.every((file) => !file.includes("/"))).toBe(true)
    expect(LOCAL_ONLY_PATHSPECS).toBe(".internal AGENTS.md CLAUDE.md GEMINI.md")
  })

  test("pre-commit hook blocks staged local-only paths", () => {
    // `.gitignore` cannot stop `git add -f`, so the hook is the local
    // prevention layer. Deriving the expectation from the shared constant
    // locks it to script/check-tracked-internal.ts instead of a copied literal.
    const hook = readFileSync(".husky/pre-commit", "utf8")
    expect(hook).toContain(`git ls-files -- ${LOCAL_ONLY_PATHSPECS}`)
    expect(hook).toContain("git rm --cached")
  })

  test("every local-only guard consumes the shared list", () => {
    // The hook is shell and is locked by the pathspec assertion above. These
    // two are TypeScript and must import the constant, so a newly declared
    // local-only file cannot be handled in one guard and forgotten in another.
    for (const file of ["script/check-tracked-internal.ts", "script/check-goal-bughunt.ts"]) {
      const source = readFileSync(file, "utf8")
      expect(source).toContain("LOCAL_ONLY_ROOT_FILES")
      expect(source).not.toMatch(/"AGENTS\.md"/)
    }
    // This one lives in another package and cannot import script/ policy, so it
    // must at least enumerate the whole class.
    const crossPackage = readFileSync("packages/ax-code/script/verify-cli-review-commit-scope.ts", "utf8")
    for (const file of LOCAL_ONLY_ROOT_FILES) expect(crossPackage).toContain(`"${file}"`)
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

  test("keeps optional native dependencies out of routine Rust analysis", () => {
    const config = readFileSync("crates/rust-analyzer.toml", "utf8")
    expect(config).toContain("[cargo]")
    expect(config).toMatch(/^noDefaultFeatures\s*=\s*true\s*$/m)
  })
})
