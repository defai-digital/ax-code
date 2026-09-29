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
  } as const

  /** Map a root-relative path to a supported extractor language, if any. */
  export function languageFor(relative: string): string | undefined {
    const lang =
      LANGUAGE_EXTENSIONS[path.extname(relative).toLowerCase()] ??
      LANGUAGE_EXTENSIONS[path.basename(relative).toLowerCase()]
    if (!lang || lang === "plaintext" || !SyntacticExtractor.supported(lang)) return undefined
    return lang
  }

  /**
   * Deterministic per-source symbol inventory for view projection. Sorted
   * input order decides which files fit the budgets; unsupported, unreadable,
   * or failed files are skipped (fail-open), never fatal.
   */
  export async function build(
    root: string,
    sources: readonly string[],
    limits: { maxSources: number; perFileBytes: number; totalBytes: number; symbolsPerSource: number } = LIMITS,
  ): Promise<Map<string, InventorySymbol[]>> {
    const selected = [...new Set(sources)].sort().slice(0, Math.max(0, limits.maxSources))
    const inventory = new Map<string, InventorySymbol[]>()
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
      if (!symbols || symbols.length === 0) continue
      inventory.set(
        relative,
        symbols
          .slice(0, Math.max(0, limits.symbolsPerSource))
          .map((symbol) => ({ name: symbol.name, qualified: symbol.qualified, kind: symbol.kind })),
      )
    }
    return inventory
  }
}
