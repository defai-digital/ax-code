import { isRecord } from "@/util/record"
import { parseJsonResult, type JsonParseResult } from "@/util/json-value"

export type AuditJsonLineResult = JsonParseResult

export function parseAuditJsonLineResult(line: string): AuditJsonLineResult {
  return parseJsonResult(line)
}

export function auditSessionIDFromRecord(value: unknown): string | undefined {
  return isRecord(value) && typeof value.session_id === "string" ? value.session_id : undefined
}
