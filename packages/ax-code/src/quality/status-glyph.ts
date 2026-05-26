export function statusGlyph(status: string): string {
  if (status === "passed") return "✓"
  if (status === "skipped") return "⏭"
  return "✗"
}
