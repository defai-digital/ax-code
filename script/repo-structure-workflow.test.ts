import { describe, expect, test } from "vitest"
import { readFileSync } from "node:fs"

const workflow = readFileSync(".github/workflows/repo-structure.yml", "utf8")

describe("repo-structure workflow policy", () => {
  test("cancels superseded runs on the same ref", () => {
    expect(workflow).toMatch(/cancel-in-progress:\s*true/)
  })

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
    expect(workflow).toContain("script/check-tracked-internal.ts")
    expect(workflow).not.toContain("ax-internal")
  })

  test("compiles SDK exports before self-scan imports the runtime", () => {
    const install = workflow.indexOf("pnpm install --frozen-lockfile")
    const build = workflow.indexOf("pnpm --dir packages/sdk/js exec tsc")
    const scan = workflow.indexOf("pnpm run check:self-scan")
    expect(build).toBeGreaterThan(install)
    expect(scan).toBeGreaterThan(build)
  })
})
