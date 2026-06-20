import { test, expect } from "vitest"
import fs from "fs/promises"
import path from "path"
import { CompatibilityImport } from "../../src/import/compatibility"
import { formatCompatibilityImportReport } from "../../src/cli/cmd/import"
import { Filesystem } from "../../src/util/filesystem"
import { tmpdir } from "../fixture/fixture"

test("compatibility import dry-run reports candidates without writing", async () => {
  await using tmp = await tmpdir({
    init: async (dir) => {
      const commandDir = path.join(dir, ".opencode", "commands")
      const skillDir = path.join(dir, ".opencode", "skills", "release-notes")
      await fs.mkdir(commandDir, { recursive: true })
      await fs.mkdir(skillDir, { recursive: true })
      await Filesystem.write(
        path.join(commandDir, "snapshot.md"),
        `---
description: Snapshot
---
Snapshot
!` +
          "`echo should-not-run`" +
          `
`,
      )
      await Filesystem.write(
        path.join(skillDir, "SKILL.md"),
        `---
name: release-notes
description: Draft release notes.
---
`,
      )
    },
  })

  const report = await CompatibilityImport.run({ source: "opencode", directory: tmp.path, write: false })

  expect(report.dryRun).toBe(true)
  expect(report.total).toBe(2)
  expect(report.copy).toBe(2)
  expect(report.candidates.map((candidate) => candidate.kind).sort()).toEqual(["command", "skill"])
  expect(report.candidates.find((candidate) => candidate.kind === "command")?.warnings).toContain(
    "unsupported_shell_interpolation",
  )
  expect(await Filesystem.exists(path.join(tmp.path, ".ax-code", "commands", "snapshot.md"))).toBe(false)
  expect(formatCompatibilityImportReport(report)).toContain("Import opencode: dry-run")
})

test("compatibility import writes copies without overwriting existing targets", async () => {
  await using tmp = await tmpdir({
    init: async (dir) => {
      const commandDir = path.join(dir, ".claude", "commands")
      await fs.mkdir(commandDir, { recursive: true })
      await Filesystem.write(path.join(commandDir, "review.md"), "Review source")
      await Filesystem.write(path.join(dir, ".ax-code", "commands", "review.md"), "Existing target")
    },
  })

  const report = await CompatibilityImport.run({ source: "claude", directory: tmp.path, write: true })

  expect(report.dryRun).toBe(false)
  expect(report.skipped).toBe(1)
  expect(report.candidates[0].reason).toBe("target_exists")
  expect(await Filesystem.readText(path.join(tmp.path, ".ax-code", "commands", "review.md"))).toBe("Existing target")
})
