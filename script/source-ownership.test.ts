import { execFileSync } from "node:child_process"
import { existsSync, readFileSync } from "node:fs"
import path from "node:path"
import { describe, expect, test } from "vitest"

const root = path.resolve(import.meta.dirname, "..")

describe("Desktop source ownership", () => {
  test("keeps the GUI implementation outside AX Code", () => {
    const trackedDesktop = execFileSync("git", ["ls-files", "--", "desktop"], {
      cwd: root,
      encoding: "utf8",
    }).trim()
    expect(trackedDesktop).toBe("")
    expect(existsSync(path.join(root, "desktop"))).toBe(false)

    const manifest = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8")) as {
      workspaces?: string[]
      scripts?: Record<string, string>
    }
    expect(manifest.workspaces ?? []).not.toContain("desktop/packages/*")
    expect(Object.keys(manifest.scripts ?? {}).filter((name) => name.includes("desktop"))).toEqual([])
    expect(manifest.scripts?.["release:all"]).toBeUndefined()

    const workspace = readFileSync(path.join(root, "pnpm-workspace.yaml"), "utf8")
    expect(workspace).not.toContain("desktop/packages")

    const turbo = JSON.parse(readFileSync(path.join(root, "turbo.json"), "utf8")) as {
      tasks?: Record<string, unknown>
    }
    expect(Object.keys(turbo.tasks ?? {}).filter((name) => /desktop|electron|openchamber/i.test(name))).toEqual([])

    expect(existsSync(path.join(root, ".github/workflows/desktop-ci.yml"))).toBe(false)
    expect(existsSync(path.join(root, ".github/workflows/desktop-release.yml"))).toBe(false)
    expect(existsSync(path.join(root, "CHANGELOG.md"))).toBe(true)
    expect(existsSync(path.join(root, "script/fix-node-pty-permissions.mjs"))).toBe(true)
  })
})
