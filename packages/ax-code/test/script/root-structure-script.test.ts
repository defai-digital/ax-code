import { describe, expect, test } from "vitest"
import path from "node:path"

const repoRoot = path.resolve(import.meta.dirname, "../../../..")
const structureScript = path.join(repoRoot, "script/structure.ts")

async function runStructureScript() {
  const proc = Bun.spawn({
    cmd: ["bun", "run", structureScript],
    cwd: repoRoot,
    stdout: "pipe",
    stderr: "pipe",
  })
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ])
  return { stdout, stderr, exitCode }
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
