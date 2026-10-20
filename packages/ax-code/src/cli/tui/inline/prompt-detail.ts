import { safeText } from "./block-format"

export const INLINE_DETAIL_ROWS = 4

export function truncateDetail(value: string, rows: number, more: (count: number) => string) {
  const lines = safeText(value).split("\n")
  return lines.length <= rows ? lines.join("\n") : [...lines.slice(0, rows), more(lines.length - rows)].join("\n")
}

export function compactDetail(metadata: Record<string, unknown>, patterns: string[], more: (count: number) => string) {
  const detail = [metadata.diff, metadata.command, metadata.description, ...patterns]
    .filter((value): value is string => typeof value === "string")
    .join("\n")
  return truncateDetail(detail, INLINE_DETAIL_ROWS, more)
}
