import { mkdtempSync, writeFileSync, rmSync, readFileSync, statSync, chmodSync, mkdirSync } from "node:fs"
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
  verifyBrandedNodeRuns,
} from "./node-ffi-runner-brand.mjs"

describe("node FFI runner process branding", () => {
  test("job-title OSC sets icon and window titles, not OSC 0", () => {
    expect(AX_CODE_SPAWN_ARGV0).toBe("AX-Code")
    expect(axCodeJobTitleOsc()).toBe("\x1b]2;AX-Code\x07\x1b]1;AX-Code\x07")
    expect(axCodeJobTitleOsc()).not.toContain("]0;")
  })

  test("cache path and spawn options use the AX-Code token", () => {
    expect(brandedNodeName("darwin")).toBe("AX-Code")
    expect(brandedNodeName("win32")).toBe("AX-Code.exe")
    expect(brandedNodeCacheDir({ XDG_CACHE_HOME: "/tmp/cache" }, "/home/dev")).toBe(
      path.join("/tmp/cache", "ax-code", "libexec"),
    )
    expect(brandedSpawnOptions({ FOO: "1" })).toEqual({
      stdio: "inherit",
      env: { FOO: "1" },
      argv0: "AX-Code",
    })
  })

  test("brands into an isolated runtime/bin/AX-Code path", () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "ax-code-brand-"))
    try {
      const nodePath = path.join(root, "node")
      writeFileSync(nodePath, "#!/bin/sh\n")
      chmodSync(nodePath, 0o755)
      const cacheDir = path.join(root, "cache")
      const branded = resolveBrandedNodePath(nodePath, {
        cacheDir,
        platform: "darwin",
        verify: false,
      })
      expect(path.basename(branded)).toBe("AX-Code")
      expect(branded).toMatch(/runtime-[a-f0-9]+[/\\]bin[/\\]AX-Code$/)
      expect(statSync(branded).ino).toBe(statSync(nodePath).ino)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test("preparing a different Node keeps existing runtime binaries and libraries paired", () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "ax-code-brand-versions-"))
    try {
      const branded = ["first", "second"].map((version) => {
        const runtime = path.join(root, version)
        mkdirSync(path.join(runtime, "bin"), { recursive: true })
        mkdirSync(path.join(runtime, "lib"))
        const node = path.join(runtime, "bin", "node")
        writeFileSync(node, version)
        writeFileSync(path.join(runtime, "lib", "libnode.dylib"), version)
        return resolveBrandedNodePath(node, { cacheDir: path.join(root, "cache"), platform: "darwin", verify: false })
      })
      expect(branded[0]).not.toBe(branded[1])
      for (const [index, version] of ["first", "second"].entries()) {
        expect(readFileSync(branded[index], "utf8")).toBe(version)
        expect(readFileSync(path.join(path.dirname(branded[index]), "../lib/libnode.dylib"), "utf8")).toBe(version)
      }
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test("does not relocate Node on platforms whose terminals do not use the executable basename", () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "ax-code-brand-skip-"))
    try {
      const nodePath = path.join(root, "node")
      writeFileSync(nodePath, "#!/bin/sh\n")
      chmodSync(nodePath, 0o755)
      const cacheDir = path.join(root, "cache")

      expect(
        resolveBrandedNodePath(nodePath, {
          cacheDir,
          platform: "linux",
          verify: false,
        }),
      ).toBe(nodePath)
      expect(() => statSync(cacheDir)).toThrow()
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test("source runner spawns the TUI child under the AX-Code basename", () => {
    const runner = readFileSync(path.join(import.meta.dirname, "node-ffi-runner.mjs"), "utf8")
    expect(runner).toContain("resolveBrandedNodePath(runtime.path)")
    expect(runner).toContain("brandedSpawnOptions(process.env)")
    expect(runner).toContain("axCodeJobTitleOsc()")
    expect(runner).toContain('typeof process.execve === "function"')
    expect(runner).toContain("process.execve(brandedPath, [AX_CODE_SPAWN_ARGV0, ...tuiArgs], process.env)")
  })

  test("macOS-branded Homebrew-style Node actually runs and is named AX-Code", () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "ax-code-brand-run-"))
    try {
      const branded = resolveBrandedNodePath(process.execPath, {
        cacheDir: path.join(root, "libexec"),
        platform: "darwin",
      })
      expect(path.basename(branded)).toBe(brandedNodeName())
      expect(verifyBrandedNodeRuns(branded)).toBe(true)
      const child = spawnSync(branded, ["-e", "process.stdout.write(process.execPath + '\\n' + process.argv[0])"], {
        encoding: "utf8",
        argv0: AX_CODE_SPAWN_ARGV0,
        timeout: 5_000,
      })
      expect(child.status).toBe(0)
      expect(child.stdout).toContain("AX-Code")
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})
