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

  test("imports commands from the singular command directory", async () => {
    await using tmp = await tmpdir()
    const commandDir = path.join(tmp.path, ".opencode", "command")
    await fs.mkdir(commandDir, { recursive: true })
    await fs.writeFile(path.join(commandDir, "deploy.md"), "---\ndescription: deploy\n---\nRun it.\n", "utf-8")

    const report = await CompatibilityImport.plan({ source: "opencode", directory: tmp.path })
    expect(report.candidates).toContainEqual(
      expect.objectContaining({
        kind: "command",
        sourcePath: path.join(commandDir, "deploy.md"),
        targetPath: path.join(tmp.path, ".ax-code", "commands", "deploy.md"),
      }),
    )
  })

  test("imports skills from the singular skill directory", async () => {
    await using tmp = await tmpdir()
    const skillDir = path.join(tmp.path, ".opencode", "skill", "release")
    await fs.mkdir(skillDir, { recursive: true })
    await fs.writeFile(path.join(skillDir, "SKILL.md"), "# Release\n", "utf-8")

    const report = await CompatibilityImport.plan({ source: "opencode", directory: tmp.path })
    expect(report.candidates).toContainEqual(
      expect.objectContaining({
        kind: "skill",
        sourcePath: path.join(skillDir, "SKILL.md"),
        targetPath: path.join(tmp.path, ".ax-code", "skill", "release", "SKILL.md"),
      }),
    )
  })
})
