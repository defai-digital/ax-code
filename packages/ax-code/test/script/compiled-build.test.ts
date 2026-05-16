import { describe, expect, test } from "bun:test"
import fs from "fs/promises"
import path from "path"

const buildPath = path.resolve(import.meta.dir, "../../script/build.ts")
const compiledEntryPath = path.resolve(import.meta.dir, "../../src/index-compiled.ts")

describe("script.build compiled entrypoint", () => {
  test("keeps the source OpenTUI preload out of Bun compile entrypoints", async () => {
    const build = await fs.readFile(buildPath, "utf8")
    const compiledEntry = await fs.readFile(compiledEntryPath, "utf8")

    expect(build).toContain('"./src/index-compiled.ts"')
    expect(build).not.toContain('"./src/index.ts", parserWorker, workerPath')
    expect(compiledEntry).not.toContain("@opentui/solid/preload")
    expect(compiledEntry).toContain('from "./cli/boot"')
  })
})
