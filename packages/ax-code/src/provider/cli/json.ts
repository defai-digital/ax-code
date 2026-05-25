import { decodeJsonRecord, parseJsonRecord } from "@/util/json-record"

export type CliJsonObject = Record<string, unknown>

export function decodeCliJsonObject(value: unknown): CliJsonObject | undefined {
  return decodeJsonRecord(value)
}

export function parseCliJsonObject(text: string): CliJsonObject | undefined {
  return parseJsonRecord(text)
}
