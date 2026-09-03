import { readFile } from "node:fs/promises"
import path from "node:path"
import { describe, expect, test } from "vitest"

const repoRoot = path.resolve(import.meta.dirname, "../../../..")
const sdkBuildScript = path.join(repoRoot, "packages/sdk/js/script/build.ts")

describe("SDK build script", () => {
  test("avoids platform-specific .bin shims", async () => {
    const text = await readFile(sdkBuildScript, "utf-8")

    expect(text).toContain('packageBin("typescript", "tsc")')
    expect(text).toContain("process.execPath")
    expect(text).not.toContain("node_modules/.bin")
    expect(text).not.toContain('node_modules", ".bin"')
  })

  test("serializes shared generated outputs", async () => {
    const text = await readFile(sdkBuildScript, "utf-8")
    const lock = text.indexOf("const releaseBuildLock = await acquireBuildLock()")
    const tmp = text.indexOf('await fs.mkdir(path.join(tmp, "data")')
    const openapi = text.indexOf('toFile: path.join(dir, "openapi.json")')
    const client = text.indexOf('await generateClient("./src/gen")')
    const cleanup = text.indexOf("await releaseBuildLock()")

    expect(lock).toBeGreaterThan(-1)
    expect(tmp).toBeGreaterThan(lock)
    expect(openapi).toBeGreaterThan(lock)
    expect(client).toBeGreaterThan(lock)
    expect(cleanup).toBeGreaterThan(client)
  })
})
