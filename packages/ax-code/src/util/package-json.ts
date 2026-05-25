import { isRecord } from "./record"

export function parsePackageJsonObject(raw: string): Record<string, unknown> {
  const parsed: unknown = JSON.parse(raw)
  return isRecord(parsed) ? parsed : {}
}

export function packageJsonStringMap(value: unknown): Record<string, string> {
  if (!isRecord(value)) return {}
  const result: Record<string, string> = {}
  for (const [name, command] of Object.entries(value)) {
    if (typeof command === "string") result[name] = command
  }
  return result
}

export function packageJsonObjectKeys(value: unknown): string[] {
  return isRecord(value) ? Object.keys(value) : []
}
