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
  })
  expect(empty.size).toBe(0)
  const unlisted = await WikiInventory.build(tmp.path, ["src/a.ts"], {
    maxSources: 0,
    perFileBytes: 262144,
    totalBytes: 8388608,
    symbolsPerSource: 100,
  })
  expect(unlisted.size).toBe(0)
})

test("caps symbols per source deterministically", async () => {
  await using tmp = await tmpdir()
  await mkdir(path.join(tmp.path, "src"))
  const body = Array.from({ length: 10 }, (_, i) => `export const v${i} = ${i}\n`).join("")
  await writeFile(path.join(tmp.path, "src", "many.ts"), body)
  const limits = { maxSources: 200, perFileBytes: 262144, totalBytes: 8388608, symbolsPerSource: 3 }
  const inventory = await WikiInventory.build(tmp.path, ["src/many.ts"], limits)
  const symbols = inventory.get("src/many.ts")!
  expect(symbols).toHaveLength(3)
  expect(symbols.every((symbol) => symbol.name.startsWith("v"))).toBe(true)
  const again = await WikiInventory.build(tmp.path, ["src/many.ts"], limits)
  expect(again.get("src/many.ts")).toEqual(symbols)
})
