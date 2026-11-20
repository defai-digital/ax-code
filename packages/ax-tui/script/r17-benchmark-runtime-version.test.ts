import { spawnSync } from "node:child_process"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, test } from "vitest"

const runtimeScript = fileURLToPath(new URL("../script/benchmark-runtime.ts", import.meta.url))

// The version manifest must be found even when the package entry lives in a
// subdirectory (`dist/index.js`). A child process keeps the real Node resolver
// (`import.meta.resolve`) in play, which the in-process Vitest runner shims.
async function makeFixture(entryRelative: string) {
  const root = await mkdtemp(path.join(os.tmpdir(), "ax-tui-r17-bench-version-"))
  const parentDir = path.join(root, "parent")
  const packageDir = path.join(parentDir, "node_modules", "bench-fixture")
  await mkdir(path.join(packageDir, "dist"), { recursive: true })
  await writeFile(path.join(parentDir, "package.json"), "{}")
  await writeFile(
    path.join(packageDir, "package.json"),
    JSON.stringify({
      name: "bench-fixture",
      version: "9.9.9",
      type: "module",
      exports: { ".": `./${entryRelative}`, "./testing": "./dist/testing.js" },
    }),
  )
  const entryPath = path.join(packageDir, entryRelative)
  await mkdir(path.dirname(entryPath), { recursive: true })
  await writeFile(entryPath, "export class TextRenderable {}\n")
  await writeFile(
    path.join(packageDir, "dist", "testing.js"),
    'export async function createTestRenderer() { throw new Error("SENTINEL_VERSION_RESOLVED") }\n',
  )
  return { root, parentDir }
}

function runBenchmark(parentDir: string) {
  const code = `
import { benchmarkRuntime } from ${JSON.stringify(runtimeScript)}
try {
  await benchmarkRuntime(${JSON.stringify(parentDir)}, "bench-fixture")
  console.log("NO-ERROR")
} catch (error) {
  console.log("ERR:" + error.message)
}
`
  const result = spawnSync(process.execPath, ["--experimental-import-meta-resolve", "--input-type=module", "-e", code], {
    encoding: "utf8",
    timeout: 20_000,
  })
  return { stdout: result.stdout ?? "", stderr: result.stderr ?? "", status: result.status }
}

describe("benchmarkRuntime resolves the package version from subdirectory entries", () => {
  test(
    "dist/index.js entry finds the version above it and reaches the renderer",
    async () => {
      const { root, parentDir } = await makeFixture(path.join("dist", "index.js"))
      try {
        const { stdout, stderr, status } = runBenchmark(parentDir)
        expect(status, stderr).toBe(0)
        expect(stdout).toContain("ERR:SENTINEL_VERSION_RESOLVED")
        expect(stdout).not.toContain("ENOENT")
      } finally {
        await rm(root, { recursive: true, force: true })
      }
    },
    30_000,
  )

  test(
    "root index.js entry still resolves its sibling manifest",
    async () => {
      const { root, parentDir } = await makeFixture("index.js")
      try {
        const { stdout, stderr, status } = runBenchmark(parentDir)
        expect(status, stderr).toBe(0)
        expect(stdout).toContain("ERR:SENTINEL_VERSION_RESOLVED")
      } finally {
        await rm(root, { recursive: true, force: true })
      }
    },
    30_000,
  )
})
