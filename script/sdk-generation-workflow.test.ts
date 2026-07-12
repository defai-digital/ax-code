import { readFileSync } from "node:fs"
import { describe, expect, test } from "vitest"

const workflow = readFileSync(".github/workflows/ax-code-ci.yml", "utf8")

describe("SDK generation workflow policy", () => {
  test("the deterministic job runs the full SDK generator", () => {
    const deterministicJob = workflow.slice(
      workflow.indexOf("  deterministic:"),
      workflow.indexOf("  native-render-parity:"),
    )
    expect(deterministicJob).toContain("pnpm --dir packages/sdk/js run build")
    expect(deterministicJob).not.toContain("working-directory: packages/sdk/js\n        run: pnpm exec tsc")
  })

  test("fails when committed OpenAPI or generated clients drift", () => {
    expect(workflow).toContain("git status --porcelain=v1 --untracked-files=all")
    expect(workflow).toContain("packages/sdk/openapi.json")
    expect(workflow).toContain("packages/sdk/js/src/gen")
    expect(workflow).toContain("packages/sdk/js/src/v2/gen")
    expect(workflow).toContain("Generated SDK artifacts are stale")
  })

  test("runs the SDK package tests after generation", () => {
    const generationIndex = workflow.indexOf("Verify generated SDK artifacts are current")
    const testIndex = workflow.indexOf("pnpm --dir packages/sdk/js test")
    expect(generationIndex).toBeGreaterThan(-1)
    expect(testIndex).toBeGreaterThan(generationIndex)
  })
})
