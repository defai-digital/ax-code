import { access, readFile } from "node:fs/promises"
import { readdirSync } from "node:fs"
import path from "node:path"
import { spawnSync } from "node:child_process"
import { describe, expect, test } from "vitest"

const repoRoot = path.resolve(import.meta.dirname, "../../../../")

async function readJson(file: string) {
  return JSON.parse(await readFile(path.join(repoRoot, file), "utf8"))
}

async function expectFileExists(file: string) {
  await expect(access(path.join(repoRoot, file))).resolves.toBeUndefined()
}

describe("AX Code TUI package integrity", () => {
  test("the public Solid transform owns its production dependency closure", async () => {
    const axCodePackage = await readJson("packages/ax-code/package.json")
    const tuiPackage = await readJson("packages/ax-code-tui/package.json")

    // ax-code itself must not declare the Solid transform's Babel toolchain.
    expect(axCodePackage.devDependencies?.["@babel/core"]).toBeUndefined()
    expect(axCodePackage.devDependencies?.["@types/babel__core"]).toBeUndefined()

    const transformEntry = tuiPackage.exports["./solid/transform"].import as string
    const transformSource = await readFile(path.join(repoRoot, "packages/ax-code-tui", transformEntry), "utf8")

    // `./transform` is a public package subpath. Its direct imports must remain
    // installable for production consumers even though the precompiled AX Code
    // distribution excludes this entry and strips these dependencies itself.
    const babelDeps = ["@babel/core", "@babel/preset-typescript", "babel-plugin-module-resolver", "babel-preset-solid"]
    for (const dep of babelDeps) {
      expect(transformSource, `transform entry should import ${dep}`).toContain(`from "${dep}"`)
      expect(tuiPackage.dependencies?.[dep], `${dep} should be a production dependency`).toBeTypeOf("string")
      expect(tuiPackage.devDependencies?.[dep], `${dep} should not be dev-only`).toBeUndefined()
      expect(tuiPackage.peerDependencies?.[dep], `${dep} should not be a peer dependency`).toBeUndefined()
    }

    // Runtime entry points must stay free of Babel imports — the transform is
    // the only build-time consumer.
    const runtimeEntries = ["index.js", "index.bun.js", "components.js", "jsx-runtime.js"]
    for (const entry of runtimeEntries) {
      const text = await readFile(path.join(repoRoot, "packages/ax-code-tui/solid", entry), "utf8")
      expect(text, `${entry} must not import Babel`).not.toMatch(
        /@babel\/|babel-preset-solid|babel-plugin-module-resolver/,
      )
    }
  })

  test("package exports point at files shipped in the workspace", async () => {
    const tuiPackage = await readJson("packages/ax-code-tui/package.json")

    expect(tuiPackage.exports["./solid/transform"]).toMatchObject({
      types: "./solid/scripts/solid-transform.d.ts",
      import: "./solid/scripts/solid-transform.js",
    })
    expect(tuiPackage.exports["./solid/preload"]).toMatchObject({
      bun: "./solid/scripts/preload.js",
      node: "./solid/scripts/preload.node.js",
    })
    expect(tuiPackage.exports["./runtime-plugin"]).toMatchObject({
      bun: "./runtime-plugin.js",
      node: "./runtime-plugin.node.js",
    })
    expect(tuiPackage.exports["./runtime-plugin-support/configure"]).toMatchObject({
      bun: "./runtime-plugin-support-configure.js",
      node: "./runtime-plugin-support-configure.node.js",
    })
    expect(tuiPackage.exports["./spinner/solid"]).toMatchObject({
      import: {
        types: "./spinner/dist/solid.d.ts",
        default: "./spinner/dist/solid.js",
      },
    })
    expect(tuiPackage.exports["./solid/components"].require).toBeUndefined()

    await Promise.all([
      expectFileExists("packages/ax-code-tui/solid/scripts/solid-transform.js"),
      expectFileExists("packages/ax-code-tui/solid/scripts/solid-transform.d.ts"),
      expectFileExists("packages/ax-code-tui/solid/scripts/preload.js"),
      expectFileExists("packages/ax-code-tui/solid/scripts/preload.node.js"),
      expectFileExists("packages/ax-code-tui/runtime-plugin.js"),
      expectFileExists("packages/ax-code-tui/runtime-plugin.node.js"),
      expectFileExists("packages/ax-code-tui/runtime-plugin-support-configure.js"),
      expectFileExists("packages/ax-code-tui/runtime-plugin-support-configure.node.js"),
      expectFileExists("packages/ax-code-tui/spinner/dist/index.js"),
      expectFileExists("packages/ax-code-tui/spinner/dist/index.d.ts"),
      expectFileExists("packages/ax-code-tui/spinner/dist/solid.js"),
      expectFileExists("packages/ax-code-tui/spinner/dist/solid.d.ts"),
    ])
  })

  test("Node fallback modules are syntactically valid", () => {
    const directories = ["packages/ax-code-tui", "packages/ax-code-tui/solid/scripts"]
    const fallbackFiles = directories.flatMap((directory) =>
      readdirSync(path.join(repoRoot, directory))
        .filter((file) => file.endsWith(".node.js"))
        .map((file) => path.join(directory, file)),
    )

    expect(fallbackFiles.length).toBeGreaterThan(0)
    for (const file of fallbackFiles) {
      const result = spawnSync(process.execPath, ["--check", path.join(repoRoot, file)], { encoding: "utf8" })
      expect(result.status, `${file} must parse in Node.js:\n${result.stderr}`).toBe(0)
    }
  })

  test("the parser worker remains require-compatible", () => {
    const source = [
      'const { createRequire } = require("node:module")',
      'const { resolve } = require("node:path")',
      'const requireFromCore = createRequire(resolve("package.json"))',
      'requireFromCore("@ax-code/tui/parser.worker")',
    ].join(";")
    const result = spawnSync(process.execPath, ["-e", source], {
      cwd: path.join(repoRoot, "packages/ax-code"),
      encoding: "utf8",
    })

    expect(result.status, result.stderr).toBe(0)
  })
})
