import {
  type ParseError as JsoncParseError,
  applyEdits,
  modify,
  parse as parseJsonc,
  printParseErrorCode,
} from "jsonc-parser"
import { isRecord } from "./record"

const JSONC_EDIT_OPTIONS = {
  formattingOptions: {
    insertSpaces: true,
    tabSize: 2,
  },
} as const

export const JSONC_UNCHANGED = Symbol("jsonc-unchanged")

export type JsoncParseResult =
  | {
      ok: true
      value: unknown
    }
  | {
      ok: false
      error: string
    }

export function parseJsoncResult(text: string): JsoncParseResult {
  const errors: JsoncParseError[] = []
  const value = parseJsonc(text, errors, { allowTrailingComma: true })
  if (errors.length) return { ok: false, error: formatJsoncError(text, errors) }
  return { ok: true, value }
}

export function formatJsoncError(text: string, errors: JsoncParseError[]): string {
  const error = errors[0]
  if (!error) return "Invalid JSONC"
  const before = text.substring(0, error.offset).split("\n")
  const line = before.length
  const column = (before[before.length - 1] ?? "").length + 1
  return `${printParseErrorCode(error.error)} at position ${error.offset} (line ${line} column ${column})`
}

export function patchJsonc(input: string, patch: unknown, jsonPath: (string | number)[] = []): string {
  if (!isRecord(patch)) {
    return applyEdits(input, modify(input, jsonPath, patch, JSONC_EDIT_OPTIONS))
  }
  return Object.entries(patch).reduce((result, [key, value]) => {
    return patchJsonc(result, value, [...jsonPath, key])
  }, input)
}

export function changedJsoncPatch(before: unknown, after: unknown): unknown | typeof JSONC_UNCHANGED {
  if (Object.is(before, after)) return JSONC_UNCHANGED
  if (isRecord(before) && isRecord(after)) {
    const patch: Record<string, unknown> = {}
    for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
      if (!(key in after)) {
        patch[key] = undefined
        continue
      }
      if (!(key in before)) {
        patch[key] = after[key]
        continue
      }
      const nested = changedJsoncPatch(before[key], after[key])
      if (nested !== JSONC_UNCHANGED) patch[key] = nested
    }
    return Object.keys(patch).length > 0 ? patch : JSONC_UNCHANGED
  }
  if (Array.isArray(before) && Array.isArray(after)) {
    if (
      before.length === after.length &&
      before.every((value, index) => changedJsoncPatch(value, after[index]) === JSONC_UNCHANGED)
    ) {
      return JSONC_UNCHANGED
    }
    return after
  }
  return after
}
