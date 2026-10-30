import { describe, expect, test } from "vitest"
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { assertBinaryFormat, checkVendorTree } from "./vendor-tui-native"

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..")
const VENDOR = join(ROOT, "vendor")

describe("script.vendor-tui-native", () => {
  test("committed vendor tree matches manifest (offline integrity check)", () => {
    expect(checkVendorTree()).toEqual([])
  })

  test("manifest records provenance for all 8 local build targets", () => {
    const manifest = JSON.parse(readFileSync(join(VENDOR, "manifest.json"), "utf8"))
    expect(manifest.origin).toMatchObject({ version: expect.any(String), license: "MIT" })
    for (const [key, entry] of Object.entries<any>(manifest.targets)) {
      expect(entry.build.sourceSha256, key).toMatch(/^[0-9a-f]{64}$/)
      expect(entry.build.zigVersion, key).toBe("0.15.2")
      expect(entry.package, key).toBeUndefined()
      expect(entry.tarball, key).toBeUndefined()
      expect(entry.lib.sha256, key).toMatch(/^[0-9a-f]{64}$/)
      expect(entry.lib.size, key).toBeGreaterThan(1_000_000)
      expect(entry.licenseSha256, key).toMatch(/^[0-9a-f]{64}$/)
      const license = readFileSync(join(VENDOR, key, "LICENSE"), "utf8")
      expect(license).toContain("Copyright (c) 2025 opentui")
      expect(license).toContain("Copyright (c) 2026 DEFAI Digital")
      expect(license).toContain("Facebook, Inc.")
      expect(license).toContain("Jacob Sandlund")
      expect(license).toContain("Unicode")
    }
  })

  test("rejects stale source builds and unsafe library paths before reading them", () => {
    const fixture = mkdtempSync(join(tmpdir(), "ax-tui-manifest-"))
    try {
      const manifest = JSON.parse(readFileSync(join(VENDOR, "manifest.json"), "utf8"))
      manifest.targets["darwin-arm64"].build.sourceSha256 = "0".repeat(64)
      manifest.targets["linux-x64"].lib.file = "../../package.json"
      const file = join(fixture, "manifest.json")
      writeFileSync(file, JSON.stringify(manifest))
      expect(checkVendorTree(VENDOR, file)).toEqual([
        "darwin-arm64: native source has changed; rebuild",
        "linux-x64: invalid library filename",
      ])
    } finally {
      rmSync(fixture, { recursive: true, force: true })
    }
  })

  test("binary format validation accepts matching and rejects mismatched targets", () => {
    const dylibArm64 = readFileSync(join(VENDOR, "darwin-arm64", "libaxtui.dylib"))
    expect(() => assertBinaryFormat(dylibArm64, { os: "darwin", cpu: "arm64", key: "darwin-arm64" })).not.toThrow()
    expect(() => assertBinaryFormat(dylibArm64, { os: "darwin", cpu: "x64", key: "darwin-x64" })).toThrow()
    expect(() => assertBinaryFormat(dylibArm64, { os: "linux", cpu: "arm64", key: "linux-arm64" })).toThrow()

    const elf = readFileSync(join(VENDOR, "linux-x64", "libaxtui.so"))
    expect(() => assertBinaryFormat(elf, { os: "linux", cpu: "x64", key: "linux-x64" })).not.toThrow()
    expect(() => assertBinaryFormat(elf, { os: "linux", cpu: "arm64", key: "linux-arm64" })).toThrow()

    const dll = readFileSync(join(VENDOR, "win32-arm64", "axtui.dll"))
    expect(() => assertBinaryFormat(dll, { os: "win32", cpu: "arm64", key: "win32-arm64" })).not.toThrow()
    expect(() => assertBinaryFormat(dll, { os: "win32", cpu: "x64", key: "win32-x64" })).toThrow()

    expect(() =>
      assertBinaryFormat(Buffer.from("not a binary at all"), { os: "linux", cpu: "x64", key: "linux-x64" }),
    ).toThrow()
  })
})
