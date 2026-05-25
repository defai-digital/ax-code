import { parseJsonResult } from "./json-value"
import { isRecord } from "./record"

export function decodePackageJsonObject(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {}
}

export function parsePackageJsonObject(raw: string): Record<string, unknown> {
  const parsed = parseJsonResult(raw)
  if (!parsed.ok) {
    const { error } = parsed
    if (error instanceof Error) throw error
    throw new SyntaxError(String(error))
  }
  return decodePackageJsonObject(parsed.value)
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
