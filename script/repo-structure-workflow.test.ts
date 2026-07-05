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

  test("guards both legacy and current internal planning folders", () => {
    expect(workflow).toContain('"ax-internal/**"')
    expect(workflow).toContain("git ls-files .internal ax-internal")
  })
})
