import { describe, expect, test } from "vitest"
import { join } from "node:path"
import { shouldCopyOpentuiDistPath, withoutOpentuiBuildOnlyDependencies } from "./opentui-dist"

const root = "/tmp/opentui-core"

describe("script.opentui-dist", () => {
  test("keeps the Node TUI runtime files", () => {
    expect(shouldCopyOpentuiDistPath(join(root, "index.js"), root)).toBe(true)
    expect(shouldCopyOpentuiDistPath(join(root, "index-pcvh9d34.js"), root)).toBe(true)
    expect(shouldCopyOpentuiDistPath(join(root, "parser.worker.js"), root)).toBe(true)
    expect(shouldCopyOpentuiDistPath(join(root, "package.json"), root)).toBe(true)
    expect(shouldCopyOpentuiDistPath(join(root, "assets/typescript/tree-sitter-typescript.wasm"), root)).toBe(true)
    expect(shouldCopyOpentuiDistPath(join(root, "vendor/darwin-arm64/libopentui.dylib"), root)).toBe(true)
  })

  test("drops tests, types, unused zig grammar, and patch docs", () => {
    expect(shouldCopyOpentuiDistPath(join(root, "tests/yoga-upstream/utils.d.ts"), root)).toBe(false)
    expect(shouldCopyOpentuiDistPath(join(root, "assets/zig/tree-sitter-zig.wasm"), root)).toBe(false)
    expect(shouldCopyOpentuiDistPath(join(root, "patches/ffi-pointer-pin.md"), root)).toBe(false)
    expect(shouldCopyOpentuiDistPath(join(root, "MAINTENANCE.md"), root)).toBe(false)
    expect(shouldCopyOpentuiDistPath(join(root, "index.d.ts"), root)).toBe(false)
    expect(shouldCopyOpentuiDistPath(join(root, "lib/tree-sitter/update-assets.js"), root)).toBe(false)
    expect(shouldCopyOpentuiDistPath(join(root, "index.bun.js"), root)).toBe(false)
    expect(shouldCopyOpentuiDistPath(join(root, "node_modules/solid-js/package.json"), root)).toBe(false)
    expect(shouldCopyOpentuiDistPath(join(root, "scripts/solid-transform.js"), root)).toBe(false)
  })

  test("strips Babel transform packages from the shipping dependency set", () => {
    expect(
      withoutOpentuiBuildOnlyDependencies({
        "@ax-code/opentui-core": "workspace:*",
        "@babel/core": "7.29.6",
        "babel-preset-solid": "1.9.12",
        entities: "7.0.1",
        "s-js": "^0.4.9",
      }),
    ).toEqual({
      "@ax-code/opentui-core": "workspace:*",
      entities: "7.0.1",
      "s-js": "^0.4.9",
    })
  })
})
