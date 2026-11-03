import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { createHash } from "node:crypto"
import { access, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"

const packageRoot = fileURLToPath(new URL("../", import.meta.url))
const require = createRequire(import.meta.url)
const pnpm = process.env.npm_execpath
if (!pnpm?.includes("pnpm")) throw new Error("Run this check through pnpm run test:tarball")
// These are repository-owned build configuration, not consumer-supplied data.
const manifest = JSON.parse(await readFile(path.join(packageRoot, "package.json"), "utf8"))
const compilerManifestPath = require.resolve("@typescript/native/package.json")
const compilerManifest = JSON.parse(await readFile(compilerManifestPath, "utf8"))
const compiler = path.resolve(path.dirname(compilerManifestPath), compilerManifest.bin.tsc)
const temporary = await mkdtemp(path.join(tmpdir(), "ax-diff-tarball-"))
const environment = { ...process.env, NODE_PATH: "", NODE_OPTIONS: "" }
const run = (args, cwd, env = environment) =>
  execFileSync(process.execPath, args, { cwd, env, stdio: "inherit", timeout: 120_000 })

try {
  const artifacts = path.join(temporary, "artifacts")
  const consumer = path.join(temporary, "consumer")
  await mkdir(artifacts)
  await mkdir(consumer)
  await writeFile(path.join(consumer, "package.json"), '{"private":true,"type":"module"}\n')
  const config = path.join(temporary, "npmrc")
  await writeFile(config, "registry=https://registry.invalid/\n", { mode: 0o600 })
  environment.NPM_CONFIG_USERCONFIG = config
  run([pnpm, "pack", "--pack-destination", artifacts], packageRoot)
  const archives = (await readdir(artifacts)).filter((name) => name.endsWith(".tgz"))
  assert.equal(archives.length, 1)
  const archive = path.join(artifacts, archives[0])
  const offlineFlags = [
    "--offline",
    "--ignore-scripts",
    "--ignore-pnpmfile",
    "--store-dir",
    path.join(temporary, "store"),
    "--cache-dir",
    path.join(temporary, "cache"),
    "--registry",
    "https://registry.invalid/",
  ]
  // A fresh store plus offline admission proves installation does not rely on
  // workspace links, cached registry dependencies, credentials or build hooks.
  run([pnpm, "add", archive, ...offlineFlags], consumer)
  run([pnpm, "install", "--frozen-lockfile", ...offlineFlags], consumer)
  const installedRoot = path.join(consumer, "node_modules", manifest.name)
  const installed = JSON.parse(await readFile(path.join(installedRoot, "package.json"), "utf8"))
  assert.equal(installed.name, manifest.name)
  assert.equal(installed.version, manifest.version)
  assert.deepEqual(installed.dependencies ?? {}, {})
  assert.deepEqual(installed.optionalDependencies ?? {}, {})
  assert.deepEqual(installed.peerDependencies ?? {}, {})
  for (const asset of [
    "LICENSE",
    "NOTICE",
    "dist/browser.js",
    "dist/browser-worker.js",
    "dist/node.js",
    "dist/node-worker.js",
    "dist/browser.d.ts",
    "dist/node.d.ts",
    "wasm/ax_code_diff_wasm.js",
    "wasm/ax_code_diff_wasm_bg.wasm",
  ])
    await access(path.join(installedRoot, asset))
  await writeFile(
    path.join(consumer, "smoke.mjs"),
    `
import assert from "node:assert/strict"
import { createDiffEngine } from "${manifest.name}/node"
import { createDiffEngine as createBrowserEngine } from "${manifest.name}"
assert.equal(typeof createBrowserEngine, "function")
const engine = createDiffEngine()
try {
  for (const [before, after] of [["", "中文😀"], ["a\\r\\nb", "a\\r\\nc\\r\\n"], ["a\\n", "a"], ["a", ""]]) {
    const preview = await engine.diff(before, after)
    assert.equal(preview.version, 1)
    assert.equal(await engine.applyHunks(before, preview.hunks), after)
  }
  assert.equal(await engine.applyPatch("a.txt", "a\\n", [{ old_lines: ["a"], new_lines: ["b"] }]), "b\\n")
  assert.deepEqual(await engine.compare([["a"], ["a"]], 1), [{ indices: [0, 1], score: 1 }])
  const preview = await engine.diff("before\\n", "after\\n")
  await assert.rejects(engine.applyHunks("stale\\n", preview.hunks))
  const controller = new AbortController()
  controller.abort()
  await assert.rejects(engine.diff("a", "b", { signal: controller.signal }), { name: "AbortError" })
  assert.equal((await engine.diff("a", "b")).additions, 1)
} finally {
  await engine.close()
}
await assert.rejects(engine.diff("a", "b"), /closed/)
console.log("Installed tarball Node worker and both public exports passed")
`,
  )
  run([path.join(consumer, "smoke.mjs")], consumer)
  await writeFile(
    path.join(consumer, "consumer.ts"),
    `
import { createDiffEngine, type DiffEngine, type DiffPreview, type Hunk, type PatchChunk } from "${manifest.name}"
import { createDiffEngine as createNodeEngine } from "${manifest.name}/node"
async function contracts(engine: DiffEngine) {
  const preview: DiffPreview = await engine.diff("before", "after", { signal: new AbortController().signal, timeoutMs: 1000 })
  const hunks: Hunk[] = preview.hunks
  const patched: string = await engine.applyHunks("before", hunks)
  const chunks: PatchChunk[] = [{ old_lines: ["before"], new_lines: ["after"] }]
  await engine.applyPatch("file.txt", patched, chunks)
  await engine.close()
  // @ts-expect-error Hunk application requires a structured hunk array.
  await engine.applyHunks("before", "invalid")
}
void contracts; void createDiffEngine; void createNodeEngine
`,
  )
  await writeFile(
    path.join(consumer, "tsconfig.json"),
    JSON.stringify({
      compilerOptions: {
        strict: true,
        noEmit: true,
        module: "NodeNext",
        moduleResolution: "NodeNext",
        target: "ES2022",
        lib: ["ES2022", "DOM"],
        types: [],
        skipLibCheck: false,
      },
      files: ["consumer.ts"],
    }),
  )
  run([compiler, "--project", path.join(consumer, "tsconfig.json")], consumer)
  if (process.argv.includes("--browser")) {
    run([path.join(packageRoot, "script/browser-smoke.mjs")], consumer, {
      ...environment,
      AX_DIFF_WASM_PACKAGE_ROOT: installedRoot,
    })
  }
  console.log(
    JSON.stringify(
      {
        name: manifest.name,
        version: manifest.version,
        offlineInstall: true,
        frozenInstall: true,
        declarations: true,
        browser: process.argv.includes("--browser"),
        sha256: createHash("sha256")
          .update(await readFile(archive))
          .digest("hex"),
      },
      null,
      2,
    ),
  )
} finally {
  await rm(temporary, { recursive: true, force: true })
}
