import { spawnSync } from "node:child_process"
import { cp, mkdtemp, mkdir, readdir, rm, symlink, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { expect, test } from "vitest"

const root = fileURLToPath(new URL("../", import.meta.url))
const supportsFfi = spawnSync(process.execPath, ["--experimental-ffi", "-e", "require('node:ffi')"]).status === 0

test.skipIf(!supportsFfi)(
  "renders from a native-free package using only its verified cache",
  async () => {
    const fixture = await mkdtemp(path.join(os.tmpdir(), "ax-tui-renderer-cache-"))
    try {
      const packageRoot = path.join(fixture, "package")
      await mkdir(path.join(packageRoot, "vendor"), { recursive: true })
      await mkdir(path.join(packageRoot, "native"))
      const files = (await readdir(root)).filter((file) => /^index(?:-.*)?\.js$/.test(file))
      for (const file of [
        ...files,
        "testing.js",
        "native/index.js",
        "native/resolve.js",
        "native/types.js",
        "assets",
        "package.json",
        "vendor/manifest.json",
      ]) {
        await cp(path.join(root, file), path.join(packageRoot, file), { recursive: true })
      }
      await symlink(path.join(root, "node_modules"), path.join(packageRoot, "node_modules"), "junction")
      const driver = path.join(packageRoot, "cache-renderer.mjs")
      await writeFile(
        driver,
        `
import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import path from "node:path"
import { prepareNativeLibrary } from "./native/index.js"
const target = process.platform + "-" + process.arch
const original = process.argv[2]
let requests = 0
globalThis.fetch = async (url) => {
  assert.ok(url.startsWith("https://github.com/defai-digital/ax-tui/releases/download/"))
  const filename = path.basename(url).slice(("ax-tui-native-" + target + "-").length)
  assert.ok(["LICENSE", "libaxtui.dylib", "libaxtui.so", "axtui.dll"].includes(filename))
  requests++
  return new Response(await readFile(path.join(original, "vendor", target, filename)))
}
await prepareNativeLibrary(target)
assert.equal(requests, 2)
globalThis.fetch = async () => { throw new Error("Unexpected network access") }
process.env.AX_CODE_TUI_NATIVE_OFFLINE = "1"
const { createTestRenderer } = await import("./testing.js")
const { TextRenderable } = await import("./index.js")
const setup = await createTestRenderer({ width: 32, height: 4 })
try {
  setup.renderer.root.add(new TextRenderable(setup.renderer, { content: "Native cache ready" }))
  await setup.renderOnce()
  assert.ok(setup.captureCharFrame().includes("Native cache ready"))
} finally {
  setup.renderer.destroy()
}
console.log("Verified cache renderer passed")
`,
      )
      const result = spawnSync(
        process.execPath,
        ["--experimental-ffi", "--disable-warning=ExperimentalWarning", driver, root],
        {
          cwd: packageRoot,
          encoding: "utf8",
          timeout: 20_000,
          env: {
            ...process.env,
            AX_CODE_TUI_NATIVE_CACHE_DIR: path.join(fixture, "cache"),
            AX_CODE_TUI_NATIVE_OFFLINE: "0",
          },
        },
      )
      expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0)
      expect(result.stdout).toContain("Verified cache renderer passed")
    } finally {
      await rm(fixture, { recursive: true, force: true })
    }
  },
  30_000,
)
