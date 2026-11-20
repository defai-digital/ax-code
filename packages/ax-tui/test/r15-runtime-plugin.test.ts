import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from "node:fs/promises"
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

async function makePackage(root: string, name: string, source: string): Promise<string> {
  const dir = path.join(root, "node_modules", name)
  await mkdir(dir, { recursive: true })
  await writeFile(path.join(dir, "package.json"), JSON.stringify({ name, type: "module" }))
  const indexPath = path.join(dir, "index.js")
  await writeFile(indexPath, source)
  return realpath(indexPath)
}

describe("runtime plugin must detect minified runtime imports in node_modules", () => {
  test("minified side-effect import registers a rewrite loader", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "ax-tui-r15-plugin-"))
    try {
      const indexPath = await makePackage(root, "minpkg", `import"ax-tui";export const x=1\n`)
      const { loads, wildcard } = setupPlugin()
      wildcard.cb({ path: indexPath, importer: "" })
      expect(loads.some((entry) => entry.filter.test(indexPath))).toBe(true)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  test("minified export-from registers a rewrite loader", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "ax-tui-r15-plugin-"))
    try {
      const indexPath = await makePackage(root, "starpkg", `export*from"ax-tui"\n`)
      const { loads, wildcard } = setupPlugin()
      wildcard.cb({ path: indexPath, importer: "" })
      expect(loads.some((entry) => entry.filter.test(indexPath))).toBe(true)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  test("spaced imports still register a rewrite loader", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "ax-tui-r15-plugin-"))
    try {
      const indexPath = await makePackage(root, "spacedpkg", `import { foo } from "ax-tui"\nexport const x = foo\n`)
      const { loads, wildcard } = setupPlugin()
      wildcard.cb({ path: indexPath, importer: "" })
      expect(loads.some((entry) => entry.filter.test(indexPath))).toBe(true)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  test("identifiers containing from/import do not trigger a rewrite loader", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "ax-tui-r15-plugin-"))
    try {
      const indexPath = await makePackage(root, "plainpkg", `const platform="x";export const y=platform\n`)
      const { loads, wildcard } = setupPlugin()
      wildcard.cb({ path: indexPath, importer: "" })
      expect(loads.some((entry) => entry.filter.test(indexPath))).toBe(false)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})

describe("runtime plugin path normalization must not leak across setups", () => {
  test("a fresh setup sees a retargeted symlink's new realpath", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "ax-tui-r15-plugin-"))
    try {
      const aPath = path.join(root, "a.js")
      const bPath = path.join(root, "b.js")
      const linkPath = path.join(root, "link.js")
      await writeFile(aPath, "export const a = 1\n")
      await writeFile(bPath, "export const b = 1\n")
      await symlink(aPath, linkPath)
      const realA = await realpath(aPath)
      const realB = await realpath(bPath)

      const first = setupPlugin()
      first.wildcard.cb({ path: linkPath, importer: "" })
      const firstFilter = first.loads[first.loads.length - 1]?.filter
      expect(firstFilter?.test(realA)).toBe(true)

      await rm(linkPath)
      await symlink(bPath, linkPath)

      const second = setupPlugin()
      second.wildcard.cb({ path: linkPath, importer: "" })
      const secondFilter = second.loads[second.loads.length - 1]?.filter
      expect(secondFilter?.test(realB)).toBe(true)
      expect(secondFilter?.test(realA)).toBe(false)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})
