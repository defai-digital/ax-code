import { readFileSync } from "node:fs"
import { describe, expect, test } from "vitest"

const workflow = readFileSync(".github/workflows/ax-code-ci.yml", "utf8")

function workflowJob(source: string, name: string) {
  return source.match(new RegExp(`^  ${name}:\\n[\\s\\S]*?(?=^  \\w[\\w-]*:|$(?![\\s\\S]))`, "m"))?.[0]
}

describe("SDK generation workflow policy", () => {
  test("the checks job runs the full SDK generator", () => {
    const checksJob = workflowJob(workflow, "checks")
    expect(checksJob).toBeDefined()
    expect(checksJob).toContain("pnpm --dir packages/sdk/js run build")
    expect(checksJob).not.toContain("working-directory: packages/sdk/js\n        run: pnpm exec tsc")
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

  test("cancels superseded runs on the same ref", () => {
    expect(workflow).toMatch(/cancel-in-progress:\s*true/)
  })

  test("the required deterministic job does not run V8 coverage", () => {
    const deterministicJob = workflowJob(workflow, "deterministic")
    expect(deterministicJob).toBeDefined()
    expect(deterministicJob).toContain("pnpm --dir packages/ax-code run test:ci -- deterministic")
    expect(deterministicJob).not.toContain("--coverage")
    expect(deterministicJob).not.toContain("Download coverage baseline")
    expect(deterministicJob).not.toContain("ax-code-coverage-baseline-summary")
  })
})
