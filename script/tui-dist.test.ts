import { describe, expect, test } from "vitest"
import { join } from "node:path"
import { shouldCopyTuiDistPath, toTuiDistPackageJson, withoutTuiTransformDependencies } from "./tui-dist"

const root = "/tmp/ax-code-tui"

describe("script.tui-dist", () => {
  test("keeps the Node TUI runtime files", () => {
    expect(shouldCopyTuiDistPath(join(root, "index.js"), root)).toBe(true)
    expect(shouldCopyTuiDistPath(join(root, "index-pcvh9d34.js"), root)).toBe(true)
    expect(shouldCopyTuiDistPath(join(root, "parser.worker.js"), root)).toBe(true)
    expect(shouldCopyTuiDistPath(join(root, "package.json"), root)).toBe(true)
    expect(shouldCopyTuiDistPath(join(root, "assets/typescript/tree-sitter-typescript.wasm"), root)).toBe(true)
    expect(shouldCopyTuiDistPath(join(root, "vendor/darwin-arm64/libopentui.dylib"), root)).toBe(true)
  })

  test("drops tests, types, unused zig grammar, and patch docs", () => {
    expect(shouldCopyTuiDistPath(join(root, "tests/yoga-upstream/utils.d.ts"), root)).toBe(false)
    expect(shouldCopyTuiDistPath(join(root, "assets/zig/tree-sitter-zig.wasm"), root)).toBe(false)
    expect(shouldCopyTuiDistPath(join(root, "patches/ffi-pointer-pin.md"), root)).toBe(false)
    expect(shouldCopyTuiDistPath(join(root, "MAINTENANCE.md"), root)).toBe(false)
    expect(shouldCopyTuiDistPath(join(root, "index.d.ts"), root)).toBe(false)
    expect(shouldCopyTuiDistPath(join(root, "lib/tree-sitter/update-assets.js"), root)).toBe(false)
    expect(shouldCopyTuiDistPath(join(root, "index.bun.js"), root)).toBe(false)
    expect(shouldCopyTuiDistPath(join(root, "node_modules/solid-js/package.json"), root)).toBe(false)
    expect(shouldCopyTuiDistPath(join(root, "solid/scripts/solid-transform.js"), root)).toBe(false)
  })

  test("drops only the public transform's dependencies from the precompiled CLI", () => {
    expect(
      withoutTuiTransformDependencies({
        "@babel/core": "7.29.6",
        "@babel/preset-typescript": "7.27.1",
        "babel-plugin-module-resolver": "5.0.2",
        "babel-preset-solid": "1.9.12",
        "babel-runtime-helper": "1.0.0",
        entities: "7.0.1",
        "s-js": "^0.4.9",
      }),
    ).toEqual({
      "babel-runtime-helper": "1.0.0",
      entities: "7.0.1",
      "s-js": "^0.4.9",
    })
  })

  test("rewrites the copied manifest without dangling build and type exports", () => {
    const files = new Set([
      "index.js",
      "solid/index.js",
      "solid/scripts/preload.js",
      "solid/scripts/preload.node.js",
      "spinner/dist/index.js",
    ])
    const catalog: Record<string, string> = {
      "solid-js": "1.9.12",
      "strip-ansi": "7.1.2",
    }
    const manifest = toTuiDistPackageJson(
      {
        main: "index.js",
        module: "index.js",
        types: "index.d.ts",
        scripts: { build: "tsc" },
        dependencies: { "@babel/core": "7.29.6", entities: "7.0.1", "strip-ansi": "catalog:" },
        peerDependencies: { "solid-js": "catalog:" },
        devDependencies: { typescript: "5.9.3" },
        exports: {
          ".": { types: "./index.d.ts", import: "./index.js" },
          "./solid": { types: "./solid/index.d.ts", import: "./solid/index.js" },
          "./solid/preload": { bun: "./solid/scripts/preload.js", node: "./solid/scripts/preload.node.js" },
          "./solid/transform": { import: "./solid/scripts/solid-transform.js" },
          "./spinner": { import: { types: "./spinner/dist/index.d.ts", default: "./spinner/dist/index.js" } },
        },
      },
      (file) => files.has(file),
      (name) => catalog[name],
    )

    expect(manifest).toMatchObject({
      main: "index.js",
      module: "index.js",
      dependencies: { entities: "7.0.1", "strip-ansi": "7.1.2" },
      peerDependencies: { "solid-js": "1.9.12" },
      exports: {
        ".": { import: "./index.js" },
        "./solid": { import: "./solid/index.js" },
        "./solid/preload": { node: "./solid/scripts/preload.node.js" },
        "./spinner": { import: { default: "./spinner/dist/index.js" } },
      },
    })
    expect(manifest).not.toHaveProperty("scripts")
    expect(manifest).not.toHaveProperty("devDependencies")
    expect(manifest).not.toHaveProperty("types")
    expect(manifest.exports).not.toHaveProperty("./solid/transform")
    expect(JSON.stringify(manifest)).not.toContain('"bun"')
    expect(JSON.stringify(manifest)).not.toContain("catalog:")
  })

  test("does not invent empty dependency fields", () => {
    const manifest = toTuiDistPackageJson(
      { exports: {} },
      () => false,
      () => "1.0.0",
    )

    expect(manifest).not.toHaveProperty("dependencies")
    expect(manifest).not.toHaveProperty("peerDependencies")
  })
})
