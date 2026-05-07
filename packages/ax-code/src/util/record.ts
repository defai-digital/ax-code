export type UnknownRecord = Record<string, unknown>

export function isRecord(value: unknown): value is UnknownRecord {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}

export function asRecord(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {}
}

export function asRecordOrUndefined(value: unknown): Record<string, unknown> | undefined {
  return isRecord(value) ? value : undefined
}

export function isNonEmptyRecord(value: unknown): boolean {
  return isRecord(value) && Object.keys(value).length > 0
}

export function recordCount(value: unknown): number {
  return isRecord(value) ? Object.keys(value).length : 0
}
