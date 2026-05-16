import { describe, expect, test } from "bun:test"
import { selectChecks } from "../../src/planner/verification/check-policy"

describe("selectChecks", () => {
  test("returns workspace scope when no files have changed", () => {
    const result = selectChecks({ changedFiles: [] })
    expect(result.scope).toBe("workspace")
    expect(result.reasoning).toContain("no changed files")
    expect(result.paths).toBeUndefined()
  })

  test("returns file scope with paths when one file has changed", () => {
    const result = selectChecks({ changedFiles: ["src/foo.ts"] })
    expect(result.scope).toBe("file")
    expect(result.paths).toEqual(["src/foo.ts"])
    expect(result.reasoning).toContain("single changed file")
  })

  test("returns file scope when multiple files changed and no package detector is supplied", () => {
    const result = selectChecks({ changedFiles: ["src/a.ts", "src/b.ts", "test/c.test.ts"] })
    expect(result.scope).toBe("file")
    expect(result.paths).toEqual(["src/a.ts", "src/b.ts", "test/c.test.ts"])
    expect(result.reasoning).toContain("3 changed files")
  })

  test("returns package scope when 2+ files share a single package", () => {
    const result = selectChecks({
      changedFiles: ["packages/x/src/a.ts", "packages/x/src/b.ts"],
      packageOf: (file) => (file.startsWith("packages/x/") ? "packages/x" : null),
    })
    expect(result.scope).toBe("package")
    expect(result.paths).toEqual(["packages/x/src/a.ts", "packages/x/src/b.ts"])
    expect(result.reasoning).toContain("single package")
  })

  test("escalates to workspace when changed files span multiple packages", () => {
    const result = selectChecks({
      changedFiles: ["packages/x/src/a.ts", "packages/y/src/b.ts"],
      packageOf: (file) => (file.startsWith("packages/x/") ? "packages/x" : "packages/y"),
    })
    expect(result.scope).toBe("workspace")
    expect(result.reasoning).toContain("span 2 packages")
    expect(result.paths).toBeUndefined()
  })

  test("falls back to file scope when packageOf returns null for any file", () => {
    const result = selectChecks({
      changedFiles: ["packages/x/src/a.ts", "scripts/bootstrap.ts"],
      packageOf: (file) => (file.startsWith("packages/x/") ? "packages/x" : null),
    })
    expect(result.scope).toBe("file")
  })

  test("forceScope=workspace overrides everything", () => {
    const result = selectChecks({
      changedFiles: ["src/foo.ts"],
      forceScope: "workspace",
    })
    expect(result.scope).toBe("workspace")
    expect(result.reasoning).toContain("forceScope=workspace")
    expect(result.paths).toBeUndefined()
  })

  test("forceScope=file preserves paths", () => {
    const result = selectChecks({
      changedFiles: ["src/foo.ts"],
      forceScope: "file",
    })
    expect(result.scope).toBe("file")
    expect(result.paths).toEqual(["src/foo.ts"])
  })

  test("priorEscalation climbs the ladder but never narrows", () => {
    const climbed = selectChecks({
      changedFiles: ["src/foo.ts"],
      priorEscalation: "package",
    })
    expect(climbed.scope).toBe("package")
    expect(climbed.reasoning).toContain("escalated from file per priorEscalation=package")

    const stay = selectChecks({
      changedFiles: ["src/foo.ts"],
      priorEscalation: "file",
    })
    expect(stay.scope).toBe("file")
    expect(stay.reasoning).not.toContain("escalated")
  })

  test("priorEscalation=workspace from a file baseline drops paths", () => {
    const result = selectChecks({
      changedFiles: ["src/foo.ts"],
      priorEscalation: "workspace",
    })
    expect(result.scope).toBe("workspace")
    expect(result.paths).toBeUndefined()
  })

  test("priorEscalation never DOWNGRADES a baseline that's already broader", () => {
    // Baseline would be `workspace` (no files). priorEscalation: file
    // should not narrow it.
    const result = selectChecks({ changedFiles: [], priorEscalation: "file" })
    expect(result.scope).toBe("workspace")
  })
})
