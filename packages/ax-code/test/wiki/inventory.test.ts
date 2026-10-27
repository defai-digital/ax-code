import { expect, test } from "vitest"
import { mkdir, writeFile } from "node:fs/promises"
import path from "node:path"
import { tmpdir } from "../fixture/fixture"
import { WikiInventory } from "../../src/wiki/inventory"

test("maps extensions to supported extractor languages", () => {
  expect(WikiInventory.languageFor("src/a.ts")).toBe("typescript")
  expect(WikiInventory.languageFor("src/a.tsx")).toBe("typescriptreact")
  expect(WikiInventory.languageFor("src/a.js")).toBe("javascript")
  expect(WikiInventory.languageFor("run.sh")).toBe("shellscript")
  expect(WikiInventory.languageFor("notes.zzzunknown")).toBeUndefined()
  expect(WikiInventory.languageFor("noext")).toBeUndefined()
})

test("extracts class and method symbols from TypeScript sources", async () => {
  await using tmp = await tmpdir()
  await mkdir(path.join(tmp.path, "src"))
  await writeFile(path.join(tmp.path, "src", "a.ts"), "export class Foo {\n  bar() {\n    return 1\n  }\n}\n")
  const inventory = await WikiInventory.build(tmp.path, ["src/a.ts"])
  const symbols = inventory.get("src/a.ts")!
  const byName = new Map(symbols.map((symbol) => [symbol.name, symbol]))
  expect(byName.get("Foo")?.kind).toBe("class")
  expect(byName.get("bar")?.kind).toBe("method")
  expect(byName.get("bar")?.qualified).toContain("Foo")
  expect(byName.get("bar")?.qualified).toContain("bar")
})

test("skips unsupported, missing, and over-budget sources without failing", async () => {
  await using tmp = await tmpdir()
  await mkdir(path.join(tmp.path, "src"))
  await writeFile(path.join(tmp.path, "src", "a.ts"), "export const a = 1\n")
  await writeFile(path.join(tmp.path, "src", "notes.zzzunknown"), "x\n")
  const inventory = await WikiInventory.build(tmp.path, ["src/a.ts", "src/notes.zzzunknown", "src/missing.ts"])
  expect([...inventory.keys()]).toEqual(["src/a.ts"])
  const empty = await WikiInventory.build(tmp.path, ["src/a.ts"], {
    maxSources: 200,
    perFileBytes: 262144,
    totalBytes: 0,
    symbolsPerSource: 100,
    importsPerSource: 100,
  })
  expect(empty.size).toBe(0)
  const unlisted = await WikiInventory.build(tmp.path, ["src/a.ts"], {
    maxSources: 0,
    perFileBytes: 262144,
    totalBytes: 8388608,
    symbolsPerSource: 100,
    importsPerSource: 100,
  })
  expect(unlisted.size).toBe(0)
})

test("caps symbols per source deterministically", async () => {
  await using tmp = await tmpdir()
  await mkdir(path.join(tmp.path, "src"))
  const body = Array.from({ length: 10 }, (_, i) => `export const v${i} = ${i}\n`).join("")
  await writeFile(path.join(tmp.path, "src", "many.ts"), body)
  const limits = {
    maxSources: 200,
    perFileBytes: 262144,
    totalBytes: 8388608,
    symbolsPerSource: 3,
    importsPerSource: 100,
  }
  const inventory = await WikiInventory.build(tmp.path, ["src/many.ts"], limits)
  const symbols = inventory.get("src/many.ts")!
  expect(symbols).toHaveLength(3)
  expect(symbols.every((symbol) => symbol.name.startsWith("v"))).toBe(true)
  const again = await WikiInventory.build(tmp.path, ["src/many.ts"], limits)
  expect(again.get("src/many.ts")).toEqual(symbols)
})

test("resolves relative imports against the cited set without I/O", () => {
  const cited = new Set(["src/a.ts", "src/b.ts", "src/dir/index.ts", "src/exact.js"])
  expect(WikiInventory.resolveImport("src/a.ts", "./b", cited)).toBe("src/b.ts")
  expect(WikiInventory.resolveImport("src/a.ts", "./b.ts", cited)).toBe("src/b.ts")
  expect(WikiInventory.resolveImport("src/a.ts", "./dir", cited)).toBe("src/dir/index.ts")
  expect(WikiInventory.resolveImport("src/a.ts", "./exact.js", cited)).toBe("src/exact.js")
  expect(WikiInventory.resolveImport("src/dir/index.ts", "../b", cited)).toBe("src/b.ts")
  // TypeScript extension swap: source written with a .js suffix lives in .ts.
  const swapped = new Set(["src/a.ts", "src/b.ts"])
  expect(WikiInventory.resolveImport("src/a.ts", "./b.js", swapped)).toBe("src/b.ts")
  // Bare, absolute, escaping, and unlisted targets never resolve.
  expect(WikiInventory.resolveImport("src/a.ts", "bare-package", cited)).toBeUndefined()
  expect(WikiInventory.resolveImport("src/a.ts", "/abs.ts", cited)).toBeUndefined()
  expect(WikiInventory.resolveImport("a.ts", "../outside", cited)).toBeUndefined()
  expect(WikiInventory.resolveImport("src/a.ts", "./missing", cited)).toBeUndefined()
  expect(WikiInventory.resolveImport("src/a.ts", "./b.ts?x=1", cited)).toBeUndefined()
})

test("extracts destructuring leaves instead of pattern source text", async () => {
  await using tmp = await tmpdir()
  await mkdir(path.join(tmp.path, "src"))
  await writeFile(
    path.join(tmp.path, "src", "a.ts"),
    'export const {\n  alpha,\n  beta: b,\n  ...rest\n} = require("./dep")\nconst [a, , [c]] = y\nconst ok = 1, {\n  mixed,\n} = obj\n',
  )
  const symbols = (await WikiInventory.build(tmp.path, ["src/a.ts"])).get("src/a.ts")!
  expect(symbols.map((symbol) => symbol.name)).toEqual(["alpha", "b", "rest", "a", "c", "ok", "mixed"])
  expect(symbols.every((symbol) => symbol.kind === "constant")).toBe(true)
  expect(symbols.every((symbol) => !/[{[\u0000-\u001f]/.test(symbol.name))).toBe(true)
})

test("buildAll collects symbols and resolved imports in one pass", async () => {
  await using tmp = await tmpdir()
  await mkdir(path.join(tmp.path, "src"))
  await writeFile(
    path.join(tmp.path, "src", "a.ts"),
    `import { b } from "./b"\nimport "bare-package"\nimport "./missing"\nexport const a = b\n`,
  )
  await writeFile(path.join(tmp.path, "src", "b.ts"), "export const b = 1\n")
  const inventory = await WikiInventory.buildAll(tmp.path, ["src/a.ts", "src/b.ts"])
  expect(inventory.get("src/a.ts")?.imports).toEqual(["src/b.ts"])
  expect(inventory.get("src/a.ts")?.symbols.map((symbol) => symbol.name)).toContain("a")
  expect(inventory.get("src/b.ts")?.imports).toEqual([])
  // Bare and unlisted specifiers produce no edge and no failure.
  const again = await WikiInventory.buildAll(tmp.path, ["src/a.ts", "src/b.ts"])
  expect(again.get("src/a.ts")).toEqual(inventory.get("src/a.ts"))
})

test("inventory observations distinguish unsupported and unreadable sources from a successfully empty scan", async () => {
  const states = new Map<string, { status: string; omittedImports: number; unresolvedImports: number }>()
  const reads: string[] = []
  await WikiInventory.buildAll(
    "/fixture",
    ["empty.ts", "missing.ts", "notes.zzzunknown", "imports.ts", "target.ts"],
    { maxSources: 5, totalBytes: 1000, perFileBytes: 1000, importsPerSource: 0, symbolsPerSource: 0 },
    undefined,
    {
      readFile: async (_root, path) => {
        reads.push(path)
        if (path === "empty.ts" || path === "target.ts") return ""
        if (path === "imports.ts") return 'import "./target"\nimport "missing-package"'
        return undefined
      },
      onSource: (path, status) => states.set(path, status),
    },
  )
  expect(states.get("empty.ts")?.status).toBe("analyzed")
  expect(states.get("missing.ts")?.status).toBe("unavailable")
  expect(states.get("notes.zzzunknown")?.status).toBe("unsupported")
  expect(reads).not.toContain("notes.zzzunknown")
  expect(states.get("imports.ts")).toEqual({ status: "analyzed", omittedImports: 1, unresolvedImports: 1 })
})

test("buildAll skips self imports and caps imports per source", async () => {
  await using tmp = await tmpdir()
  await mkdir(path.join(tmp.path, "src"))
  const lines = [`import "./self"`, ...Array.from({ length: 5 }, (_, i) => `import "./m${i}"`), "export const x = 1\n"]
  await writeFile(path.join(tmp.path, "src", "self.ts"), lines.join("\n"))
  for (let i = 0; i < 5; i++) await writeFile(path.join(tmp.path, "src", `m${i}.ts`), "export const v = 1\n")
  const cited = ["src/self.ts", "src/m0.ts", "src/m1.ts", "src/m2.ts", "src/m3.ts", "src/m4.ts"]
  const inventory = await WikiInventory.buildAll(tmp.path, cited, {
    maxSources: 200,
    perFileBytes: 262144,
    totalBytes: 8388608,
    symbolsPerSource: 100,
    importsPerSource: 2,
  })
  // Self import dropped, remainder sorted and capped deterministically.
  expect(inventory.get("src/self.ts")?.imports).toEqual(["src/m0.ts", "src/m1.ts"])
})

test("resolves tsconfig path aliases from the nearest config without guessing", () => {
  const cited = new Set(["pkg/src/session/index.ts", "pkg/src/tool/bash.ts", "pkg/lib/util.ts"])
  const aliases = WikiInventory.parsePathAliases(
    "pkg",
    JSON.stringify({
      compilerOptions: { paths: { "@/*": ["./src/*"], "@tui/*": ["./src/cli/tui/*"], "#lib": ["./lib/util.ts"] } },
    }),
  )!
  expect(aliases.rules.map((rule) => rule.prefix)).toEqual(["@tui/", "#lib", "@/"])
  expect(WikiInventory.resolveImport("pkg/src/a.ts", "@/session", cited, aliases)).toBe("pkg/src/session/index.ts")
  expect(WikiInventory.resolveImport("pkg/src/a.ts", "@/tool/bash.js", cited, aliases)).toBe("pkg/src/tool/bash.ts")
  expect(WikiInventory.resolveImport("pkg/src/a.ts", "#lib", cited, aliases)).toBe("pkg/lib/util.ts")
  // Longest prefix wins and an unresolved match never falls back to a shorter rule.
  expect(WikiInventory.resolveImport("pkg/src/a.ts", "@tui/app", cited, aliases)).toBeUndefined()
  expect(WikiInventory.resolveImport("pkg/src/a.ts", "@/missing", cited, aliases)).toBeUndefined()
  expect(WikiInventory.resolveImport("pkg/src/a.ts", "zod", cited, aliases)).toBeUndefined()
  expect(WikiInventory.resolveImport("pkg/src/a.ts", "@/session", cited)).toBeUndefined()
  // Escaping targets and comment-bearing configs are ignored.
  expect(
    WikiInventory.parsePathAliases("", JSON.stringify({ compilerOptions: { paths: { "x/*": ["../out/*"] } } })),
  ).toBeUndefined()
  expect(WikiInventory.parsePathAliases("pkg", '{ // comment\n "compilerOptions": {} }')).toBeUndefined()
})

test("buildAll links aliased imports between cited files", async () => {
  await using tmp = await tmpdir()
  await mkdir(path.join(tmp.path, "pkg", "src", "session"), { recursive: true })
  await writeFile(
    path.join(tmp.path, "pkg", "tsconfig.json"),
    JSON.stringify({ compilerOptions: { paths: { "@/*": ["./src/*"] } } }),
  )
  await writeFile(path.join(tmp.path, "pkg", "src", "a.ts"), 'import { s } from "@/session/s"\nexport const a = s\n')
  await writeFile(path.join(tmp.path, "pkg", "src", "session", "s.ts"), "export const s = 1\n")
  const all = await WikiInventory.buildAll(tmp.path, ["pkg/src/a.ts", "pkg/src/session/s.ts"])
  expect(all.get("pkg/src/a.ts")?.imports).toEqual(["pkg/src/session/s.ts"])
})
