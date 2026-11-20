import { spawnSync } from "node:child_process"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { describe, expect, test } from "vitest"

const runtimeScript = new URL("../script/benchmark-runtime.ts", import.meta.url).href

// A `dist/esm/package.json` containing only `{"type":"module"}` is an ESM
// marker, not a version manifest. The version lookup must skip it and keep
// walking up to the real package.json. A child process keeps the real Node
// resolver (`import.meta.resolve`) in play, which Vitest shims in-process.
async function makeFixture(marker: Record<string, unknown>) {
  const root = await mkdtemp(path.join(os.tmpdir(), "ax-tui-r18-bench-marker-"))
  const parentDir = path.join(root, "parent")
  const packageDir = path.join(parentDir, "node_modules", "bench-fixture")
  await mkdir(path.join(packageDir, "dist", "esm"), { recursive: true })
  await writeFile(path.join(parentDir, "package.json"), "{}")
  await writeFile(
    path.join(packageDir, "package.json"),
    JSON.stringify({
      name: "bench-fixture",
      version: "9.9.9",
      type: "module",
      exports: { ".": "./dist/esm/index.js", "./testing": "./dist/testing.js" },
    }),
  )
  await writeFile(path.join(packageDir, "dist", "esm", "index.js"), "export class TextRenderable {}\n")
  await writeFile(path.join(packageDir, "dist", "esm", "package.json"), JSON.stringify(marker))
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

describe("benchmarkRuntime skips ESM marker manifests when resolving the version", () => {
  test(
    "a type-only dist/esm/package.json is skipped and the real version is found",
    async () => {
      const { root, parentDir } = await makeFixture({ type: "module" })
      try {
        const { stdout, stderr, status } = runBenchmark(parentDir)
        expect(status, stderr).toBe(0)
        expect(stdout).toContain("ERR:SENTINEL_VERSION_RESOLVED")
        expect(stdout).not.toContain("has no string version")
      } finally {
        await rm(root, { recursive: true, force: true })
      }
    },
    30_000,
  )

  test(
    "a manifest with a non-string version still fails loudly",
    async () => {
      const { root, parentDir } = await makeFixture({ version: 42 })
      try {
        const { stdout, stderr, status } = runBenchmark(parentDir)
        expect(status, stderr).toBe(0)
        expect(stdout).toContain("has no string version")
      } finally {
        await rm(root, { recursive: true, force: true })
      }
    },
    30_000,
  )

  test(
    "a name-only manifest is not treated as an ESM marker",
    async () => {
      const { root, parentDir } = await makeFixture({ name: "only-name" })
      try {
        const { stdout, stderr, status } = runBenchmark(parentDir)
        expect(status, stderr).toBe(0)
        expect(stdout).toContain("has no string version")
      } finally {
        await rm(root, { recursive: true, force: true })
      }
    },
    30_000,
  )
})
