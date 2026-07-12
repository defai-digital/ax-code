/**
 * Real sandbox-exec integration (macOS only).
 * Proves: write inside workspace OK, mktemp OK, write outside denied.
 */
import { describe, expect, test } from "vitest"
import { OsSandbox } from "../../src/isolation/os-sandbox"
import fs from "fs"
import os from "os"
import path from "path"
import { spawnSync } from "child_process"

const isDarwin = process.platform === "darwin"

describe("OsSandbox seatbelt integration", () => {
  test.skipIf(!isDarwin)("allows workspace write + mktemp; denies outside write", () => {
    const avail = OsSandbox.probeAvailability("darwin")
    if (!avail.available) {
      expect(avail.reason).toMatch(/sandbox-exec/)
      return
    }

    // Workspace under home so it is distinct from tempWriteRoots (/var/folders, /tmp).
    const homeBase = path.join(os.homedir(), ".ax-code-os-sandbox-test")
    fs.mkdirSync(homeBase, { recursive: true })
    const workspace = fs.mkdtempSync(path.join(homeBase, "ws-"))
    const realWorkspace = OsSandbox.canonicalPath(workspace)
    // Outside: sibling under home, not in workspace and not under TMPDIR allow-list.
    const outside = path.join(homeBase, `outside-${process.pid}-${Date.now()}.txt`)
    const insideFile = path.join(realWorkspace, "inside-ok.txt")

    try {
      fs.unlinkSync(outside)
    } catch {
      // ignore
    }

    const command = [
      `echo workspace_ok > "${insideFile}"`,
      `TMP_FILE=$(mktemp)`,
      `echo mktemp_ok > "$TMP_FILE"`,
      `test -s "$TMP_FILE"`,
      `echo mktemp_path=$TMP_FILE`,
      // Outside workspace + outside temp roots → Seatbelt must deny
      `touch "${outside}" 2>/dev/null || true`,
      `if [ -f "${outside}" ]; then echo OUTSIDE_WRITE_SUCCEEDED; exit 3; fi`,
      `echo OUTSIDE_WRITE_BLOCKED`,
    ].join(" && ")

    const wrap = OsSandbox.wrapCommand({
      command,
      shell: "/bin/bash",
      cwd: realWorkspace,
      workspaceRoot: realWorkspace,
      network: false,
    })
    expect(wrap.active).toBe(true)
    if (!wrap.active) return

    const result = spawnSync(wrap.file, wrap.args, {
      encoding: "utf8",
      cwd: realWorkspace,
      env: process.env,
    })
    OsSandbox.cleanupProfile(wrap.profilePath)

    const stdout = result.stdout ?? ""
    const stderr = result.stderr ?? ""
    // Workspace write
    expect(fs.existsSync(insideFile)).toBe(true)
    expect(fs.readFileSync(insideFile, "utf8")).toContain("workspace_ok")
    // mktemp worked
    expect(stdout).toMatch(/mktemp_path=/)
    // Outside write blocked
    expect(fs.existsSync(outside)).toBe(false)
    expect(stdout).toContain("OUTSIDE_WRITE_BLOCKED")
    expect(stdout).not.toContain("OUTSIDE_WRITE_SUCCEEDED")
    // Process may still exit 0 if our script handled the failed touch
    expect(result.status).toBe(0)

    // Profile should use realpath for tmp (macOS /var → /private/var)
    const profile = OsSandbox.buildSeatbeltProfile({
      workspaceRoot: realWorkspace,
      network: false,
    })
    for (const root of OsSandbox.tempWriteRoots()) {
      expect(profile).toContain(root)
    }
    // Cleanup
    try {
      fs.rmSync(workspace, { recursive: true, force: true })
      fs.unlinkSync(outside)
    } catch {
      // ignore
    }
    void stderr
  })

  test("canonicalPath realpaths existing dirs", () => {
    const tmp = OsSandbox.canonicalPath(os.tmpdir())
    expect(tmp.startsWith("/")).toBe(true)
    // On macOS tmpdir often realpaths under /private/var/folders
    if (process.platform === "darwin") {
      expect(tmp.includes("/var/") || tmp.includes("/private/")).toBe(true)
    }
  })

  test("buildSeatbeltProfile uses realpath for workspace and tmp", () => {
    const ws = OsSandbox.canonicalPath(os.tmpdir())
    const profile = OsSandbox.buildSeatbeltProfile({
      workspaceRoot: ws,
      network: false,
    })
    expect(profile).toContain(`subpath "${ws}"`)
    const tmpRoots = OsSandbox.tempWriteRoots()
    expect(tmpRoots.length).toBeGreaterThan(0)
    expect(tmpRoots.some((r) => profile.includes(r))).toBe(true)
  })
})
