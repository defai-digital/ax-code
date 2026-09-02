import { afterEach, describe, expect, test } from "vitest"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { createRequire } from "node:module"

const require = createRequire(import.meta.url)
const { verifyRuntimeManifest } = require("../../../../script/runtime-manifest.cjs")
const { PLACEHOLDER_SCHEMA, prepareRuntimeIntegrityBinding } = require("./prepare-runtime-integrity.cjs")
const tempDirs = []

afterEach(() => {
  for (const directory of tempDirs.splice(0)) fs.rmSync(directory, { recursive: true, force: true })
})

function makeTree({ runtime = true } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ax-runtime-binding-"))
  tempDirs.push(root)
  const runtimeRoot = path.join(root, "runtime")
  const outputPath = path.join(root, "dist", "ax-code-runtime-manifest.json")
  fs.mkdirSync(runtimeRoot, { recursive: true })
  if (runtime) {
    fs.mkdirSync(path.join(runtimeRoot, "bin"), { recursive: true })
    fs.mkdirSync(path.join(runtimeRoot, "lib"), { recursive: true })
    fs.writeFileSync(path.join(runtimeRoot, "bin", "ax-code"), "#!/bin/sh\n")
    fs.writeFileSync(path.join(runtimeRoot, "lib", "index-node-tui.js"), "runtime\n")
    fs.writeFileSync(path.join(runtimeRoot, "package.json"), "{}\n")
  }
  return { outputPath, runtimeRoot }
}

describe("desktop runtime integrity binding", () => {
  test("creates and embeds a manifest for local runtimes", () => {
    const paths = makeTree()
    const result = prepareRuntimeIntegrityBinding({ ...paths, env: {} })

    expect(result.status).toBe("bound")
    expect(verifyRuntimeManifest(paths.runtimeRoot).files.length).toBeGreaterThan(0)
    expect(fs.readFileSync(paths.outputPath, "utf8")).toBe(
      fs.readFileSync(path.join(paths.runtimeRoot, "runtime-manifest.json"), "utf8"),
    )
  })

  test("fails closed in release mode when the authenticated manifest is absent", () => {
    const paths = makeTree()
    expect(() => prepareRuntimeIntegrityBinding({ ...paths, env: { AX_CODE_STAGE_REQUIRED: "true" } })).toThrow(
      "Staged ax-code runtime is missing runtime-manifest.json",
    )
  })

  test("writes a non-runnable marker for placeholder builds", () => {
    const paths = makeTree({ runtime: false })
    const result = prepareRuntimeIntegrityBinding({ ...paths, env: {} })

    expect(result.status).toBe("placeholder")
    expect(JSON.parse(fs.readFileSync(paths.outputPath, "utf8")).schema).toBe(PLACEHOLDER_SCHEMA)
  })
})
