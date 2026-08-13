import { describe, expect, test } from "vitest"
import { fileURLToPath } from "node:url"
import { createHash } from "node:crypto"
import fs from "node:fs"
import path from "node:path"

// Guard for the vendored native resolver in @ax-code/opentui-core: the Zig
// shared libraries ship in-repo under packages/opentui-core/vendor/<target>/
// and the runtime must resolve them relative to the package (not via the
// upstream @opentui/core-<platform> npm packages through node_modules). If a
// vendored OpenTUI sync restores the npm-package resolution or drops the
// vendor tree, this test goes red before the regression ships.

const entry = fileURLToPath(import.meta.resolve("@ax-code/opentui-core"))
const pkgDir = path.dirname(entry)
const found = fs
  .readdirSync(pkgDir)
  .filter((f) => /^index-.*\.js$/.test(f))
  .map((f) => fs.readFileSync(path.join(pkgDir, f), "utf8"))
  .find((text) => text.includes("resolveVendoredNativeTarget"))
if (!found) throw new Error("vendored native resolver missing: resolveVendoredNativeTarget() not found in @ax-code/opentui-core")
const SRC: string = found

function loadResolver(): (proc: { platform: string; arch: string; env: Record<string, string | undefined> }) => string {
  const libc = SRC.match(/function validateLinuxLibcOverride\(\) \{[\s\S]*?\n\}/)
  const resolver = SRC.match(/function resolveVendoredNativeTarget\(\) \{[\s\S]*?\n\}/)
  if (!libc || !resolver) throw new Error("could not extract vendored native resolver functions")
  return new Function(
    "process",
    `${libc[0]}\n${resolver[0]}\nreturn resolveVendoredNativeTarget()`,
  ) as never
}

describe("opentui vendored native resolver", () => {
  test("no upstream @opentui/core-<platform> npm resolution remains in the bundle", () => {
    expect(SRC).not.toContain('import("@opentui/core-')
    expect(SRC).toContain("./vendor/")
  })

  test("maps every supported platform/arch/libc triple to a vendored target", () => {
    const resolve = loadResolver()
    const cases: Array<[Partial<NodeJS.Process>, string]> = [
      [{ platform: "darwin", arch: "arm64", env: {} }, "darwin-arm64"],
      [{ platform: "darwin", arch: "x64", env: {} }, "darwin-x64"],
      [{ platform: "linux", arch: "x64", env: {} }, "linux-x64"],
      [{ platform: "linux", arch: "arm64", env: {} }, "linux-arm64"],
      [{ platform: "linux", arch: "x64", env: { OPENTUI_LIBC: "musl" } }, "linux-x64-musl"],
      [{ platform: "linux", arch: "arm64", env: { OPENTUI_LIBC: "musl" } }, "linux-arm64-musl"],
      [{ platform: "linux", arch: "x64", env: { OPENTUI_LIBC: "glibc" } }, "linux-x64"],
      [{ platform: "win32", arch: "x64", env: {} }, "win32-x64"],
      [{ platform: "win32", arch: "arm64", env: {} }, "win32-arm64"],
    ]
    for (const [proc, expected] of cases) {
      expect(resolve(proc as never), JSON.stringify([proc.platform, proc.arch, proc.env])).toBe(expected)
    }
    expect(() => resolve({ platform: "freebsd", arch: "x64", env: {} } as never)).toThrow(/not supported/)
    expect(() => resolve({ platform: "linux", arch: "x64", env: { OPENTUI_LIBC: "bogus" } } as never)).toThrow(
      /OPENTUI_LIBC/,
    )
  })

  test("host target library exists at the vendored path and matches the manifest", () => {
    const manifest = JSON.parse(fs.readFileSync(path.join(pkgDir, "vendor", "manifest.json"), "utf8"))
    const key = `${process.platform}-${process.arch}`
    const entry = manifest.targets?.[key]
    expect(entry, `manifest target ${key}`).toBeTruthy()
    const libPath = path.join(pkgDir, "vendor", key, entry.lib.file)
    expect(fs.existsSync(libPath), libPath).toBe(true)
    const buf = fs.readFileSync(libPath)
    expect(buf.byteLength).toBe(entry.lib.size)
    expect(createHash("sha256").update(buf).digest("hex")).toBe(entry.lib.sha256)
  })
})
