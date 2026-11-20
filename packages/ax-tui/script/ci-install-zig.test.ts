import { expect, test } from "vitest"
import { spawnSync } from "node:child_process"
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  extractZigArchive,
  MACOS_XCRUN_WRAPPER,
  patchMathHeader,
  patchTbdTargets,
  prepareMacosSdk,
  zigArchive,
} from "./ci-install-zig.js"

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

const MODERN_MATH_HEADER = [
  "#if defined(__GNUC__)",
  "#   define    HUGE_VALF    __builtin_huge_valf()",
  "#   if defined(__has_feature) && __has_feature(modules) && defined(__has_include) && __has_include(<float.h>)",
  "#       define __need_infinity_nan",
  "#       include <float.h>",
  "#       undef __need_infinity_nan",
  "#   else",
  '#       define    NAN          __builtin_nanf("0x7fc00000")',
  "#   endif",
  "#endif",
  "",
  "#if !defined(__GNUC__) || !defined(__has_feature) || !__has_feature(modules) || !defined(__has_include) || !__has_include(<float.h>)",
  "#define INFINITY    HUGE_VALF",
  "#endif",
  "",
].join("\n")

test("modules-only SDK math.h gains guarded INFINITY/NAN fallbacks for Zig's libcxx build", () => {
  const patched = patchMathHeader(MODERN_MATH_HEADER)
  expect(patched).toContain("#ifndef INFINITY\n#define INFINITY    HUGE_VALF\n#endif")
  expect(patched).toContain('#ifndef NAN\n#define NAN         __builtin_nanf("0x7fc00000")\n#endif')
  expect(patched.indexOf("#ifndef INFINITY")).toBeGreaterThan(patched.indexOf("#define INFINITY    HUGE_VALF"))
  expect(patchMathHeader(patched)).toBe(patched)
})

test("SDK math.h without the modules float.h contract is left untouched", () => {
  const legacy = ["#define HUGE_VALF __builtin_huge_valf()", "#define INFINITY HUGE_VALF", '#define NAN __builtin_nanf("")'].join(
    "\n",
  )
  expect(patchMathHeader(legacy)).toBe(legacy)
  expect(patchMathHeader("#define FP_NAN 1\n")).toBe("#define FP_NAN 1\n")
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

test.skipIf(process.platform === "win32")("SDK preparation patches the modules math.h in an independent copy", () => {
  const fixture = mkdtempSync(join(tmpdir(), "ax-tui-sdk-math-"))
  try {
    const source = join(fixture, "original.sdk")
    const destination = join(fixture, "patched", "MacOSX.sdk")
    mkdirSync(join(source, "usr/lib"), { recursive: true })
    mkdirSync(join(source, "usr/include"), { recursive: true })
    writeFileSync(join(source, "usr/lib/libSystem.tbd"), "targets: [ arm64-macos ]\n")
    writeFileSync(join(source, "usr/include/math.h"), MODERN_MATH_HEADER)
    chmodSync(join(source, "usr/include/math.h"), 0o444)

    expect(prepareMacosSdk(source, destination)).toBe(destination)
    expect(readFileSync(join(destination, "usr/include/math.h"), "utf8")).toBe(patchMathHeader(MODERN_MATH_HEADER))
    expect(readFileSync(join(source, "usr/include/math.h"), "utf8")).toBe(MODERN_MATH_HEADER)
    expect(statSync(join(source, "usr/include/math.h")).mode & 0o777).toBe(0o444)
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
