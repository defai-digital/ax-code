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

describe("vendored OpenTUI package integrity", () => {
  test("ax-code does not own Babel transform dependencies directly", async () => {
    const axCodePackage = await readJson("packages/ax-code/package.json")
    const solidPackage = await readJson("packages/opentui-solid/package.json")

    // ax-code itself must not declare the Solid transform's Babel toolchain.
    expect(axCodePackage.devDependencies?.["@babel/core"]).toBeUndefined()
    expect(axCodePackage.devDependencies?.["@types/babel__core"]).toBeUndefined()

    // Babel is build-time only for opentui-solid (used solely by
    // scripts/solid-transform.js). It must live in devDependencies — never in
    // the runtime dependency set — so release installs don't pull it.
    const babelDeps = ["@babel/core", "@babel/preset-typescript", "babel-plugin-module-resolver", "babel-preset-solid"]
    for (const dep of babelDeps) {
      expect(solidPackage.devDependencies?.[dep], `${dep} should be a devDependency`).toBeTypeOf("string")
      expect(solidPackage.dependencies?.[dep], `${dep} should not be a runtime dependency`).toBeUndefined()
      expect(solidPackage.peerDependencies?.[dep], `${dep} should not be a peer dependency`).toBeUndefined()
    }

    // Runtime entry points must stay free of Babel imports — the transform is
    // the only build-time consumer.
    const runtimeEntries = ["index.js", "index.bun.js", "components.js", "jsx-runtime.js"]
    for (const entry of runtimeEntries) {
      const text = await readFile(path.join(repoRoot, "packages/opentui-solid", entry), "utf8")
      expect(text, `${entry} must not import Babel`).not.toMatch(
        /@babel\/|babel-preset-solid|babel-plugin-module-resolver/,
      )
    }
  })

  test("OpenTUI package exports point at files shipped in the workspace", async () => {
    const solidPackage = await readJson("packages/opentui-solid/package.json")
    const corePackage = await readJson("packages/opentui-core/package.json")
    const spinnerPackage = await readJson("packages/opentui-spinner/package.json")

    expect(solidPackage.exports["./transform"]).toMatchObject({
      types: "./scripts/solid-transform.d.ts",
      import: "./scripts/solid-transform.js",
    })
    expect(solidPackage.exports["./preload"]).toMatchObject({
      bun: "./scripts/preload.js",
      node: "./scripts/preload.node.js",
    })
    expect(corePackage.exports["./runtime-plugin"]).toMatchObject({
      bun: "./runtime-plugin.js",
      node: "./runtime-plugin.node.js",
    })
    expect(corePackage.exports["./runtime-plugin-support/configure"]).toMatchObject({
      bun: "./runtime-plugin-support-configure.js",
      node: "./runtime-plugin-support-configure.node.js",
    })
    expect(spinnerPackage.exports["./solid"]).toMatchObject({
      import: {
        types: "./dist/solid.d.ts",
        default: "./dist/solid.js",
      },
    })

    await Promise.all([
      expectFileExists("packages/opentui-solid/scripts/solid-transform.js"),
      expectFileExists("packages/opentui-solid/scripts/solid-transform.d.ts"),
      expectFileExists("packages/opentui-solid/scripts/preload.js"),
      expectFileExists("packages/opentui-solid/scripts/preload.node.js"),
      expectFileExists("packages/opentui-core/runtime-plugin.js"),
      expectFileExists("packages/opentui-core/runtime-plugin.node.js"),
      expectFileExists("packages/opentui-core/runtime-plugin-support-configure.js"),
      expectFileExists("packages/opentui-core/runtime-plugin-support-configure.node.js"),
      expectFileExists("packages/opentui-spinner/dist/index.js"),
      expectFileExists("packages/opentui-spinner/dist/index.d.ts"),
      expectFileExists("packages/opentui-spinner/dist/solid.js"),
      expectFileExists("packages/opentui-spinner/dist/solid.d.ts"),
    ])
  })

  test("OpenTUI Node fallback modules are syntactically valid", () => {
    const directories = ["packages/opentui-core", "packages/opentui-solid/scripts"]
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
})
