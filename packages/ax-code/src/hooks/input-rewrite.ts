import { isDeepStrictEqual } from "node:util"
import { Env } from "@/util/env"
import { truncateUtf8Bytes } from "@/tool/bash-helpers"

export interface HookRewriteRecord {
  hooks: string[]
  before: string
  after: string
}

/** Redact structured credentials and text before applying the byte ceiling. */
export function rewriteRecordValue(value: unknown): string {
  const seen = new WeakSet<object>()
  const serialized =
    JSON.stringify(value, (key, entry: unknown) => {
      if (Env.isCredentialKeyName(key)) return "[redacted]"
      if (typeof entry === "string") return Env.redactForRecord(entry)
      if (typeof entry === "bigint") return String(entry)
      if (entry && typeof entry === "object") {
        if (seen.has(entry)) return "[Circular]"
        seen.add(entry)
      }
      return entry
    }) ?? "null"
  const redacted = Env.redactForRecord(serialized)
  if (Buffer.byteLength(redacted) <= 4096) return redacted
  return `${truncateUtf8Bytes(redacted, 4096 - 14)}...[truncated]`
}

export type HookRewriteApproval = {
  hookRewritten: true
  effectiveInput: Record<string, unknown>
  changedFields: string[]
}

/** A bounded plain-data copy. Never leave raw values inside arrays or nested objects. */
export function effectiveInputForApproval(args: Record<string, unknown>): Record<string, unknown> {
  const redact = (value: unknown, depth: number): unknown => {
    if (typeof value === "string") return Env.redactForRecord(value).slice(0, 2_000)
    if (typeof value === "number" || typeof value === "boolean" || value === null) return value
    if (!value || typeof value !== "object") return "[omitted]"
    if (depth >= 4) return "[truncated]"
    if (Array.isArray(value)) return value.slice(0, 20).map((item) => redact(item, depth + 1))
    return Object.fromEntries(
      Object.entries(value)
        .slice(0, 40)
        .map(([key, entry]) => [key, Env.isCredentialKeyName(key) ? "[redacted]" : redact(entry, depth + 1)]),
    )
  }
  return redact(args, 0) as Record<string, unknown>
}

export function hookRewriteApproval(original: unknown, effective: unknown): HookRewriteApproval {
  const before = original && typeof original === "object" ? (original as Record<string, unknown>) : {}
  const after = effective && typeof effective === "object" ? (effective as Record<string, unknown>) : {}
  // Compare unredacted values: distinct credentials can have identical redacted displays.
  const changedFields = [...new Set([...Object.keys(before), ...Object.keys(after)])].filter(
    (key) => Object.hasOwn(before, key) !== Object.hasOwn(after, key) || !isDeepStrictEqual(before[key], after[key]),
  )
  return { hookRewritten: true, effectiveInput: effectiveInputForApproval(after), changedFields }
}
