import { afterEach, describe, expect, test } from "vitest"
import { writeFile, mkdir } from "node:fs/promises"
import path from "path"
import { Env } from "../../src/util/env"
import { tmpdir } from "../fixture/fixture"
import { stringWidth } from "../../src/bun/node-compat"

// The Bun→Node compat shim is installed globally by test/support/vitest.setup.ts.

describe("node-compat Bun.$ shell", () => {
  const SECRET = "PLUGIN_LEAK_API_KEY"

  afterEach(() => {
    delete process.env[SECRET]
  })

  // Regression: the plugin host gives plugins `Bun.$.env(Env.sanitize(process.env))`
  // so an untrusted plugin shell cannot read provider tokens. Bun's `$.env(obj)`
  // REPLACES the environment; if the shim merged process.env back in as a base,
  // sanitize()'s stripped keys (omitted, not set to undefined) would reappear.
  test(".env(obj) replaces the environment instead of merging process.env", async () => {
    process.env[SECRET] = "should-not-leak"
    const sanitized = Env.sanitize(process.env)
    expect(sanitized[SECRET]).toBeUndefined()

    const shell = Bun.$.env(sanitized)
    const res =
      await shell`${process.execPath} -e ${"process.stdout.write(Object.keys(process.env).join(String.fromCharCode(10)))"}`.quiet()
    const keys = res.stdout.toString().split("\n")

    expect(keys).not.toContain(SECRET)
    // PATH is not secret-like, so sanitize keeps it and the child still resolves.
    expect(keys).toContain("PATH")
  })

  // Bun's `$` flattens an interpolated array into separate escaped args; a naive
  // String(array) would collapse them into one comma-joined token.
  test("interpolated arrays flatten into separate arguments", async () => {
    const args = ["one", "two three", "fo'ur"]
    const res =
      await Bun.$`${process.execPath} -e ${"process.stdout.write(process.argv.slice(1).join(String.fromCharCode(10)))"} ${args}`.quiet()
    const printed = res.stdout.toString().split("\n")
    expect(printed).toEqual(args)
  })

  test("Bun.write resolves to the number of bytes written", async () => {
    await using dir = await tmpdir()

    await expect(Bun.write(path.join(dir.path, "text.txt"), "λ")).resolves.toBe(Buffer.byteLength("λ"))
    await expect(Bun.write(path.join(dir.path, "bytes.bin"), new Uint8Array([0, 1, 2, 3]))).resolves.toBe(4)
  })

  test("Glob.scan accepts a string cwd like Bun", async () => {
    await using dir = await tmpdir({
      init: async (root) => {
        await mkdir(path.join(root, "src"), { recursive: true })
        await writeFile(path.join(root, "src", "app.ts"), "export const app = true\n")
        await writeFile(path.join(root, "outside.ts"), "export const outside = true\n")
      },
    })

    const files = await Array.fromAsync(new Bun.Glob("**/*.ts").scan(path.join(dir.path, "src")))

    expect(files).toEqual(["app.ts"])
  })

  test("Glob.scanSync honors absolute and dot options", async () => {
    await using dir = await tmpdir({
      init: async (root) => {
        await writeFile(path.join(root, "visible.ts"), "export const visible = true\n")
        await writeFile(path.join(root, ".hidden.ts"), "export const hidden = true\n")
      },
    })

    const glob = new Bun.Glob("*.ts")
    expect(Array.from(glob.scanSync({ cwd: dir.path }))).toEqual(["visible.ts"])
    expect(Array.from(glob.scanSync({ cwd: dir.path, dot: true })).sort()).toEqual([".hidden.ts", "visible.ts"])
    expect(Array.from(glob.scanSync({ cwd: dir.path, absolute: true }))).toEqual([path.join(dir.path, "visible.ts")])
  })

  test("Glob.scan includes matching directories when onlyFiles is false", async () => {
    await using dir = await tmpdir({
      init: async (root) => {
        await writeFile(path.join(root, "file.txt"), "")
        await mkdir(path.join(root, "subdir"), { recursive: true })
        await writeFile(path.join(root, "subdir", "nested.txt"), "")
      },
    })

    const glob = new Bun.Glob("*")
    expect((await Array.fromAsync(glob.scan({ cwd: dir.path }))).sort()).toEqual(["file.txt"])
    expect((await Array.fromAsync(glob.scan({ cwd: dir.path, onlyFiles: false }))).sort()).toEqual([
      "file.txt",
      "subdir",
    ])
  })

  test("Glob.scanSync includes matching directories when onlyFiles is false", async () => {
    await using dir = await tmpdir({
      init: async (root) => {
        await writeFile(path.join(root, "file.txt"), "")
        await mkdir(path.join(root, "subdir"), { recursive: true })
        await writeFile(path.join(root, "subdir", "nested.txt"), "")
      },
    })

    const glob = new Bun.Glob("*")
    expect(Array.from(glob.scanSync({ cwd: dir.path })).sort()).toEqual(["file.txt"])
    expect(Array.from(glob.scanSync({ cwd: dir.path, onlyFiles: false })).sort()).toEqual(["file.txt", "subdir"])
  })
})

describe("node-compat stringWidth", () => {
  // These must match packages/ax-code-tui's vendored native renderer
  // (upstream sst/opentui, packages/core/src/zig/utf8.zig `eawToWidth`) or
  // this shim's cursor/wrap/truncate math drifts from what actually renders.
  test("CJK ideographs and kana are two columns wide", () => {
    expect(stringWidth("中文字")).toBe(6)
    expect(stringWidth("ひらがな")).toBe(8)
    expect(stringWidth("한글")).toBe(4)
  })

  test("Ambiguous-width Latin-adjacent characters stay one column wide", () => {
    expect(stringWidth("αβγ")).toBe(3)
    expect(stringWidth("абв")).toBe(3)
    expect(stringWidth("±×÷§°")).toBe(5)
  })

  // Regression: a blanket 0x1f300-0x1faff range both missed status glyphs
  // below that block and over-counted narrow gaps inside it.
  test("emoji/status glyphs below U+1F300 are two columns wide, matching the native table", () => {
    expect(stringWidth("⌚")).toBe(2) // ⌚ watch
    expect(stringWidth("⏰")).toBe(2) // ⏰ alarm clock
    expect(stringWidth("☔")).toBe(2) // ☔ umbrella with rain drops
    expect(stringWidth("✅")).toBe(2) // ✅ check mark button
    expect(stringWidth("❌")).toBe(2) // ❌ cross mark
    expect(stringWidth("⚠")).toBe(1) // ⚠ warning sign is narrow in the native table
  })

  test("narrow gaps inside the 0x1f300-0x1faff block stay one column wide", () => {
    expect(stringWidth("\u{1F321}")).toBe(1) // thermometer: outside every native wide sub-range
    expect(stringWidth("\u{1F394}")).toBe(1) // rosette: outside every native wide sub-range
  })

  test("supplementary-plane CJK and common emoji stay two columns wide", () => {
    expect(stringWidth("\u{20000}")).toBe(2) // CJK Ext B ideograph
    expect(stringWidth("😀")).toBe(2)
  })
})
