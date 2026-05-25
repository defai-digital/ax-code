import { parseJsonResult } from "./json-value"
import { isRecord } from "./record"

export function decodeJsonRecord(value: unknown): Record<string, unknown> | undefined {
  return isRecord(value) ? value : undefined
}

export function parseJsonRecord(input: unknown): Record<string, unknown> | undefined {
  if (typeof input === "string") {
    const parsed = parseJsonResult(input)
    if (!parsed.ok) {
      return undefined
    }
    return decodeJsonRecord(parsed.value)
  }
  return decodeJsonRecord(input)
}
