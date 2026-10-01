import { readFileSync } from "node:fs"
import { describe, expect, test } from "vitest"

const workflow = readFileSync(".github/workflows/models-drift.yml", "utf8")

describe("models drift workflow", () => {
  test("proposes single-fetch snapshot updates on a schedule and by manual dispatch", () => {
    expect(workflow).toMatch(/schedule:\s*\n\s*- cron:/)
    expect(workflow).toMatch(/workflow_dispatch:/)
    expect(workflow).toMatch(/run:\s+pnpm --dir packages\/ax-code exec tsx script\/update-models\.ts\s*$/m)
    expect(workflow).not.toContain("script/update-models.ts --check")
    expect(workflow).toContain("cancel-in-progress: false")
  })

  test("validates the candidate before publishing a snapshot-only reviewable PR", () => {
    const validation = workflow.indexOf("name: Validate generated snapshot")
    const proposal = workflow.indexOf("uses: peter-evans/create-pull-request@")
    expect(validation).toBeGreaterThan(-1)
    expect(proposal).toBeGreaterThan(validation)
    expect(workflow).toContain("run typecheck")
    expect(workflow).toContain("test/script/update-models.test.ts")
    expect(workflow).toContain("pnpm run check:no-cost")
    expect(workflow).toContain("add-paths: packages/ax-code/src/provider/models-snapshot.json")
    expect(workflow).toContain("branch: automation/models-snapshot")
    expect(workflow).toContain("base: main")
    expect(workflow).not.toContain("continue-on-error")
    expect(workflow).not.toContain("--auto")
    expect(workflow).toMatch(/create-pull-request@[a-f0-9]{40}/)
  })

  test("explicitly dispatches CI for bot-created or updated PRs", () => {
    expect(workflow).toContain("contents: write")
    expect(workflow).toContain("pull-requests: write")
    expect(workflow).toContain("actions: write")
    expect(workflow).toContain("gh workflow run ax-code-ci.yml --ref automation/models-snapshot")
    expect(workflow).toContain("gh workflow run repo-structure.yml --ref automation/models-snapshot")
    expect(workflow).toContain("pull-request-operation == 'created'")
    expect(workflow).toContain("pull-request-operation == 'updated'")
    expect(workflow).toContain("models-snapshot.patch")
  })
})
