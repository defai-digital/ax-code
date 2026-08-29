import { describe, expect, test } from "vitest"
import fs from "fs"
import os from "os"
import path from "path"
import { LOCKSTEP_MANIFESTS, findLockstepDrift, readManifestVersions } from "./check-desktop-version-lockstep"

describe("check-desktop-version-lockstep", () => {
  test("covers the CLI and all three desktop packages", () => {
    expect([...LOCKSTEP_MANIFESTS]).toEqual([
      "packages/ax-code/package.json",
      "desktop/packages/electron/package.json",
      "desktop/packages/web/package.json",
      "desktop/packages/ui/package.json",
    ])
  })

  test("reads versions from manifests on disk", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "ax-lockstep-"))
    try {
      for (const manifest of LOCKSTEP_MANIFESTS) {
        const file = path.join(root, manifest)
        fs.mkdirSync(path.dirname(file), { recursive: true })
        fs.writeFileSync(file, JSON.stringify({ version: "7.9.12" }))
      }
      const entries = readManifestVersions(root)
      expect(entries).toHaveLength(4)
      expect(entries.every((entry) => entry.version === "7.9.12")).toBe(true)
      expect(findLockstepDrift(entries)).toEqual([])
    } finally {
      fs.rmSync(root, { recursive: true, force: true })
    }
  })

  test("flags any desktop package that drifted from the CLI version", () => {
    const drift = findLockstepDrift([
      { manifest: "packages/ax-code/package.json", version: "7.9.12" },
      { manifest: "desktop/packages/electron/package.json", version: "7.9.12" },
      { manifest: "desktop/packages/web/package.json", version: "7.9.11" },
      { manifest: "desktop/packages/ui/package.json", version: "7.9.12" },
    ])
    expect(drift).toEqual([{ manifest: "desktop/packages/web/package.json", version: "7.9.11" }])
  })

  test("the live monorepo is in lockstep", () => {
    const root = path.resolve(__dirname, "..")
    const entries = readManifestVersions(root)
    expect(entries.every((entry) => entry.version.length > 0)).toBe(true)
    expect(findLockstepDrift(entries)).toEqual([])
  })
})
