import path from "node:path"
import { LANGUAGE_EXTENSIONS } from "@ax-code/ax-code-intel/language"
import { readFilePrefix } from "@ax-code/ax-wiki/node"
import type { InventorySymbol } from "@ax-code/ax-wiki/graph"
import { SyntacticExtractor } from "../code-intelligence/syntactic"

export namespace WikiInventory {
  export const LIMITS = {
    maxSources: 200,
    perFileBytes: 262_144,
    totalBytes: 8_388_608,
    symbolsPerSource: 100,
    importsPerSource: 100,
  } as const

  export type Limits = {
    maxSources: number
    perFileBytes: number
    totalBytes: number
    symbolsPerSource: number
    importsPerSource: number
  }

  /** Per-source inventory: outline symbols plus resolved repo-relative import targets. */
  export type SourceInventory = {
    symbols: InventorySymbol[]
    imports: string[]
  }

  /** Map a root-relative path to a supported extractor language, if any. */
  export function languageFor(relative: string): string | undefined {
    const lang =
      LANGUAGE_EXTENSIONS[path.extname(relative).toLowerCase()] ??
      LANGUAGE_EXTENSIONS[path.basename(relative).toLowerCase()]
    if (!lang || lang === "plaintext" || !SyntacticExtractor.supported(lang)) return undefined
    return lang
  }

  const JS_TS_EXTENSIONS = [".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs"]
  // TypeScript resolves extensionful relative imports against source files:
  // `./x.js` in a .ts file means `./x.ts` on disk.
  const JS_EXT_SWAP: Record<string, string> = { ".js": ".ts", ".jsx": ".tsx", ".mjs": ".mts", ".cjs": ".cts" }

  /**
   * Resolve a relative module specifier against the cited source set without
   * I/O: exact match, TypeScript extension swap, extension probing, then
   * index files. Bare, absolute, escaping, or unlisted targets yield
   * undefined (no edge), never a guess.
   */
  export function resolveImport(from: string, specifier: string, cited: ReadonlySet<string>): string | undefined {
    if (!specifier || specifier.includes("\\") || specifier.includes("?") || specifier.includes("#")) return undefined
    if (specifier !== "." && specifier !== ".." && !specifier.startsWith("./") && !specifier.startsWith("../"))
      return undefined
    const base = path.posix.normalize(path.posix.join(path.posix.dirname(from), specifier))
    if (!base || base === "." || base === ".." || base.startsWith("../") || path.posix.isAbsolute(base))
      return undefined
    if (cited.has(base)) return base
    const ext = path.posix.extname(base).toLowerCase()
    const swapped = JS_EXT_SWAP[ext]
    if (swapped && cited.has(base.slice(0, -ext.length) + swapped)) return base.slice(0, -ext.length) + swapped
    for (const candidate of JS_TS_EXTENSIONS.map((suffix) => base + suffix)) {
      if (cited.has(candidate)) return candidate
    }
    for (const candidate of JS_TS_EXTENSIONS.map((suffix) => `${base}/index${suffix}`)) {
      if (cited.has(candidate)) return candidate
    }
    return undefined
  }

  /**
   * Deterministic per-source symbol and import inventory for view
   * projection. Sorted input order decides which files fit the budgets;
   * unsupported, unreadable, or failed files are skipped (fail-open),
   * never fatal. Each file is read once; import targets resolve against
   * the full cited set so co-cited files link even beyond the read slice.
   */
  export async function buildAll(
    root: string,
    sources: readonly string[],
    limits: Limits = LIMITS,
  ): Promise<Map<string, SourceInventory>> {
    const cited = new Set(sources)
    const selected = [...cited].sort().slice(0, Math.max(0, limits.maxSources))
    const inventory = new Map<string, SourceInventory>()
    let remaining = Math.max(0, limits.totalBytes)
    for (const relative of selected) {
      if (remaining <= 0) break
      const lang = languageFor(relative)
      if (!lang) continue
      const content = await readFilePrefix(root, relative, Math.min(remaining, Math.max(0, limits.perFileBytes)))
      if (!content) continue
      remaining -= Buffer.byteLength(content)
      let symbols: SyntacticExtractor.Symbol[] | undefined
      try {
        symbols = await SyntacticExtractor.extract(lang, content)
      } catch {
        continue
      }
      let refs: SyntacticExtractor.ImportRef[] | undefined
      if (SyntacticExtractor.importsSupported(lang)) {
        try {
          refs = await SyntacticExtractor.extractImports(lang, content)
        } catch {
          refs = undefined
        }
      }
      const listed = (symbols ?? [])
        .slice(0, Math.max(0, limits.symbolsPerSource))
        .map((symbol) => ({ name: symbol.name, qualified: symbol.qualified, kind: symbol.kind }))
      const imports = [
        ...new Set(
          (refs ?? [])
            .map((ref) => resolveImport(relative, ref.specifier, cited))
            .filter((target): target is string => !!target && target !== relative),
        ),
      ]
        .sort()
        .slice(0, Math.max(0, limits.importsPerSource))
      if (listed.length === 0 && imports.length === 0) continue
      inventory.set(relative, { symbols: listed, imports })
    }
    return inventory
  }

  /**
   * Deterministic per-source symbol inventory for view projection. Sorted
   * input order decides which files fit the budgets; unsupported, unreadable,
   * or failed files are skipped (fail-open), never fatal.
   */
  export async function build(
    root: string,
    sources: readonly string[],
    limits: Limits = LIMITS,
  ): Promise<Map<string, InventorySymbol[]>> {
    const inventory = new Map<string, InventorySymbol[]>()
    for (const [relative, entry] of await buildAll(root, sources, limits)) {
      if (entry.symbols.length > 0) inventory.set(relative, entry.symbols)
    }
    return inventory
  }
}
