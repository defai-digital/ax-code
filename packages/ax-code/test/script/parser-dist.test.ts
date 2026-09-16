import { createRequire } from "node:module"
import { spawnSync } from "node:child_process"
import fs from "node:fs/promises"
import path from "node:path"
import { expect, test } from "vitest"
import { pruneParserDistribution } from "../../script/parser-dist"
import { tmpdir } from "../fixture/fixture"

test("pruned real packages retain ESM/CJS runtime and all four grammar assets", async () => {
  await using tmp = await tmpdir()
  const modules = path.join(tmp.path, "node_modules")
  const require = createRequire(import.meta.url)
  for (const name of ["tree-sitter-bash", "tree-sitter-javascript", "tree-sitter-typescript", "web-tree-sitter"]) {
    const source = path.dirname(require.resolve(name === "web-tree-sitter" ? name : `${name}/package.json`))
    await fs.cp(source, path.join(modules, name), { recursive: true, dereference: true })
  }
  pruneParserDistribution(modules)
  pruneParserDistribution(modules) // Idempotent staging.
  const script = path.join(tmp.path, "smoke.mjs")
  await fs.writeFile(
    script,
    `
    import { Parser, Language } from 'web-tree-sitter'
    import { createRequire } from 'node:module'
    const require = createRequire(import.meta.url)
    if (typeof require('web-tree-sitter').Parser !== 'function') throw new Error('CJS runtime missing')
    await Parser.init({ locateFile: () => require.resolve('web-tree-sitter/tree-sitter.wasm') })
    for (const [asset, code] of [
      ['tree-sitter-bash/tree-sitter-bash.wasm', 'echo "hello" && pwd'],
      ['tree-sitter-javascript/tree-sitter-javascript.wasm', 'function hello() { return 1; }'],
      ['tree-sitter-typescript/tree-sitter-typescript.wasm', 'const value: number = 1;'],
      ['tree-sitter-typescript/tree-sitter-tsx.wasm', 'const node = <div>Hello</div>;'],
    ]) {
      const parser = new Parser()
      parser.setLanguage(await Language.load(require.resolve(asset)))
      const tree = parser.parse(code)
      if (!tree || tree.rootNode.hasError) throw new Error('Grammar failed: ' + asset)
      tree.delete(); parser.delete()
    }
    console.log('all grammars passed')
  `,
  )
  const result = spawnSync(process.execPath, [script], { encoding: "utf8", timeout: 30_000 })
  expect(result.stderr).toBe("")
  expect(result.status).toBe(0)
  expect(result.stdout).toContain("all grammars passed")
  for (const name of await fs.readdir(modules)) {
    const files = await fs.readdir(path.join(modules, name))
    expect(files.some((file) => file.endsWith(".wasm"))).toBe(true)
    expect(files).not.toContain("prebuilds")
    expect(files).not.toContain("src")
    expect(files).not.toContain("node_modules")
    const manifest = JSON.parse(await fs.readFile(path.join(modules, name, "package.json"), "utf8"))
    expect(manifest.dependencies).toBeUndefined()
    expect(manifest.scripts).toBeUndefined()
  }
  await fs.writeFile(path.join(modules, "tree-sitter-bash", "unused.c"), "fixture")
  await fs.unlink(path.join(modules, "tree-sitter-typescript", "tree-sitter-tsx.wasm"))
  expect(() => pruneParserDistribution(modules)).toThrow()
  expect(await fs.readFile(path.join(modules, "tree-sitter-bash", "unused.c"), "utf8")).toBe("fixture")
}, 30_000)
