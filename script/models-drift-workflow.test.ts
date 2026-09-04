import { readFileSync } from "node:fs"
import { describe, expect, test } from "vitest"

const workflow = readFileSync(".github/workflows/models-drift.yml", "utf8")

describe("models drift workflow", () => {
  test("runs the read-only snapshot check on a schedule and by manual dispatch", () => {
    expect(workflow).toMatch(/schedule:\s*\n\s*- cron:/)
    expect(workflow).toMatch(/workflow_dispatch:/)
    expect(workflow).toContain("pnpm --dir packages/ax-code exec tsx script/update-models.ts --check")
    expect(workflow).not.toMatch(/run:\s+pnpm --dir packages\/ax-code exec tsx script\/update-models\.ts\s*$/m)
  })
})
