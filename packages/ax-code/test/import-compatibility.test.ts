import { describe, expect, test } from "vitest"
import fs from "fs/promises"
import path from "path"
import { CompatibilityImport } from "../src/import/compatibility"
import { tmpdir } from "./fixture/fixture"

describe("CompatibilityImport", () => {
  test("keeps dotted agent subdirectories when planning imports", async () => {
    await using tmp = await tmpdir()
    const agentDir = path.join(tmp.path, ".opencode", "agents", "..legacy")
    await fs.mkdir(agentDir, { recursive: true })
    await fs.writeFile(path.join(agentDir, "triage.md"), "# Triage\n", "utf-8")

    const report = await CompatibilityImport.plan({ source: "opencode", directory: tmp.path })
    expect(report.candidates).toContainEqual(
      expect.objectContaining({
        kind: "agent",
        sourcePath: path.join(agentDir, "triage.md"),
        targetPath: path.join(tmp.path, ".ax-code", "agent", "..legacy", "triage.md"),
      }),
    )
  })
})
