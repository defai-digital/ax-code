import { describe, expect, test, vi } from "vitest"
import { writeFile } from "node:fs/promises"
import path from "path"
import { tmpdir } from "../fixture/fixture"
import { Instance } from "../../src/project/instance"
import { Log } from "../../src/util/log"
import { CodeIntelligence } from "../../src/code-intelligence"
import { CodeGraphQuery } from "../../src/code-intelligence/query"
import { CodeGraphBuilder } from "../../src/code-intelligence/builder"
import { SyntacticExtractor } from "../../src/code-intelligence/syntactic"
import { LSP } from "../../src/lsp"

Log.init({ print: false })

// The code_file.completeness domain always documented a tree-sitter tier
// ("partial" = indexed via tree-sitter, symbols only) that the builder
// never implemented — files without a healthy semantic LSP contributed
// nothing to the graph. SyntacticExtractor completes that design. These
// tests parse real grammar .wasm packages (web-tree-sitter, no native
// FFI), so they run everywhere the backend runs.

describe("SyntacticExtractor.extract", () => {
  test("extracts TypeScript declarations with kinds and qualified names", async () => {
    const source = [
      "export class Account {",
      "  balance = 0",
      "  deposit(amount: number) { this.balance += amount }",
      "  onClose = () => this.balance",
      "}",
      "export interface Ledger { entries: number[] }",
      "enum Currency { USD, EUR }",
      "type Entry = { amount: number }",
      "namespace Bank {",
      "  export function open(): Account { return new Account() }",
      "}",
      "export function transfer(from: Account, to: Account) {}",
      "const fee = 3",
      "let pending = 0",
      "const compute = (x: number) => x * 2",
      "",
    ].join("\n")

    const symbols = await SyntacticExtractor.extract("typescript", source)
    expect(symbols).toBeDefined()
    const byQualified = new Map(symbols!.map((s) => [s.qualified, s]))

    expect(byQualified.get("Account")?.kind).toBe("class")
    expect(byQualified.get("Account::deposit")?.kind).toBe("method")
    expect(byQualified.get("Account::deposit")?.signature).toBe("(amount: number)")
    expect(byQualified.get("Account::onClose")?.kind).toBe("method")
    expect(byQualified.get("Account::balance")?.kind).toBe("variable")
    expect(byQualified.get("Ledger")?.kind).toBe("interface")
    expect(byQualified.get("Currency")?.kind).toBe("enum")
    expect(byQualified.get("Entry")?.kind).toBe("type")
    expect(byQualified.get("Bank")?.kind).toBe("module")
    expect(byQualified.get("Bank::open")?.kind).toBe("function")
    expect(byQualified.get("transfer")?.kind).toBe("function")
    expect(byQualified.get("fee")?.kind).toBe("constant")
    expect(byQualified.get("pending")?.kind).toBe("variable")
    expect(byQualified.get("compute")?.kind).toBe("function")

    const transfer = byQualified.get("transfer")!
    expect(transfer.startLine).toBe(11)
    expect(transfer.endLine).toBe(11)
  })

  test("parses TSX through the tsx grammar", async () => {
    const symbols = await SyntacticExtractor.extract(
      "typescriptreact",
      "export function App({ title }: { title: string }) { return <main data-x={1}>{title}</main> }\n",
    )
    expect(symbols?.map((s) => `${s.kind}:${s.qualified}`)).toContain("function:App")
  })

  test("extracts JavaScript classes, methods, and arrow constants", async () => {
    const symbols = await SyntacticExtractor.extract(
      "javascript",
      ["class Queue {", "  push(x) {}", "}", "function drain() {}", "const peek = () => 1", ""].join("\n"),
    )
    const kinds = new Map(symbols!.map((s) => [s.qualified, s.kind]))
    expect(kinds.get("Queue")).toBe("class")
    expect(kinds.get("Queue::push")).toBe("method")
    expect(kinds.get("drain")).toBe("function")
    expect(kinds.get("peek")).toBe("function")
  })

  test("extracts bash functions, including inside compound statements", async () => {
    const symbols = await SyntacticExtractor.extract(
      "shellscript",
      ["setup() { true; }", "function teardown { true; }", "if true; then", "  nested() { true; }", "fi", ""].join(
        "\n",
      ),
    )
    const names = symbols!.map((s) => s.name)
    expect(names).toContain("setup")
    expect(names).toContain("teardown")
    expect(names).toContain("nested")
    expect(symbols!.every((s) => s.kind === "function")).toBe(true)
  })

  test("declines unsupported languages and oversized sources", async () => {
    expect(SyntacticExtractor.supported("go")).toBe(false)
    expect(await SyntacticExtractor.extract("go", "func main() {}")).toBeUndefined()

    const huge = `const x = 1\n`.repeat(150_000) // > 1.5MB
    expect(await SyntacticExtractor.extract("typescript", huge)).toBeUndefined()
  })

  test("caps the number of symbols per file", async () => {
    const source = Array.from({ length: 2_300 }, (_, i) => `function f${i}() {}`).join("\n")
    const symbols = await SyntacticExtractor.extract("javascript", source)
    expect(symbols!.length).toBe(2_000)
  })
})

describe("builder.indexFile syntactic fallback", () => {
  test("writes tagged nodes with completeness partial when LSP has no symbols", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const projectID = Instance.project.id
        CodeIntelligence.__clearProject(projectID)

        const filePath = path.join(tmp.path, "fallback.ts")
        await writeFile(
          filePath,
          ["export class Parser {", "  parse(input: string) { return input }", "}", "export function run() {}", ""].join(
            "\n",
          ),
        )

        const touchSpy = vi.spyOn(LSP, "touchFile").mockResolvedValue(0)
        const documentSymbolSpy = vi.spyOn(LSP, "documentSymbolEnvelope").mockResolvedValue({
          data: [],
          source: "lsp",
          completeness: "none",
          timestamp: Date.now(),
          serverIDs: [],
        } as never)

        try {
          const result = await CodeGraphBuilder.indexFile(projectID, filePath, { force: true })
          expect(result.completeness).toBe("partial")
          expect(result.nodes).toBeGreaterThanOrEqual(3)

          const parser = CodeGraphQuery.findNodesByName(projectID, "Parser")[0]
          const run = CodeGraphQuery.findNodesByName(projectID, "run")[0]
          expect(parser?.kind).toBe("class")
          expect(run?.kind).toBe("function")
          // Syntactic rows are tagged so downstream consumers can tell
          // them apart from semantic (LSP) rows, which keep metadata null.
          expect(parser?.metadata).toMatchObject({ source: "tree-sitter", precision: "syntactic" })

          const method = CodeGraphQuery.findNodesByName(projectID, "parse")[0]
          expect(method?.qualified_name).toBe("Parser::parse")

          const file = CodeGraphQuery.getFile(projectID, filePath)
          expect(file?.completeness).toBe("partial")
        } finally {
          documentSymbolSpy.mockRestore()
          touchSpy.mockRestore()
          CodeIntelligence.__clearProject(projectID)
        }
      },
    })
  })

  test("does not run the fallback when LSP produced symbols", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const projectID = Instance.project.id
        CodeIntelligence.__clearProject(projectID)

        const filePath = path.join(tmp.path, "semantic.ts")
        await writeFile(filePath, "export function real() {}\n")

        const touchSpy = vi.spyOn(LSP, "touchFile").mockResolvedValue(1)
        const documentSymbolSpy = vi.spyOn(LSP, "documentSymbolEnvelope").mockResolvedValue({
          data: [
            {
              name: "real",
              kind: 12,
              range: { start: { line: 0, character: 0 }, end: { line: 0, character: 26 } },
              selectionRange: { start: { line: 0, character: 16 }, end: { line: 0, character: 20 } },
            },
          ],
          source: "lsp",
          completeness: "full",
          timestamp: Date.now(),
          serverIDs: ["test-lsp"],
        } as never)
        const referencesSpy = vi.spyOn(LSP, "referencesEnvelope").mockResolvedValue({
          data: [],
          source: "lsp",
          completeness: "full",
          timestamp: Date.now(),
          serverIDs: ["test-lsp"],
        } as never)
        const extractSpy = vi.spyOn(SyntacticExtractor, "extract")

        try {
          await CodeGraphBuilder.indexFile(projectID, filePath, { force: true })
          expect(extractSpy).not.toHaveBeenCalled()
          const real = CodeGraphQuery.findNodesByName(projectID, "real")[0]
          expect(real?.metadata ?? null).toBeNull()
        } finally {
          extractSpy.mockRestore()
          referencesSpy.mockRestore()
          documentSymbolSpy.mockRestore()
          touchSpy.mockRestore()
          CodeIntelligence.__clearProject(projectID)
        }
      },
    })
  })
})
