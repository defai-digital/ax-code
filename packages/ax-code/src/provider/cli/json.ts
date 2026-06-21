import { isRecord } from "@/util/record"

export type CliJsonObject = Record<string, unknown>

export function decodeCliJsonObject(value: unknown): CliJsonObject | undefined {
  return isRecord(value) ? value : undefined
}

// Optimized JSON parsing for CLI stream events.
// Most lines are not JSON (e.g., raw text output), so we avoid the overhead
// of parseJsonRecord → parseJsonResult → decodeJsonRecord chain.
export function parseCliJsonObject(text: string): CliJsonObject | undefined {
  if (typeof text !== "string") return undefined
  // Fast path: skip non-JSON lines early (already checked by parseCliJsonEventLine,
  // but defensive in case this is called directly from resolve.ts)
  const trimmed = text.trim()
  if (!trimmed || trimmed[0] !== "{") return undefined

  try {
    const parsed = JSON.parse(trimmed)
    return isRecord(parsed) ? parsed : undefined
  } catch {
    return undefined
  }
}
