/** Browser-safe symbol grounding shared by validation and view projection. No runtime imports. */

export type SymbolProvenance = "verified" | "inferred" | "unavailable"

export function symbolGrounded(symbol: string, contents: readonly string[]): boolean {
  const candidates = new Set<string>([symbol])
  const separator = symbol.includes("::") ? "::" : symbol.includes(".") ? "." : undefined
  if (separator) {
    const last = symbol.split(separator).filter(Boolean).pop()
    if (last) candidates.add(last)
  }
  for (const content of contents) {
    for (const candidate of candidates) {
      if (candidate && content.includes(candidate)) return true
    }
  }
  return false
}

/**
 * Provenance of a generator-reported symbol against bounded excerpts of its
 * cited sources. Excerpts may be truncated, so `inferred` is not a falsehood
 * verdict; missing bytes project as `unavailable`, never as verified.
 */
export function provenanceOfSymbol(symbol: string, excerpts: readonly string[] | undefined): SymbolProvenance {
  if (!excerpts || excerpts.length === 0) return "unavailable"
  return symbolGrounded(symbol, excerpts) ? "verified" : "inferred"
}
