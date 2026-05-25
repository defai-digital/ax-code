import { isRecord } from "@/util/record"

export type AuditJsonLineResult =
  | {
      ok: true
      value: unknown
    }
  | {
      ok: false
      error: unknown
    }

export function parseAuditJsonLineResult(line: string): AuditJsonLineResult {
  try {
    return { ok: true, value: JSON.parse(line) }
  } catch (error) {
    return { ok: false, error }
  }
}

export function auditSessionIDFromRecord(value: unknown): string | undefined {
  return isRecord(value) && typeof value.session_id === "string" ? value.session_id : undefined
}
