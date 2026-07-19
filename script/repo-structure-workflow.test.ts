import { describe, expect, test } from "vitest"
import { readFileSync } from "node:fs"

const workflow = readFileSync(".github/workflows/repo-structure.yml", "utf8")

describe("repo-structure workflow policy", () => {
  test("runs in merge queues and can be dispatched manually", () => {
    expect(workflow).toContain("merge_group:")
    expect(workflow).toContain("checks_requested")
    expect(workflow).toContain("workflow_dispatch:")
  })

  test("lints GitHub workflow files before expensive checks", () => {
    const actionlintIndex = workflow.indexOf("raven-actions/actionlint@")
    const installIndex = workflow.indexOf("pnpm install --frozen-lockfile")
    expect(actionlintIndex).toBeGreaterThan(-1)
    expect(workflow.slice(actionlintIndex, workflow.indexOf("\n", actionlintIndex))).toContain("# v2.2.0")
    expect(installIndex).toBeGreaterThan(actionlintIndex)
  })

  test("runs repository script tests before the structure audit", () => {
    const testsIndex = workflow.indexOf("pnpm run test:scripts")
    const structureIndex = workflow.indexOf("pnpm run check:structure")
    expect(testsIndex).toBeGreaterThan(-1)
    expect(structureIndex).toBeGreaterThan(testsIndex)
  })

  test("guards the canonical internal planning folder", () => {
    expect(workflow).toContain('".internal/**"')
    expect(workflow).toContain("git ls-files .internal")
    expect(workflow).not.toContain("ax-internal")
  })
})
