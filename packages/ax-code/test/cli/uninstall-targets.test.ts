import { afterEach, describe, expect, test, vi } from "vitest"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { Installation } from "../../src/installation"
import { collectRemovalTargets } from "../../src/cli/cmd/uninstall"

const options = { keepConfig: true, keepData: true, dryRun: true, force: false }
afterEach(() => vi.restoreAllMocks())

describe("uninstall targets", () => {
  test("targets the stable launcher instead of the running generation or Node executable", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "ax-uninstall-target-"))
    try {
      await fs.mkdir(path.join(root, "bin"))
      await fs.writeFile(path.join(root, "bin", "ax-code.cmd"), "")
      vi.spyOn(Installation, "standaloneRoot").mockResolvedValue(root)
      const targets = await collectRemovalTargets(options, "curl")
      expect(targets.binary).toBe(path.join(root, "bin", process.platform === "win32" ? "ax-code.cmd" : "ax-code"))
      expect(targets.binary).not.toBe(process.execPath)
      expect(
        targets.directories.filter((entry) => ["Config", "Data"].includes(entry.label)).every((entry) => entry.keep),
      ).toBe(true)
    } finally {
      await fs.rm(root, { recursive: true, force: true })
    }
  })

  test("retains the direct launcher for a legacy standalone binary", async () => {
    vi.spyOn(Installation, "standaloneRoot").mockResolvedValue(undefined)
    vi.spyOn(Installation, "activeInstallPath").mockResolvedValue("/home/test/.local/bin/ax-code")
    expect((await collectRemovalTargets(options, "curl")).binary).toBe("/home/test/.local/bin/ax-code")
  })

  test("does not offer to remove a source or package-managed runtime executable", async () => {
    expect((await collectRemovalTargets(options, "unknown")).binary).toBeNull()
    expect((await collectRemovalTargets(options, "brew")).binary).toBeNull()
  })
})
