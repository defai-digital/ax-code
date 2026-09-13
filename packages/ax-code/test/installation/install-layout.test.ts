import { describe, expect, test } from "vitest"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { Installation } from "../../src/installation"
import { standaloneInstallRoot, isWithinInstallPrefix } from "../../src/installation/install-layout"

describe("installation layout", () => {
  test("recognizes Windows bundles without matching neighboring or source directories", () => {
    expect(standaloneInstallRoot("C:/Users/test/.ax-code/lib/index-node-tui.js", "C:/Users/test", "win32")).toBe(
      "C:\\Users\\test\\.ax-code",
    )
    expect(standaloneInstallRoot("C:/Users/test/.ax-code/project/index.js", "C:/Users/test", "win32")).toBeUndefined()
    expect(isWithinInstallPrefix("/brew/ax-code-other/lib/run.js", "/brew/ax-code", "darwin")).toBe(false)
  })
  test.skipIf(process.platform === "win32")("resolves a symlinked launcher and installation root", async () => {
    const home = await fs.mkdtemp(path.join(os.tmpdir(), "ax-install-owner-"))
    try {
      const actual = path.join(home, "relocated runtime")
      await fs.mkdir(path.join(actual, "lib"), { recursive: true })
      const entry = path.join(actual, "lib/index-node-tui.js")
      await fs.writeFile(entry, "")
      await fs.symlink(actual, path.join(home, ".ax-code"))
      const launcher = path.join(home, "ax-code")
      await fs.symlink(entry, launcher)
      expect(await Installation.method({ home, entryPath: launcher })).toBe("curl")
      expect(await Installation.standaloneRoot({ home, entryPath: launcher })).toBe(await fs.realpath(actual))
    } finally {
      await fs.rm(home, { recursive: true, force: true })
    }
  })
})
