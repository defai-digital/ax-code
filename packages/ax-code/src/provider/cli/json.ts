import { decodeJsonRecord } from "@/util/json-record"

export type CliJsonObject = Record<string, any>

export function decodeCliJsonObject(value: unknown): CliJsonObject | undefined {
  return decodeJsonRecord(value) as CliJsonObject | undefined
}

export function parseCliJsonObject(text: string): CliJsonObject | undefined {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return undefined
  }
  return decodeCliJsonObject(parsed)
}
