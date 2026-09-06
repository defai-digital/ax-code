import { createRequire } from "node:module"
import { existsSync } from "node:fs"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import path from "node:path"
import { describe, expect, test } from "vitest"
import { copyTuiDistPackage, shouldCopyTuiDistPath, toTuiDistPackageJson } from "../../script/tui-dist"
import { tmpdir } from "../fixture/fixture"

const developmentFiles = [
  "AGENTS.md",
  "jsr.json",
  "pnpm-lock.yaml",
  "pnpm-workspace.yaml",
  "tsconfig.json",
  "vitest.config.ts",
  "script/vendor-tui-native.ts",
  "test/package-integrity.test.ts",
  "tests/yoga/fixture.js",
  "patches/native.md",
  "spinner/src/index.ts",
  "spinner/tsconfig.build.json",
  "chart/src/index.ts",
  "chart/tsconfig.json",
  ".internal/reports/notes.md",
  "node_modules/solid-js/package.json",
  "solid/scripts/solid-transform.js",
  "index.d.ts",
]

const runtimeFiles = [
  "LICENSE",
  "index.js",
  "index-renderer.js",
  "parser.worker.js",
  "native/index.js",
  "native/resolve.js",
  "runtime-plugin.node.js",
  "yoga.js",
  "solid/index.js",
  "solid/jsx-runtime.js",
  "solid/LICENSE",
  "spinner/dist/index.js",
  "spinner/LICENSE",
  "chart/dist/index.js",
  "vendor/manifest.json",
  "vendor/darwin-arm64/libopentui.dylib",
  "vendor/darwin-arm64/LICENSE",
  "assets/markdown/tree-sitter-markdown.wasm",
  "assets/markdown/highlights.scm",
]

describe("script.tui-dist", () => {
  test.each(["ax-tui", "@jsr/defai-digital__ax-tui"])(
    "stages %s under the application's import alias without repository-only files",
    async (packageName) => {
      await using tmp = await tmpdir()
      const source = path.join(tmp.path, "installed")
      const distribution = path.join(tmp.path, "dist")
      const manifest = {
        name: packageName,
        version: "0.1.0",
        type: "module",
        scripts: { build: "tsc" },
        devDependencies: { typescript: "5.9.3" },
        dependencies: { "@babel/core": "7.29.6", entities: "7.0.1" },
        exports: {
          ".": { types: "./index.d.ts", default: "./index.js" },
          "./solid": { default: "./solid/index.js" },
          "./spinner": { default: "./spinner/dist/index.js" },
          "./solid/transform": { default: "./solid/scripts/solid-transform.js" },
        },
      }
      for (const file of ["package.json", ...runtimeFiles, ...developmentFiles]) {
        const target = path.join(source, file)
        await mkdir(path.dirname(target), { recursive: true })
        await writeFile(target, file === "package.json" ? JSON.stringify(manifest) : `fixture: ${file}\n`)
      }

      const target = copyTuiDistPackage(source, path.join(distribution, "node_modules"))
      const fromBundle = createRequire(path.join(distribution, "lib/index-node-tui.js"))
      expect(fromBundle.resolve("ax-tui")).toBe(path.join(target, "index.js"))
      expect(fromBundle.resolve("ax-tui/solid")).toBe(path.join(target, "solid/index.js"))
      expect(fromBundle.resolve("ax-tui/spinner")).toBe(path.join(target, "spinner/dist/index.js"))
      expect(existsSync(path.join(distribution, "node_modules/@ax-code/tui"))).toBe(false)

      for (const file of runtimeFiles) {
        expect(await readFile(path.join(target, file), "utf8")).toBe(`fixture: ${file}\n`)
      }
      for (const file of developmentFiles) {
        expect(existsSync(path.join(target, file)), `${file} must not ship`).toBe(false)
      }

      const result = toTuiDistPackageJson(
        manifest,
        (file) => existsSync(path.join(target, file)),
        () => "1.0.0",
      )
      expect(result.exports).toEqual({
        ".": { default: "./index.js" },
        "./solid": { default: "./solid/index.js" },
        "./spinner": { default: "./spinner/dist/index.js" },
      })
      expect(result.dependencies).toEqual({ entities: "7.0.1" })
      expect(result).not.toHaveProperty("scripts")
      expect(result).not.toHaveProperty("devDependencies")
      expect(manifest).toHaveProperty("scripts")
    },
  )

  test.each(developmentFiles)("excludes %s from the consumer distribution", (file) => {
    const root = path.resolve("fixture/ax-tui")
    expect(shouldCopyTuiDistPath(path.join(root, file), root)).toBe(false)
  })

  test.each(runtimeFiles)("keeps runtime asset %s", (file) => {
    const root = path.resolve("fixture/ax-tui")
    expect(shouldCopyTuiDistPath(path.join(root, file), root)).toBe(true)
  })
})
