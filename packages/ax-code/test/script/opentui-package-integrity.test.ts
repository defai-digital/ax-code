import { access, readFile } from "node:fs/promises"
import path from "node:path"
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

    expect(axCodePackage.devDependencies?.["@babel/core"]).toBeUndefined()
    expect(axCodePackage.devDependencies?.["@types/babel__core"]).toBeUndefined()
    expect(solidPackage.dependencies).toMatchObject({
      "@babel/core": expect.any(String),
      "@babel/preset-typescript": expect.any(String),
      "babel-plugin-module-resolver": expect.any(String),
      "babel-preset-solid": expect.any(String),
    })
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
        types: "./dist/solid.d.mts",
        default: "./dist/solid.mjs",
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
      expectFileExists("packages/opentui-spinner/dist/index.mjs"),
      expectFileExists("packages/opentui-spinner/dist/solid.mjs"),
      expectFileExists("packages/opentui-spinner/dist/solid.d.mts"),
    ])
  })
})
