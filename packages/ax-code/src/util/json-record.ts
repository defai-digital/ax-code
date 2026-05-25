import { isRecord } from "./record"

export function decodeJsonRecord(value: unknown): Record<string, unknown> | undefined {
  return isRecord(value) ? value : undefined
}

export function parseJsonRecord(input: unknown): Record<string, unknown> | undefined {
  if (typeof input === "string") {
    try {
      const parsed: unknown = JSON.parse(input)
      return decodeJsonRecord(parsed)
    } catch {
      return undefined
    }
  }
  return decodeJsonRecord(input)
}
