import { parseJsonRecord } from "@/util/json-record"

export type CliJsonObject = Record<string, any>

export function parseCliJsonObject(text: string): CliJsonObject | undefined {
  return parseJsonRecord(text) as CliJsonObject | undefined
}
