// Pure formatting helpers for the primitives layer (ADR-031). Covered by
// the TUI layering guard — keep free of Solid and renderer imports.

// ASCII gauge segments (filled "=", empty "-"). Deliberately ASCII-only:
// every geometric/block-element glyph in U+2580-U+25FF is East Asian
// Ambiguous width — the layout engine measures them as 1 cell while CJK
// terminals render them 2 cells wide, so block glyphs made the text after
// the gauge overlap on those terminals. A non-zero ratio always shows at
// least one filled segment so low-but-real usage doesn't read as empty.
export function gaugeParts(ratio: number, width = 5): { filled: string; empty: string } {
  const cells = Math.max(1, Math.floor(width))
  const clamped = Math.min(1, Math.max(0, ratio))
  const filled = clamped === 0 ? 0 : Math.max(1, Math.round(clamped * cells))
  return { filled: "=".repeat(filled), empty: "-".repeat(cells - filled) }
}

export function formatGauge(ratio: number, width = 5): string {
  const parts = gaugeParts(ratio, width)
  return parts.filled + parts.empty
}
