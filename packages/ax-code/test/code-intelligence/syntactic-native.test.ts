import { afterEach, describe, expect, test, vi } from "vitest"
import { NativeAddon } from "../../src/native/addon"
import { SyntacticExtractor } from "../../src/code-intelligence/syntactic"
import { parseJsonResult } from "../../src/util/json-value"
import { tmpdir } from "../fixture/fixture"
import { Instance } from "../../src/project/instance"

afterEach(() => vi.restoreAllMocks())

const parser = NativeAddon.parser()
const workers =
  parser?.extractInventoryAsync && parser.ParserCancellation && parser.parseBatchAsync ? parser : undefined

const fixtures = [
  {
    lang: "typescript",
    source: [
      'import type { A } from "./a"',
      'export * as other from "./other"',
      "export abstract class Account<T> {",
      "  balance = 0; deposit(amount: number) { return amount }",
      "  onClose = () => 1; [Symbol.iterator]() { return this }",
      "}",
      "export interface Ledger { entries: number[] }",
      "enum Currency { USD, EUR }; type Entry = { amount: number }",
      "namespace Bank { export namespace Office { export function open() {} } }",
      "declare module 'external' { export function declared(x: number): void }",
      "const one = 1, compute = (n: number) => n, fn = function(x: string) { return x }",
      "let pending = 0; var old = 1; function* generate() { yield 1 }",
      'async function load() { return import("./lazy") }',
      'const required = require("./required")',
    ].join("\n"),
  },
  {
    lang: "typescriptreact",
    source:
      "export function App({title}: {title: string}) { return <main>{title}</main> }\nconst Other = () => <App title='x'/>",
  },
  {
    lang: "javascript",
    source:
      "/* \u{1f600} \u0301 */ const caf\u00e9 = (x) => x;\r\nclass Queue { #value = 1; push(x){} onClose = () => 1 }\r\nexport function* gen() {}\r\nconst a=require('./a'); import('./b')",
  },
  {
    lang: "javascriptreact",
    source: "export const App = ({title}) => <main title={title}>test</main>; export { other } from './other'",
  },
  { lang: "typescript", source: "export function incomplete( {\n const nested = 1\n" },
  { lang: "typescript", source: `function long(${"parameter: number, ".repeat(20)}last: number) {}` },
  {
    lang: "javascript",
    source: "function ignored() { function local(){}; const inside=1 }; if (true) { const skipped=1 }",
  },
  {
    lang: "typescript",
    source: "// \u{1f600}\n\tfunction \u03b1(x: string) { return x }; const after = '\u{1f600}'; function last() {}\n",
  },
]

describe.skipIf(!workers)("source-built native syntax inventory", () => {
  for (const [index, fixture] of fixtures.entries()) {
    test(`matches WASM symbols and imports for ${fixture.lang} fixture ${index}`, async () => {
      vi.spyOn(NativeAddon, "parser").mockReturnValue(undefined)
      const expected = await SyntacticExtractor.extractInventory(fixture.lang, fixture.source)
      vi.restoreAllMocks()
      const raw = await workers!.extractInventoryAsync!(
        fixture.source,
        fixture.lang,
        new workers!.ParserCancellation!(),
      )
      const parsed = parseJsonResult(raw)
      expect(parsed.ok).toBe(true)
      if (!parsed.ok) throw parsed.error
      expect(parsed.value).toMatchObject(expected)
      expect(await SyntacticExtractor.extractInventory(fixture.lang, fixture.source)).toEqual(expected)
    })
  }

  test("caps symbols and imports before returning and preserves selected order", async () => {
    const source = Array.from({ length: 2300 }, (_, i) => `export function f${i}(){}; import './m${i}'`).join("\n")
    const result = await SyntacticExtractor.extractInventory("typescript", source)
    expect(result.symbols).toHaveLength(2000)
    expect(result.imports).toHaveLength(256)
    expect(result.symbols?.at(-1)?.name).toBe("f1999")
    expect(result.imports?.at(-1)?.specifier).toBe("./m255")
  })

  test("batch failures remain per file and concurrency preserves input order", async () => {
    const files = [
      { path: "b.ts", language: "typescript", content: "export function second(){}" },
      { path: "bad.unknown", language: "unknown", content: "?" },
      { path: "a.ts", language: "typescript", content: "export function first(){}" },
    ]
    for (const concurrency of [1, 4]) {
      const raw = await workers!.parseBatchAsync!(
        JSON.stringify(files),
        concurrency,
        new workers!.ParserCancellation!(),
      )
      const parsed = parseJsonResult(raw)
      expect(parsed.ok).toBe(true)
      if (!parsed.ok) throw parsed.error
      expect(parsed.value).toMatchObject([
        { path: "b.ts", inventory: { symbols: [{ name: "second" }] }, error: null },
        { path: "bad.unknown", inventory: null, error: "unsupported language: unknown" },
        { path: "a.ts", inventory: { symbols: [{ name: "first" }] }, error: null },
      ])
    }
    await expect(workers!.parseBatchAsync!("[]", 0, new workers!.ParserCancellation!())).rejects.toThrow(
      "Invalid parser batch limits",
    )
  })

  test("abort cancels admitted work and cannot return a partial success", async () => {
    const controller = new AbortController()
    const source = Array.from({ length: 10000 }, (_, i) => `function f${i}(x) { return x }`).join("\n")
    const run = SyntacticExtractor.extractInventory("javascript", source, controller.signal)
    controller.abort()
    await expect(run).rejects.toMatchObject({ name: "AbortError" })
    const cancelled = new workers!.ParserCancellation!()
    cancelled.cancel()
    await expect(workers!.extractInventoryAsync!(source, "javascript", cancelled)).rejects.toThrow("cancelled")
  })
})

test("an invalid native import section retains native symbols and falls back only for imports", async () => {
  const native = {
    ...parser!,
    hasGrammar: () => true,
    ParserCancellation: class {
      cancel() {}
    },
    extractInventoryAsync: vi.fn(async () =>
      JSON.stringify({
        symbols: [
          {
            kind: "function",
            name: "keep",
            qualified: "keep",
            startLine: 0,
            startChar: 0,
            endLine: 0,
            endChar: 18,
            signature: "()",
          },
        ],
        imports: "invalid",
      }),
    ),
  }
  vi.spyOn(NativeAddon, "parser").mockReturnValue(native)
  const result = await SyntacticExtractor.extractInventory("typescript", "function keep() {}\nimport './a'")
  expect(result.symbols?.[0]?.name).toBe("keep")
  expect(result.imports).toEqual([{ specifier: "./a", line: 1 }])
  expect(native.extractInventoryAsync).toHaveBeenCalledTimes(1)
})

test("old and missing addons retain WASM symbols and imports", async () => {
  for (const native of [
    undefined,
    {
      hasGrammar: () => true,
      extractSymbols: () => "[]",
      parseBatch: () => "[]",
      supportedLanguages: () => ["typescript"],
    },
  ]) {
    vi.spyOn(NativeAddon, "parser").mockReturnValue(native)
    const result = await SyntacticExtractor.extractInventory(
      "typescript",
      "export function keep(x: number){}\nimport './a'",
    )
    expect(result.symbols?.[0]?.signature).toBe("(x: number)")
    expect(result.imports).toEqual([{ specifier: "./a", line: 1 }])
    vi.restoreAllMocks()
  }
})

test("combined extraction populates separate caches and aborted work cannot publish them", async () => {
  await using tmp = await tmpdir({ git: true })
  const controller = new AbortController()
  const native = {
    ...parser!,
    hasGrammar: () => true,
    ParserCancellation: class {
      cancel() {}
    },
    extractInventoryAsync: vi.fn(async () =>
      JSON.stringify({
        symbols: [
          {
            kind: "function",
            name: "cached",
            qualified: "cached",
            startLine: 0,
            startChar: 0,
            endLine: 0,
            endChar: 19,
            signature: "()",
          },
        ],
        imports: [{ specifier: "./a", line: 1 }],
      }),
    ),
  }
  vi.spyOn(NativeAddon, "parser").mockReturnValue(native)
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const source = "function cached(){}\nimport './a'"
      const result = await SyntacticExtractor.extractInventory("typescript", source)
      expect(await SyntacticExtractor.extract("typescript", source)).toEqual(result.symbols)
      expect(await SyntacticExtractor.extractImports("typescript", source)).toEqual(result.imports)
      expect(native.extractInventoryAsync).toHaveBeenCalledTimes(1)
      controller.abort()
      await expect(SyntacticExtractor.extractInventory("typescript", source, controller.signal)).rejects.toMatchObject({
        name: "AbortError",
      })
    },
  })
})

test("ill-formed UTF-16 retains the WASM projection without native string conversion", async () => {
  const source = "declare module '\ud800' { export function value(): void }"
  const spy = vi.spyOn(NativeAddon, "parser")
  spy.mockReturnValue(undefined)
  const expected = await SyntacticExtractor.extractInventory("typescript", source)
  if (!workers) return
  const call = vi.fn(workers.extractInventoryAsync)
  spy.mockReturnValue({ ...workers, extractInventoryAsync: call })
  expect(await SyntacticExtractor.extractInventory("typescript", source)).toEqual(expected)
  expect(call).not.toHaveBeenCalled()
})
