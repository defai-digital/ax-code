import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
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

// fileURLToPath("file://example.com/...") only throws on POSIX; on Windows it
// is a valid UNC path, so the crash this guards against is POSIX-only.
const posixDescribe = process.platform === "win32" ? describe.skip : describe

posixDescribe("runtime plugin must tolerate non-local file: URLs", () => {
  test("a file: URL with a remote host resolves to nothing instead of throwing", () => {
    const { wildcard } = setupPlugin()
    let result: unknown
    expect(() => {
      result = wildcard.cb({ path: "file://example.com/a.js", importer: "" })
    }).not.toThrow()
    expect(result).toBeUndefined()
  })

  test("a node_modules file mentioning a remote file: URL in a comment does not crash the scan", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "ax-tui-r18-plugin-fileurl-"))
    try {
      const packageDir = path.join(root, "node_modules", "pkg")
      await mkdir(packageDir, { recursive: true })
      await writeFile(path.join(packageDir, "package.json"), JSON.stringify({ name: "pkg", type: "module" }))
      const index = path.join(packageDir, "index.js")
      await writeFile(index, `// example: import("file://example.com/a.js")\nexport const x = 1\n`)

      const { wildcard } = setupPlugin()
      expect(() => wildcard.cb({ path: index, importer: "" })).not.toThrow()
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})
