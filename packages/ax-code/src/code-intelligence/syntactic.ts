import { createRequire } from "node:module"
import { lazy } from "@/util/lazy"
import { Log } from "../util/log"
import { toErrorMessage } from "../util/error-message"
import type { CodeNodeKind } from "./schema.sql"

// Syntactic fallback extraction for the code-intelligence builder.
//
// The graph schema always planned for this tier — code_file.completeness
// documents `"partial" = indexed via tree-sitter (symbols only, no
// cross-references)` — but the builder only ever had the LSP path, so a
// file without a healthy semantic language server contributed nothing to
// the graph. This module completes the design: when LSP yields zero
// document symbols, the builder asks for a deterministic local parse via
// web-tree-sitter and the grammar .wasm packages that already ship beside
// the bundle (see build-node-tui's distDeps).
//
// Scope and guarantees:
//   - Symbols only. References/call edges need semantic analysis; files
//     indexed through this path keep completeness "partial" so downstream
//     consumers never over-trust them, and nodes carry
//     `metadata: { source: "tree-sitter", precision: "syntactic" }`.
//   - Bounded. Sources larger than MAX_SOURCE_BYTES are skipped (the wasm
//     parse is synchronous on the backend event loop), and a grammar that
//     fails to load is latched broken for the process lifetime instead of
//     being retried per file.
//   - Local and deterministic: no LLM, no network, byte-identical inputs
//     produce identical symbols.
export namespace SyntacticExtractor {
  const log = Log.create({ service: "code-intelligence.syntactic" })

  // ~1.5MB of source is beyond any hand-written file we want to spend
  // synchronous parse time on (bundles, lockfile-sized generated JS).
  const MAX_SOURCE_BYTES = 1_500_000

  // Cap symbols per file so a pathological generated file cannot flood
  // code_node. Mirrors the spirit of MAX_REFERENCE_QUERIES_PER_FILE on
  // the LSP path.
  const MAX_SYMBOLS_PER_FILE = 2_000

  const SIGNATURE_MAX_CHARS = 200

  export type Symbol = {
    kind: CodeNodeKind
    name: string
    qualified: string
    startLine: number
    startChar: number
    endLine: number
    endChar: number
    signature: string | null
  }

  // detectLanguage() output → grammar wasm shipped as an npm package.
  // Only list languages whose grammars are in the dependency tree; the
  // builder consults supported() before reading the file for us.
  const GRAMMARS: Record<string, string> = {
    typescript: "tree-sitter-typescript/tree-sitter-typescript.wasm",
    typescriptreact: "tree-sitter-typescript/tree-sitter-tsx.wasm",
    javascript: "tree-sitter-javascript/tree-sitter-javascript.wasm",
    javascriptreact: "tree-sitter-javascript/tree-sitter-javascript.wasm",
    shellscript: "tree-sitter-bash/tree-sitter-bash.wasm",
  }

  export function supported(lang: string): boolean {
    return lang in GRAMMARS
  }

  // Resolve .wasm FILE PATHS with createRequire rather than importing the
  // wasm module — same reasoning as the bash tool's parser: Bun's wasm
  // import returns a path but Node instantiates the module and fails on
  // its `env` import. web-tree-sitter reads the bytes itself.
  const requireWasm = createRequire(import.meta.url)

  const runtime = lazy(async () => {
    const { Parser, Language } = await import("web-tree-sitter")
    await Parser.init({
      locateFile() {
        return requireWasm.resolve("web-tree-sitter/tree-sitter.wasm")
      },
    })
    return { Parser, Language }
  })

  type Language = Awaited<ReturnType<Awaited<ReturnType<typeof runtime>>["Language"]["load"]>>
  const languages = new Map<string, Promise<Language | undefined>>()

  function loadLanguage(lang: string): Promise<Language | undefined> {
    if (!supported(lang)) return Promise.resolve(undefined)
    const cached = languages.get(lang)
    if (cached) return cached
    // Bound cache size to the finite GRAMMARS table so a hot path cannot grow
    // the map without limit (lifecycle_scan map_growth).
    if (languages.size >= Object.keys(GRAMMARS).length) return Promise.resolve(undefined)
    const loading = (async () => {
      try {
        const { Language } = await runtime()
        return await Language.load(requireWasm.resolve(GRAMMARS[lang]))
      } catch (err) {
        // Latch broken for the process lifetime — a missing/incompatible
        // grammar would otherwise be re-attempted for every file.
        log.warn("failed to load tree-sitter grammar; syntactic fallback disabled for language", {
          lang,
          err: toErrorMessage(err),
        })
        return undefined
      }
    })()
    languages.set(lang, loading)
    return loading
  }

  // web-tree-sitter node — typed structurally to what the walkers read.
  type TSNode = {
    type: string
    text: string
    namedChildCount: number
    namedChild(i: number): TSNode | null
    childForFieldName(name: string): TSNode | null
    startPosition: { row: number; column: number }
    endPosition: { row: number; column: number }
  }

  export async function extract(lang: string, text: string): Promise<Symbol[] | undefined> {
    if (!supported(lang)) return undefined
    if (text.length > MAX_SOURCE_BYTES) {
      log.info("skipping syntactic extraction, source too large", { lang, size: text.length })
      return undefined
    }
    const language = await loadLanguage(lang)
    if (!language) return undefined

    const { Parser } = await runtime()
    const parser = new Parser()
    let tree: { rootNode: unknown; delete(): void } | null = null
    try {
      parser.setLanguage(language)
      tree = parser.parse(text)
      if (!tree) return undefined
      const symbols: Symbol[] = []
      const root = tree.rootNode as TSNode
      if (lang === "shellscript") walkBash(root, symbols)
      else walkJsTs(root, "", symbols)
      return symbols
    } catch (err) {
      log.warn("syntactic extraction failed", { lang, err: toErrorMessage(err) })
      return undefined
    } finally {
      tree?.delete()
      parser.delete?.()
    }
  }

  function push(symbols: Symbol[], sym: Symbol): boolean {
    if (symbols.length >= MAX_SYMBOLS_PER_FILE) return false
    symbols.push(sym)
    return true
  }

  function qualify(prefix: string, name: string): string {
    return prefix ? `${prefix}::${name}` : name
  }

  function signatureOf(node: TSNode): string | null {
    const params = node.childForFieldName("parameters") ?? node.childForFieldName("type_parameters")
    if (!params) return null
    const text = params.text
    return text.length > SIGNATURE_MAX_CHARS ? null : text
  }

  function declaration(node: TSNode, kind: CodeNodeKind, prefix: string, name: string): Symbol {
    return {
      kind,
      name,
      qualified: qualify(prefix, name),
      startLine: node.startPosition.row,
      startChar: node.startPosition.column,
      endLine: node.endPosition.row,
      endChar: node.endPosition.column,
      signature: kind === "function" || kind === "method" ? signatureOf(node) : null,
    }
  }

  // ─── JavaScript / TypeScript ─────────────────────────────────────────
  //
  // Node types verified against tree-sitter-javascript 0.25.0 and
  // tree-sitter-typescript 0.23.2 under web-tree-sitter 0.25.

  const JS_FUNCTION_TYPES = new Set(["function_declaration", "generator_function_declaration"])
  const JS_CLASS_TYPES = new Set(["class_declaration", "abstract_class_declaration"])
  const JS_VALUE_FUNCTION_TYPES = new Set(["arrow_function", "function_expression", "generator_function", "function"])

  function nameOf(node: TSNode): string | undefined {
    const name = node.childForFieldName("name")
    return name?.text || undefined
  }

  function walkJsTs(node: TSNode, prefix: string, symbols: Symbol[]): void {
    for (let i = 0; i < node.namedChildCount; i++) {
      const child = node.namedChild(i)
      if (!child) continue
      if (!visitJsTs(child, prefix, symbols)) return
    }
  }

  // Returns false once the per-file symbol cap is hit so the walk stops.
  function visitJsTs(node: TSNode, prefix: string, symbols: Symbol[]): boolean {
    switch (true) {
      case node.type === "export_statement" ||
        node.type === "ambient_declaration" ||
        node.type === "expression_statement": {
        // Recurse through wrappers: `export class A {}`, `declare module ...`,
        // and statement-level namespaces — the TS grammar parses
        // `namespace N {}` as expression_statement > internal_module.
        walkJsTs(node, prefix, symbols)
        return true
      }
      case JS_FUNCTION_TYPES.has(node.type): {
        const name = nameOf(node)
        return !name || push(symbols, declaration(node, "function", prefix, name))
      }
      case JS_CLASS_TYPES.has(node.type): {
        const name = nameOf(node)
        if (!name) return true
        if (!push(symbols, declaration(node, "class", prefix, name))) return false
        const body = node.childForFieldName("body")
        if (body) walkClassBody(body, qualify(prefix, name), symbols)
        return true
      }
      case node.type === "interface_declaration": {
        const name = nameOf(node)
        return !name || push(symbols, declaration(node, "interface", prefix, name))
      }
      case node.type === "enum_declaration": {
        const name = nameOf(node)
        return !name || push(symbols, declaration(node, "enum", prefix, name))
      }
      case node.type === "type_alias_declaration": {
        const name = nameOf(node)
        return !name || push(symbols, declaration(node, "type", prefix, name))
      }
      case node.type === "internal_module" || node.type === "module": {
        // TS `namespace N { ... }` / `module N { ... }`.
        const name = nameOf(node)
        if (!name) return true
        if (!push(symbols, declaration(node, "module", prefix, name))) return false
        const body = node.childForFieldName("body")
        if (body) walkJsTs(body, qualify(prefix, name), symbols)
        return true
      }
      case node.type === "lexical_declaration" || node.type === "variable_declaration": {
        const isConst = node.text.startsWith("const")
        for (let i = 0; i < node.namedChildCount; i++) {
          const declarator = node.namedChild(i)
          if (!declarator || declarator.type !== "variable_declarator") continue
          const name = nameOf(declarator)
          if (!name) continue
          const value = declarator.childForFieldName("value")
          const kind: CodeNodeKind = value && JS_VALUE_FUNCTION_TYPES.has(value.type) ? "function" : isConst ? "constant" : "variable"
          const sym =
            kind === "function" && value
              ? { ...declaration(declarator, kind, prefix, name), signature: signatureOf(value) }
              : declaration(declarator, kind, prefix, name)
          if (!push(symbols, sym)) return false
        }
        return true
      }
      default:
        return true
    }
  }

  function walkClassBody(body: TSNode, classQualified: string, symbols: Symbol[]): void {
    for (let i = 0; i < body.namedChildCount; i++) {
      const member = body.namedChild(i)
      if (!member) continue
      if (member.type === "method_definition") {
        const name = nameOf(member)
        if (name && !push(symbols, declaration(member, "method", classQualified, name))) return
      } else if (member.type === "public_field_definition" || member.type === "field_definition") {
        const name = member.childForFieldName("name")?.text ?? member.childForFieldName("property")?.text
        if (!name) continue
        const value = member.childForFieldName("value")
        const kind: CodeNodeKind = value && JS_VALUE_FUNCTION_TYPES.has(value.type) ? "method" : "variable"
        if (!push(symbols, declaration(member, kind, classQualified, name))) return
      }
    }
  }

  // ─── Bash ────────────────────────────────────────────────────────────

  function walkBash(node: TSNode, symbols: Symbol[]): void {
    for (let i = 0; i < node.namedChildCount; i++) {
      const child = node.namedChild(i)
      if (!child) continue
      if (child.type === "function_definition") {
        const name = nameOf(child)
        if (name && !push(symbols, declaration(child, "function", "", name))) return
        continue
      }
      // Function definitions can hide inside compound statements/blocks.
      walkBash(child, symbols)
    }
  }
}
