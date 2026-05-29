import { readFileSync } from "node:fs"
import path from "node:path"
import { describe, expect, test } from "bun:test"
import { DESKTOP_BETA_REQUIRED_COMMANDS } from "../src/packaging/beta-evidence"

describe("desktop beta runbook", () => {
  test("documents every required strict beta command evidence name", () => {
    const runbook = readFileSync(path.resolve(import.meta.dirname, "../BETA.md"), "utf8")

    for (const name of DESKTOP_BETA_REQUIRED_COMMANDS) {
      expect(runbook).toContain(`"name": "${name}"`)
    }
  })

  test("keeps the manual required-check list aligned with strict command evidence", () => {
    const runbook = readFileSync(path.resolve(import.meta.dirname, "../BETA.md"), "utf8")

    const requiredShellCommands = [
      "pnpm --dir packages/app run typecheck",
      "pnpm --dir packages/app run test",
      "pnpm --dir packages/app run test:e2e",
      "pnpm --dir packages/app run build",
      "pnpm --dir packages/app run perf:smoke",
      "pnpm --dir packages/app run qa:beta",
      "pnpm --dir packages/desktop run typecheck",
      "pnpm --dir packages/desktop run test",
      "pnpm --dir packages/desktop run build",
      "pnpm --dir packages/desktop run smoke:packaged",
      "pnpm --dir packages/desktop run smoke:renderer",
      "pnpm --dir packages/desktop run package:mac",
      "pnpm run check:structure",
    ]

    for (const command of requiredShellCommands) {
      expect(runbook).toContain(command)
    }

    const packageCommand = runbook.indexOf("pnpm --dir packages/desktop run package:mac")
    expect(packageCommand).toBeGreaterThanOrEqual(0)
    expect(packageCommand).toBeLessThan(runbook.indexOf("pnpm --dir packages/desktop run smoke:packaged"))
    expect(packageCommand).toBeLessThan(runbook.indexOf("pnpm --dir packages/desktop run smoke:renderer"))
    expect(runbook.indexOf('"name": "desktop:package:mac"')).toBeLessThan(
      runbook.indexOf('"name": "desktop:smoke:packaged"'),
    )
    expect(runbook.indexOf('"name": "desktop:package:mac"')).toBeLessThan(
      runbook.indexOf('"name": "desktop:smoke:renderer"'),
    )
  })

  test("documents release workflow deterministic test report evidence", () => {
    const runbook = readFileSync(path.resolve(import.meta.dirname, "../BETA.md"), "utf8")

    expect(runbook).toContain("AX Code deterministic test gate before build/publish/desktop release jobs")
    expect(runbook).toContain("ax-code-deterministic-test-report")
    expect(runbook).toContain("machine-readable JUnit")
  })
})
