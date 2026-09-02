import { existsSync, readFileSync } from "node:fs"
import { resolve } from "node:path"
import { describe, expect, test } from "vitest"
import { SDK_VERSION } from "../src/version"

type PackageManifest = {
  name: string
  version: string
  private?: boolean
  scripts: Record<string, string>
  exports: Record<string, string>
  dependencies: Record<string, string>
}

type JsrManifest = {
  name: string
  version: string
  exports: Record<string, string>
  publish: { include: string[] }
}

const packageRoot = resolve(import.meta.dirname, "..")
const packageJson = JSON.parse(readFileSync(resolve(packageRoot, "package.json"), "utf8")) as PackageManifest
const jsrJson = JSON.parse(readFileSync(resolve(packageRoot, "jsr.json"), "utf8")) as JsrManifest

describe("JSR package contract", () => {
  test("uses the DEFAI Digital public identity with one SDK version", () => {
    expect(packageJson.name).toBe("@ax-code/sdk")
    expect(packageJson.private).toBe(true)
    expect(jsrJson.name).toBe("@defai-digital/ax-code-sdk")
    expect(jsrJson.version).toBe(packageJson.version)
    expect(jsrJson.version).toBe(SDK_VERSION)
  })

  test("publishes every workspace module export with generated declarations", () => {
    expect(jsrJson.exports).toEqual(packageJson.exports)
    expect(
      Object.values(jsrJson.exports).every((target) => target.startsWith("./dist/") && target.endsWith(".js")),
    ).toBe(true)
    expect(Object.keys(jsrJson.exports)).not.toContain("./proto/ax_code/v1/headless.proto")
    expect(JSON.stringify(jsrJson.exports)).not.toContain("computer")
  })

  test("publishes only the reviewed build and package assets", () => {
    expect(jsrJson.publish.include).toEqual([
      "dist",
      "README.md",
      "ARCHITECTURE.md",
      "LICENSE",
      "package.json",
      "jsr.json",
    ])
  })

  test("declares every runtime dependency and has no npm publisher", () => {
    expect(packageJson.dependencies).toEqual({
      "@msgpack/msgpack": "3.1.3",
      zod: "catalog:",
    })
    expect(packageJson.scripts["check:jsr"]).toContain("--dry-run")
    expect(packageJson.scripts["publish:jsr"]).toContain("jsr-publish.ts")
    expect(JSON.stringify(packageJson.scripts)).not.toMatch(/npm (?:pack|publish)/)
    expect(existsSync(resolve(packageRoot, "script/publish.ts"))).toBe(false)
  })
})
