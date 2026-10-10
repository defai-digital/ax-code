export type UnknownRecord = Record<string, unknown>

export function isRecord(value: unknown): value is UnknownRecord {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}

function recordKeyCount(value: unknown): number {
  return isRecord(value) ? Object.keys(value).length : 0
}

export function isNonEmptyRecord(value: unknown): boolean {
  return recordKeyCount(value) > 0
}
