import { execFileSync } from "node:child_process"
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { pathToFileURL } from "node:url"
import { expect, test } from "vitest"

test.each([true, false])("preloads the renderer before Bun compatibility with ESM-only root: %s", async (esmOnly) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "ax-solid-loader-"))
  try {
    const core = path.join(root, "packages/ax-code")
    const renderer = path.join(core, "node_modules/ax-tui")
    const solid = path.join(core, "node_modules/solid-js")
    const files: Record<string, string> = {
      "script/solid-loader.mjs": await readFile(new URL("./solid-loader.mjs", import.meta.url), "utf8"),
      "packages/ax-code/package.json": JSON.stringify({ type: "module" }),
      "packages/ax-code/src/bun/node-compat.ts": "export function installNodeBunCompat() { globalThis.Bun = {} }",
    }
    files[path.relative(root, path.join(renderer, "package.json"))] = JSON.stringify({
      name: "@defai-digital/ax-tui",
      type: "module",
      exports: {
        ".": esmOnly ? { import: "./index.js" } : { default: "./index.js" },
        "./solid": { import: "./solid.js", default: "./solid.js" },
      },
    })
    files[path.relative(root, path.join(renderer, "index.js"))] = "globalThis.rendererSawBun = Boolean(globalThis.Bun)"
    files[path.relative(root, path.join(renderer, "solid.js"))] = 'import "./index.js"'
    for (const entry of ["dist/solid.js", "store/dist/store.js", "web/dist/web.js"])
      files[path.relative(root, path.join(solid, entry))] = "export {}"
    for (const [name, content] of Object.entries(files)) {
      const target = path.join(root, name)
      await mkdir(path.dirname(target), { recursive: true })
      await writeFile(target, content)
    }
    const env = { ...process.env }
    delete env.NODE_OPTIONS
    const output = execFileSync(
      process.execPath,
      [
        "--import",
        pathToFileURL(path.join(root, "script/solid-loader.mjs")).href,
        "--input-type=module",
        "--eval",
        "await import(process.argv[1]); console.log(JSON.stringify({ rendererSawBun: globalThis.rendererSawBun, compatInstalled: Boolean(globalThis.Bun) }))",
        pathToFileURL(path.join(renderer, "index.js")).href,
      ],
      { env, encoding: "utf8", timeout: 15_000 },
    )
    expect(JSON.parse(output)).toEqual({ rendererSawBun: false, compatInstalled: true })
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
