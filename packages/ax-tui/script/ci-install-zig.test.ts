import { expect, test } from "vitest"
import { spawnSync } from "node:child_process"
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { extractZigArchive, MACOS_XCRUN_WRAPPER, patchTbdTargets, prepareMacosSdk, zigArchive } from "./ci-install-zig.js"

test("pinned Zig archives cover the Quality workflow hosts", () => {
  expect(zigArchive("linux", "x64").name).toBe("zig-x86_64-linux-0.15.2.tar.xz")
  expect(zigArchive("darwin", "arm64").name).toBe("zig-aarch64-macos-0.15.2.tar.xz")
  expect(zigArchive("win32", "x64").name).toBe("zig-x86_64-windows-0.15.2.zip")
  expect(zigArchive("linux", "x64").sha256).toMatch(/^[a-f0-9]{64}$/)
  expect(() => zigArchive("freebsd", "x64")).toThrow("No pinned Zig")
})

test("macOS stub targets gain an arm64-macos alias without repeating it", () => {
  const stub = ["targets: [ arm64e-macos, arm64e-maccatalyst ]", "targets: [ arm64-macos, arm64e-macos ]"].join("\n")
  expect(patchTbdTargets(stub)).toBe(
    ["targets: [ arm64-macos, arm64e-macos, arm64e-maccatalyst ]", "targets: [ arm64-macos, arm64e-macos ]"].join("\n"),
  )
})

test.skipIf(process.platform === "win32")("the SDK wrapper handles Zig's multi-argument SDK query", () => {
  for (const args of [["--show-sdk-path"], ["--sdk", "macosx", "--show-sdk-path"]]) {
    const result = spawnSync("sh", ["-c", MACOS_XCRUN_WRAPPER, "xcrun", ...args], {
      encoding: "utf8",
      env: { ...process.env, AX_CODE_TUI_MACOS_SDK: "/tmp/patched sdk" },
    })
    expect(result.status, result.stderr).toBe(0)
    expect(result.stdout.trim()).toBe("/tmp/patched sdk")
  }
})

test.skipIf(process.platform === "win32")("SDK preparation patches symbol targets in an independent copy", () => {
  const fixture = mkdtempSync(join(tmpdir(), "ax-tui-sdk-"))
  try {
    const source = join(fixture, "original.sdk")
    const alias = join(fixture, "MacOSX.sdk")
    const destination = join(fixture, "patched", "MacOSX.sdk")
    mkdirSync(join(source, "usr/lib"), { recursive: true })
    const stub = "targets: [ arm64-macos, arm64e-macos ]\nexports:\n  - targets: [ arm64e-macos ]\n"
    writeFileSync(join(source, "usr/lib/libSystem.tbd"), stub)
    chmodSync(join(source, "usr/lib/libSystem.tbd"), 0o444)
    symlinkSync(source, alias)

    expect(prepareMacosSdk(alias, destination)).toBe(destination)
    expect(readFileSync(join(destination, "usr/lib/libSystem.tbd"), "utf8")).toBe(patchTbdTargets(stub))
    expect(readFileSync(join(source, "usr/lib/libSystem.tbd"), "utf8")).toBe(stub)
    expect(statSync(join(source, "usr/lib/libSystem.tbd")).mode & 0o777).toBe(0o444)
  } finally {
    rmSync(fixture, { recursive: true, force: true })
  }
})

test.skipIf(process.platform === "linux")("native archive extraction accepts an absolute ZIP path", () => {
  const fixture = mkdtempSync(join(tmpdir(), "ax-tui-zig-archive-"))
  try {
    const archive = join(fixture, "compiler.zip")
    const zipped =
      "UEsDBBQAAAAIANWZUV1KUWtsCQAAAAcAAAAXAAAAemlnLWZpeHR1cmUvdmVyc2lvbi50eHQz0DM01TPiAgBQSwECFAMUAAAACADV" +
      "mVFdSlFrbAkAAAAHAAAAFwAAAAAAAAAAAAAAgAEAAAAAemlnLWZpeHR1cmUvdmVyc2lvbi50eHRQSwUGAAAAAAEAAQBFAAAAPgAAAAAA"
    writeFileSync(archive, Buffer.from(zipped, "base64"))
    extractZigArchive(archive, fixture)
    expect(readFileSync(join(fixture, "zig-fixture/version.txt"), "utf8")).toBe("0.15.2\n")
  } finally {
    rmSync(fixture, { recursive: true, force: true })
  }
})
