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

  test("runs Knip against the core package after the structure audit", () => {
    const structureIndex = workflow.indexOf("pnpm run check:structure")
    const knipIndex = workflow.indexOf("pnpm --dir packages/ax-code run knip")
    expect(knipIndex).toBeGreaterThan(structureIndex)
  })

  test("checks local-only paths before installing dependencies and without path filters", () => {
    const guard = workflow.indexOf("sh script/check-tracked-local.sh")
    const install = workflow.indexOf("pnpm install --frozen-lockfile")
    expect(guard).toBeGreaterThan(-1)
    expect(guard).toBeLessThan(install)
    expect(workflow).not.toMatch(/^\s+paths(?:-ignore)?:/m)
  })

  test("public workflow scans log counts and keep detailed reports local", () => {
    for (const source of [workflow, readFileSync(".github/workflows/release.yml", "utf8")]) {
      expect(source).toContain("pnpm run check:self-scan -- --summary-only")
      expect(source).not.toContain("self-scan.md")
    }
  })

  test("compiles SDK exports before self-scan imports the runtime", () => {
    const install = workflow.indexOf("pnpm install --frozen-lockfile")
    const build = workflow.indexOf("pnpm --dir packages/sdk/js exec tsc")
    const scan = workflow.indexOf("pnpm run check:self-scan")
    expect(build).toBeGreaterThan(install)
    expect(scan).toBeGreaterThan(build)
  })
})
