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

  test("uses a repository-scoped App token after validation without granting the job write access", () => {
    const validation = workflow.indexOf("name: Validate generated snapshot")
    const token = workflow.indexOf("name: Create snapshot App token")
    const proposal = workflow.indexOf("name: Create or update snapshot pull request")
    expect(token).toBeGreaterThan(validation)
    expect(proposal).toBeGreaterThan(token)
    expect(workflow).toMatch(/create-github-app-token@[a-f0-9]{40}/)
    expect(workflow).toContain("client-id: ${{ vars.AX_CODE_MODELS_APP_CLIENT_ID }}")
    expect(workflow).toContain("private-key: ${{ secrets.AX_CODE_MODELS_APP_PRIVATE_KEY }}")
    expect(workflow).toContain("repositories: ax-code")
    expect(workflow).toContain("permission-contents: write")
    expect(workflow).toContain("permission-pull-requests: write")
    expect(workflow).toContain("token: ${{ steps.app-token.outputs.token }}")
    expect(workflow).toContain("contents: read")
    expect(workflow).not.toMatch(/^\s+(?:contents|pull-requests|actions): write$/m)
    expect(workflow).toContain("persist-credentials: false")
    expect(workflow).not.toContain("skip-token-revoke: true")
    expect(workflow).not.toContain("gh workflow run")
    expect(workflow).not.toContain("token: ${{ github.token }}")
    expect(workflow).toContain("models-snapshot.patch")
  })

  test("snapshot PRs match the normal core and repository CI path filters", () => {
    for (const file of ["ax-code-ci.yml", "repo-structure.yml"]) {
      const ci = readFileSync(`.github/workflows/${file}`, "utf8")
      const prPaths = ci.slice(ci.indexOf("  pull_request:"), ci.indexOf("  push:"))
      expect(prPaths).toMatch(/"packages\/(?:ax-code\/)?\*\*"/)
    }
  })
})
