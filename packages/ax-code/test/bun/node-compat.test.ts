import { afterEach, describe, expect, test } from "vitest"
import path from "path"
import { Env } from "../../src/util/env"
import { tmpdir } from "../fixture/fixture"

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

  test("Glob.scan accepts a string cwd like Bun", async () => {
    await using dir = await tmpdir({
      init: async (root) => {
        await Bun.write(path.join(root, "src", "app.ts"), "export const app = true\n")
        await Bun.write(path.join(root, "outside.ts"), "export const outside = true\n")
      },
    })

    const files = await Array.fromAsync(new Bun.Glob("**/*.ts").scan(path.join(dir.path, "src")))

    expect(files).toEqual(["app.ts"])
  })

  test("Glob.scanSync honors absolute and dot options", async () => {
    await using dir = await tmpdir({
      init: async (root) => {
        await Bun.write(path.join(root, "visible.ts"), "export const visible = true\n")
        await Bun.write(path.join(root, ".hidden.ts"), "export const hidden = true\n")
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
        await Bun.write(path.join(root, "file.txt"), "")
        await Bun.write(path.join(root, "subdir", "nested.txt"), "")
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
        await Bun.write(path.join(root, "file.txt"), "")
        await Bun.write(path.join(root, "subdir", "nested.txt"), "")
      },
    })

    const glob = new Bun.Glob("*")
    expect(Array.from(glob.scanSync({ cwd: dir.path })).sort()).toEqual(["file.txt"])
    expect(Array.from(glob.scanSync({ cwd: dir.path, onlyFiles: false })).sort()).toEqual(["file.txt", "subdir"])
  })
})
