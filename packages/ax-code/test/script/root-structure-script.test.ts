import { describe, expect, test } from "vitest"
import path from "node:path"
import { spawnSync } from "node:child_process"

const repoRoot = path.resolve(import.meta.dirname, "../../../..")
const structureScript = path.join(repoRoot, "script/structure.ts")

async function runStructureScript() {
  const result = spawnSync("tsx", [structureScript], {
    cwd: repoRoot,
    encoding: "utf-8",
  })
  return { stdout: result.stdout, stderr: result.stderr, exitCode: result.status ?? 1 }
}

describe("root structure script", () => {
  test("reports boundary hardening sections without failing on known warnings", async () => {
    const result = await runStructureScript()

    expect(result.exitCode).toBe(0)
    expect(result.stderr).toBe("")
    expect(result.stdout).toContain("## SDK Runtime Source Imports")
    expect(result.stdout).toContain("## Runtime Internal Boundaries")
    expect(result.stdout).toContain("## Workspace Dependency Cycles")
    expect(result.stdout).toContain("## Internal Files")
    expect(result.stdout).toContain("## Hotspot Thresholds")
    expect(result.stdout).toContain("## Boundaries")
    expect(result.stdout).toContain("- ok: no ax-internal files are tracked")
  })
})
