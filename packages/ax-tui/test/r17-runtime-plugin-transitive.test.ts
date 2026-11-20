import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { describe, expect, test } from "vitest"
import { createRuntimePlugin } from "../src/runtime-plugin.js"

type ResolveEntry = { filter: RegExp; cb: (args: { path: string; importer: string }) => unknown }

function setupPlugin() {
  const loads: { filter: RegExp }[] = []
  const resolves: ResolveEntry[] = []
  createRuntimePlugin({ core: {} as never }).setup({
    module() {},
    onResolve(options: { filter: RegExp }, cb: ResolveEntry["cb"]) {
      resolves.push({ filter: options.filter, cb })
    },
    onLoad(options: { filter: RegExp }) {
      loads.push({ filter: options.filter })
    },
  } as never)
  const wildcard = resolves.find((entry) => entry.filter.source === ".*")
  if (!wildcard) throw new Error("wildcard onResolve not registered")
  return { loads, wildcard }
}

describe("runtime plugin prescan follows transitive imports from a plain-path parent", () => {
  test("a dependency that imports ax-tui gets a rewrite loader even when its parent does not", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "ax-tui-r17-plugin-transitive-"))
    try {
      const packageDir = path.join(root, "node_modules", "pkg")
      await mkdir(packageDir, { recursive: true })
      await writeFile(path.join(packageDir, "package.json"), JSON.stringify({ name: "pkg", type: "module" }))
      const index = path.join(packageDir, "index.js")
      const dep = path.join(packageDir, "dep.js")
      await writeFile(index, 'import "./dep.js"\nexport const x = 1\n')
      await writeFile(dep, 'import "ax-tui"\nexport const y = 2\n')

      const { loads, wildcard } = setupPlugin()
      wildcard.cb({ path: index, importer: "" })

      // The prescan discovers the dependency through its canonical realpath, so the
      // rewrite loader is registered for that spelling (Bun canonicalizes before onLoad).
      const canonicalDep = await realpath(dep)
      expect(loads.some((entry) => entry.filter.test(canonicalDep))).toBe(true)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})
