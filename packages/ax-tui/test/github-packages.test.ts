import { spawnSync } from "node:child_process"
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { expect, test } from "vitest"

const root = fileURLToPath(new URL("../", import.meta.url))

function run(command: string, args: string[], cwd = root) {
  const result = spawnSync(command, args, {
    cwd, encoding: "utf8", timeout: 45_000, maxBuffer: 8 * 1024 * 1024,
    shell: process.platform === "win32" && command === "npm.cmd",
    env: { ...process.env, AX_CODE_TUI_NATIVE_OFFLINE: "1" },
  })
  expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0)
  return result.stdout
}

test("packed public package supports scoped and legacy alias consumers with offline native rendering", async () => {
  await mkdir(path.join(root, ".internal"), { recursive: true })
  const fixture = await mkdtemp(path.join(root, ".internal/github-package-"))
  try {
    const npm = process.platform === "win32" ? "npm.cmd" : "npm"
    const [packed] = JSON.parse(run(npm, ["pack", "--json", "--ignore-scripts", "--pack-destination", fixture]))
    const files = packed.files.map((file: { path: string }) => file.path)
    expect(files).toContain("vendor/manifest.json")
    expect(files).not.toContain(".npmrc")
    expect(files.some((name: string) => /^(?:src|test|script|\.internal|\.github)\//.test(name))).toBe(false)
    run("tar", ["-xzf", path.join(fixture, packed.filename), "-C", fixture])
    const packageRoot = path.join(fixture, "package")
    const manifest = JSON.parse(await readFile(path.join(packageRoot, "package.json"), "utf8"))
    expect(manifest.name).toBe("@defai-digital/ax-tui")
    expect(manifest.publishConfig).toEqual({ registry: "https://npm.pkg.github.com", access: "public" })
    const consumer = path.join(fixture, "consumer")
    await mkdir(path.join(consumer, "node_modules/@defai-digital"), { recursive: true })
    await writeFile(path.join(consumer, "package.json"), JSON.stringify({ private: true, type: "module" }))
    await symlink(packageRoot, path.join(consumer, "node_modules/@defai-digital/ax-tui"), "junction")
    await writeFile(path.join(consumer, "smoke.mjs"), `
import assert from "node:assert/strict"
import { existsSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
globalThis.fetch = async () => { throw new Error("Package smoke test attempted a network request") }
const packageName = process.argv[2]
const scoped = await import(packageName)
const { SpinnerRenderable } = await import(packageName + "/spinner")
const { ChartRenderable } = await import(packageName + "/chart")
assert.ok(SpinnerRenderable.prototype instanceof scoped.Renderable)
assert.ok(ChartRenderable.prototype instanceof scoped.Renderable)
await import(packageName + "/spinner/solid")
await import(packageName + "/chart/solid")
assert.ok((await import(packageName + "/solid")).testRender)
const { transformSolidSource } = await import(packageName + "/solid/transform")
assert.ok((await transformSolidSource("const view = <text>Hello</text>", { filename: "view.tsx", moduleName: packageName + "/solid" })).includes(packageName + "/solid"))
const { prepareNativeLibrary } = await import(packageName + "/native")
const target = process.platform + "-" + process.arch
const native = await prepareNativeLibrary(target, { offline: true })
assert.ok(native.libraryPath.includes(path.join("vendor", target)))
assert.ok(existsSync(native.licensePath))
const { createTestRenderer } = await import(packageName + "/testing")
const setup = await createTestRenderer({ width: 40, height: 4 })
try {
  setup.renderer.root.add(new scoped.TextRenderable(setup.renderer, { content: "Public package works offline" }))
  await setup.renderOnce()
  assert.ok(setup.captureCharFrame().includes("Public package works offline"))
} finally {
  setup.renderer.destroy()
}
const manifest = JSON.parse(await (await import("node:fs/promises")).readFile(new URL("../package/package.json", import.meta.url)))
for (const subpath of Object.keys(manifest.exports)) {
  const specifier = packageName + (subpath === "." ? "" : subpath.slice(1))
  const resolved = fileURLToPath(import.meta.resolve(specifier))
  assert.ok(resolved.startsWith(fileURLToPath(new URL("../package/", import.meta.url))), specifier)
  assert.ok(existsSync(resolved), specifier)
}
console.log("Scoped imports, legacy alias, all exports, widgets, Solid transform, and offline native rendering passed")
`)
    expect(run(process.execPath, ["--experimental-ffi", "smoke.mjs", "@defai-digital/ax-tui"], consumer))
      .toContain("offline native rendering passed")
    await rm(path.join(consumer, "node_modules/@defai-digital/ax-tui"), { recursive: true, force: true })
    await symlink(packageRoot, path.join(consumer, "node_modules/ax-tui"), "junction")
    expect(run(process.execPath, ["--experimental-ffi", "smoke.mjs", "ax-tui"], consumer))
      .toContain("offline native rendering passed")
  } finally {
    await rm(fixture, { recursive: true, force: true })
  }
}, 60_000)

test("scoped Bun runtime imports preserve existing module identities and register aliases once", () => {
  const source = `
import assert from "node:assert/strict"
import { createRuntimePlugin, runtimeModuleIdForSpecifier, isCoreRuntimeModuleSpecifier } from "./src/runtime-plugin.ts"
for (const subpath of ["", "/testing", "/solid"]) {
  assert.equal(runtimeModuleIdForSpecifier("@defai-digital/ax-tui" + subpath), runtimeModuleIdForSpecifier("ax-tui" + subpath))
}
assert.equal(runtimeModuleIdForSpecifier("@defai-digital/ax-tui-other"), "ax-code-tui:runtime-module:%40defai-digital%2Fax-tui-other")
for (const specifier of ["ax-tui", "ax-tui/testing", "@defai-digital/ax-tui", "@defai-digital/ax-tui/testing"]) {
  assert.ok(isCoreRuntimeModuleSpecifier(specifier))
}
const ids = new Set()
const resolutions = []
const core = { identity: "core" }
createRuntimePlugin({ core }).setup({
  module(id, loader) { assert.ok(!ids.has(id), "Duplicate virtual runtime module"); ids.add(id) },
  onResolve(options, callback) { resolutions.push([options.filter, callback]) },
  onLoad() {},
})
assert.equal(ids.size, 2)
for (const specifier of ["ax-tui", "@defai-digital/ax-tui"]) {
  const [filter, callback] = resolutions.find(([filter]) => filter.source !== ".*" && filter.test(specifier))
  assert.equal(callback({ path: specifier }).path, "ax-code-tui:runtime-module:ax-tui")
}
console.log("Runtime identity aliases passed")
`
  expect(run(process.execPath, ["--experimental-ffi", "--import", "tsx/esm", "--input-type=module", "-e", source]))
    .toContain("Runtime identity aliases passed")
})
