import { readFileSync } from "node:fs"
import { describe, expect, test } from "vitest"

const workflow = readFileSync(".github/workflows/ax-code-ci.yml", "utf8")

describe("SDK generation workflow policy", () => {
  test("the deterministic job runs the full SDK generator", () => {
    const deterministicJob = workflow.slice(
      workflow.indexOf("\n  deterministic:"),
      workflow.indexOf("\n  live:"),
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

  test("coverage baseline download selects the first successful run without pipe-to-head under pipefail", () => {
    const stepMarker = "Download coverage baseline"
    const stepStart = workflow.indexOf(stepMarker)
    expect(stepStart).toBeGreaterThan(-1)
    // Step body ends at the next top-level step name line after the run block.
    const afterMarker = workflow.slice(stepStart + stepMarker.length)
    const nextStep = afterMarker.search(/\n {6}- name:/)
    const stepBody = nextStep === -1 ? afterMarker : afterMarker.slice(0, nextStep)

    expect(stepBody).toContain("set -euo pipefail")
    expect(stepBody).toContain("ax-code-coverage-baseline-summary")
    // Selecting the first id must happen inside jq so SIGPIPE cannot fail the step
    // when multiple successful runs exist (gh api | head -n1 under pipefail → exit 141).
    expect(stepBody).toContain("first // empty")
    expect(stepBody).not.toMatch(/\|\s*head\s+-n1/)
  })
})
