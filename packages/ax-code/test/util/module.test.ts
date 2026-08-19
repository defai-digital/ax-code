import { describe, expect, test } from "vitest"
import path from "path"
import { Module } from "@ax-code/util/module"
import { Filesystem } from "../../src/util/filesystem"
import { tmpdir } from "../fixture/fixture"

describe("util.module", () => {
  test("resolves package subpaths from the provided dir", async () => {
    await using tmp = await tmpdir()
    const root = path.join(tmp.path, "proj")
    const file = path.join(root, "node_modules/typescript/lib/tsserver.js")
    await Filesystem.write(file, "export {}\n")
    await Filesystem.writeJson(path.join(root, "node_modules/typescript/package.json"), { name: "typescript" })

    expect(Module.resolve("typescript/lib/tsserver.js", root)).toBe(file)
  })

  test("resolves packages through ancestor node_modules", async () => {
    await using tmp = await tmpdir()
    const root = path.join(tmp.path, "proj")
    const cwd = path.join(root, "apps/web")
    const file = path.join(root, "node_modules/eslint/lib/api.js")
    await Filesystem.write(file, "export {}\n")
    await Filesystem.writeJson(path.join(root, "node_modules/eslint/package.json"), {
      name: "eslint",
      main: "lib/api.js",
    })
    await Filesystem.write(path.join(cwd, ".keep"), "")

    expect(Module.resolve("eslint", cwd)).toBe(file)
  })

  test("resolves relative to the provided dir", async () => {
    await using tmp = await tmpdir()
    const a = path.join(tmp.path, "a")
    const b = path.join(tmp.path, "b")
    const left = path.join(a, "node_modules/biome/index.js")
    const right = path.join(b, "node_modules/biome/index.js")
    await Filesystem.write(left, "export {}\n")
    await Filesystem.write(right, "export {}\n")
    await Filesystem.writeJson(path.join(a, "node_modules/biome/package.json"), {
      name: "biome",
      main: "index.js",
    })
    await Filesystem.writeJson(path.join(b, "node_modules/biome/package.json"), {
      name: "biome",
      main: "index.js",
    })

    expect(Module.resolve("biome", a)).toBe(left)
    expect(Module.resolve("biome", b)).toBe(right)
    expect(Module.resolve("biome", a)).not.toBe(Module.resolve("biome", b))
  })

  test("returns undefined when resolution fails", async () => {
    await using tmp = await tmpdir()
    expect(Module.resolve("missing-package", tmp.path)).toBeUndefined()
  })

  test("resolveEntry returns a file path unchanged", async () => {
    await using tmp = await tmpdir()
    const file = path.join(tmp.path, "create.js")
    await Filesystem.write(file, "export {}\n")
    expect(Module.resolveEntry(file)).toBe(file)
  })

  test("resolveEntry follows ESM exports.import like @ai-sdk/anthropic", async () => {
    await using tmp = await tmpdir()
    const pkg = path.join(tmp.path, "node_modules/@ai-sdk/anthropic")
    const entry = path.join(pkg, "dist/index.js")
    await Filesystem.write(entry, "export function createAnthropic() {}\n")
    await Filesystem.writeJson(path.join(pkg, "package.json"), {
      name: "@ai-sdk/anthropic",
      type: "module",
      exports: {
        ".": {
          types: "./dist/index.d.ts",
          import: "./dist/index.js",
          default: "./dist/index.js",
        },
      },
    })
    expect(Module.resolveEntry(pkg)).toBe(entry)
  })

  test("resolveEntry falls back to package.json main", async () => {
    await using tmp = await tmpdir()
    const pkg = path.join(tmp.path, "sdk")
    const entry = path.join(pkg, "lib/api.js")
    await Filesystem.write(entry, "export {}\n")
    await Filesystem.writeJson(path.join(pkg, "package.json"), {
      name: "sdk",
      main: "lib/api.js",
    })
    expect(Module.resolveEntry(pkg)).toBe(entry)
  })

  test("resolveEntry returns undefined for a directory with no package entry", async () => {
    await using tmp = await tmpdir()
    await Filesystem.write(path.join(tmp.path, ".keep"), "")
    expect(Module.resolveEntry(tmp.path)).toBeUndefined()
  })

  test("resolveEntry rejects a main that escapes the package directory", async () => {
    await using tmp = await tmpdir()
    const pkg = path.join(tmp.path, "sdk")
    const outside = path.join(tmp.path, "escape.js")
    await Filesystem.write(outside, "export {}\n")
    await Filesystem.writeJson(path.join(pkg, "package.json"), {
      name: "sdk",
      main: "../escape.js",
    })
    expect(Module.resolveEntry(pkg)).toBeUndefined()
  })
})
