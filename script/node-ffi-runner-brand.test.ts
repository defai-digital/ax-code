import { mkdtempSync, writeFileSync, mkdirSync, rmSync, readFileSync, statSync, chmodSync } from "node:fs"
import os from "node:os"
import path from "node:path"
import { spawnSync } from "node:child_process"
import { describe, expect, test } from "vitest"
import {
  AX_CODE_SPAWN_ARGV0,
  axCodeJobTitleOsc,
  brandedNodeCacheDir,
  brandedNodeName,
  brandedSpawnOptions,
  resolveBrandedNodePath,
} from "./node-ffi-runner-brand.mjs"

describe("node FFI runner process branding", () => {
  test("job-title OSC sets icon and window titles, not OSC 0", () => {
    expect(AX_CODE_SPAWN_ARGV0).toBe("AX-Code")
    expect(axCodeJobTitleOsc()).toBe("\x1b]1;AX-Code\x07\x1b]2;AX-Code\x07")
    expect(axCodeJobTitleOsc()).not.toContain("]0;")
  })

  test("cache path and spawn options use the AX-Code token", () => {
    expect(brandedNodeName("darwin")).toBe("AX-Code")
    expect(brandedNodeName("win32")).toBe("AX-Code.exe")
    expect(brandedNodeCacheDir({ XDG_CACHE_HOME: "/tmp/cache" }, "/home/dev")).toBe(
      path.join("/tmp/cache", "ax-code", "libexec"),
    )
    expect(brandedNodeCacheDir({}, "/home/dev")).toBe(path.join("/home/dev", ".cache", "ax-code", "libexec"))
    expect(brandedSpawnOptions({ FOO: "1" })).toEqual({
      stdio: "inherit",
      env: { FOO: "1" },
      argv0: "AX-Code",
    })
  })

  test("hardlinks the Node binary under the AX-Code basename", () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "ax-code-brand-"))
    try {
      const nodePath = path.join(root, "node")
      const cacheDir = path.join(root, "libexec")
      writeFileSync(nodePath, "#!/bin/sh\n")
      chmodSync(nodePath, 0o755)
      const branded = resolveBrandedNodePath(nodePath, { cacheDir, platform: "darwin" })
      expect(path.basename(branded)).toBe("AX-Code")
      expect(statSync(branded).ino).toBe(statSync(nodePath).ino)
      expect(resolveBrandedNodePath(nodePath, { cacheDir, platform: "darwin" })).toBe(branded)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test("source runner spawns the TUI child under the AX-Code basename", () => {
    const runner = readFileSync(path.join(import.meta.dirname, "node-ffi-runner.mjs"), "utf8")
    expect(runner).toContain("resolveBrandedNodePath(runtime.path)")
    expect(runner).toContain("brandedSpawnOptions(process.env)")
    expect(runner).toContain("axCodeJobTitleOsc()")
  })

  test("branded argv0 is visible to the child process", () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "ax-code-brand-argv-"))
    try {
      const cacheDir = path.join(root, "libexec")
      mkdirSync(cacheDir, { recursive: true })
      const branded = resolveBrandedNodePath(process.execPath, { cacheDir, platform: process.platform })
      const result = spawnSync(branded, ["-e", "process.stdout.write(process.argv[0])"], {
        encoding: "utf8",
        argv0: AX_CODE_SPAWN_ARGV0,
        timeout: 5_000,
      })
      expect(result.status).toBe(0)
      expect(result.stdout).toContain("AX-Code")
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})
