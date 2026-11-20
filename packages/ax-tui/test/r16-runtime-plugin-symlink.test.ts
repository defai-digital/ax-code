import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises"
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

describe("runtime plugin rewrite loaders must cover symlink spellings", () => {
  test("pnpm-style symlinked package index gets a loader for the link spelling", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "ax-tui-r16-plugin-"))
    try {
      const realDir = path.join(root, "node_modules", ".pnpm", "pkg@1.0.0", "node_modules", "pkg")
      await mkdir(realDir, { recursive: true })
      await writeFile(path.join(realDir, "package.json"), JSON.stringify({ name: "pkg", type: "module" }))
      const realIndex = path.join(realDir, "index.js")
      await writeFile(realIndex, `import"ax-tui";export const x=1\n`)
      const linkDir = path.join(root, "node_modules", "pkg")
      await mkdir(linkDir, { recursive: true })
      const linkIndex = path.join(linkDir, "index.js")
      await symlink(realIndex, linkIndex)

      const { loads, wildcard } = setupPlugin()
      wildcard.cb({ path: linkIndex, importer: "" })

      expect(loads.some((entry) => entry.filter.test(linkIndex))).toBe(true)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  test("a second symlink alias of an already-registered file still gets coverage", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "ax-tui-r16-plugin-"))
    try {
      const target = path.join(root, "a.js")
      await writeFile(target, `import "ax-tui"\n`)
      const linkA = path.join(root, "linkA.js")
      const linkB = path.join(root, "linkB.js")
      await symlink(target, linkA)
      await symlink(target, linkB)

      const { loads, wildcard } = setupPlugin()
      wildcard.cb({ path: linkA, importer: "" })
      wildcard.cb({ path: linkB, importer: "" })

      expect(loads.some((entry) => entry.filter.test(linkB))).toBe(true)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})
