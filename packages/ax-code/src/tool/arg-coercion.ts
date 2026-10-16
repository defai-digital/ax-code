import { z } from "zod"
import { parseJsonResult } from "@/util/json-value"

/**
 * ADR-207: schema-guided repair of mismatched tool arguments.
 *
 * Weaker tool-calling models often send numbers and booleans as strings,
 * arrays or objects as JSON-encoded strings, or a bare scalar where an array
 * is expected. Coercion runs only after the tool's schema rejected the raw
 * arguments: the failing paths from the ZodError are repaired against the
 * shape the schema declares at that path, and the caller re-parses once. If
 * the re-parse still fails, the original error is reported unchanged.
 *
 * Repairs are deliberately conservative: ambiguous values are left alone, no
 * value is ever reinterpreted as a different string (no trimming, case
 * changes, or path edits), and paths whose declared shape cannot be resolved
 * statically (unions, records, catchalls) are skipped. MCP tools are not
 * defined through Tool.define and never reach this module.
 */

/** Upper bound for accepting a JSON-encoded string repair. */
const MAX_JSON_STRING_BYTES = 64 * 1024

/**
 * Numeric strings accepted for a number repair: a full-string decimal match
 * only (no whitespace, exponent, hex, or trailing characters) so the string
 * converts to its exact finite numeric value.
 */
const NUMERIC_STRING_PATTERN = /^[+-]?(?:\d+(?:\.\d+)?|\.\d+)$/

/** Upper bound for defensive unwrapping of nested schema wrappers. */
const MAX_UNWRAP_DEPTH = 16

type LeafKind = "number" | "boolean" | "array" | "object" | "unknown"

/**
 * Strips wrapper schemas (optional, nullable, default, readonly, ...) so the
 * declared leaf shape is visible. `z.preprocess` produces a pipe whose output
 * side carries the target schema (the JsonNumber/JsonNumber-style helpers),
 * so pipes resolve to their output side.
 */
function unwrapSchema(schema: z.ZodType): z.ZodType {
  // unwrap()/out return the core $ZodType shape; the classic superset cast is
  // safe because every schema produced by the zod builders satisfies it.
  let current: z.ZodType = schema
  for (let depth = 0; depth < MAX_UNWRAP_DEPTH; depth++) {
    if (
      current instanceof z.ZodOptional ||
      current instanceof z.ZodExactOptional ||
      current instanceof z.ZodNullable ||
      current instanceof z.ZodDefault ||
      current instanceof z.ZodPrefault ||
      current instanceof z.ZodNonOptional ||
      current instanceof z.ZodReadonly ||
      current instanceof z.ZodCatch
    ) {
      current = current.unwrap() as z.ZodType
      continue
    }
    if (current instanceof z.ZodPipe) {
      current = current.out as z.ZodType
      continue
    }
    return current
  }
  return current
}

function leafKind(schema: z.ZodType): LeafKind {
  const target = unwrapSchema(schema)
  if (target instanceof z.ZodNumber) return "number"
  if (target instanceof z.ZodBoolean) return "boolean"
  if (target instanceof z.ZodArray) return "array"
  if (target instanceof z.ZodObject) return "object"
  // Strings, unions, records, enums, literals, and anything exotic stay
  // untouched: coercing into them would change the value's meaning.
  return "unknown"
}

/** Resolves the schema declared at an issue path, or undefined when static resolution is not possible. */
function schemaAtPath(root: z.ZodType, path: (string | number)[]): z.ZodType | undefined {
  let current: z.ZodType | undefined = root
  for (const segment of path) {
    if (!current) return undefined
    const unwrapped = unwrapSchema(current)
    if (typeof segment === "string") {
      if (!(unwrapped instanceof z.ZodObject)) return undefined
      current = (unwrapped.shape as Record<string, z.ZodType>)[segment]
      continue
    }
    if (!(unwrapped instanceof z.ZodArray)) return undefined
    current = unwrapped.element as z.ZodType
  }
  return current
}

function valueAtPath(root: unknown, path: (string | number)[]): unknown {
  let current: unknown = root
  for (const segment of path) {
    if (current === null || typeof current !== "object") return undefined
    current = (current as Record<string | number, unknown>)[segment]
  }
  return current
}

function setValueAtPath(root: object, path: (string | number)[], value: unknown): boolean {
  let current: unknown = root
  for (let i = 0; i < path.length - 1; i++) {
    if (current === null || typeof current !== "object") return false
    current = (current as Record<string | number, unknown>)[path[i]!]
  }
  if (current === null || typeof current !== "object") return false
  ;(current as Record<string | number, unknown>)[path[path.length - 1]!] = value
  return true
}

function parseJsonString(text: string): unknown {
  if (Buffer.byteLength(text, "utf8") > MAX_JSON_STRING_BYTES) return undefined
  const parsed = parseJsonResult(text)
  return parsed.ok ? parsed.value : undefined
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

/**
 * Applies the ADR-207 repair for one value against its declared leaf kind.
 * Returns the replacement value, or undefined when no conservative repair
 * applies (ambiguous or already-correct values are returned unchanged by the
 * caller leaving them in place).
 */
function repairValue(value: unknown, kind: LeafKind): { done: true; value: unknown } | { done: false } {
  switch (kind) {
    case "number": {
      if (typeof value !== "string" || !NUMERIC_STRING_PATTERN.test(value)) return { done: false }
      const parsed = Number(value)
      if (!Number.isFinite(parsed)) return { done: false }
      return { done: true, value: parsed }
    }
    case "boolean": {
      if (value === "true") return { done: true, value: true }
      if (value === "false") return { done: true, value: false }
      return { done: false }
    }
    case "array": {
      if (Array.isArray(value)) return { done: false }
      if (typeof value === "string") {
        const parsed = parseJsonString(value)
        if (Array.isArray(parsed)) return { done: true, value: parsed }
        // Not a JSON array (or over the size cap): fall through and wrap the
        // original scalar so its text is never reinterpreted.
      }
      if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
        return { done: true, value: [value] }
      }
      return { done: false }
    }
    case "object": {
      if (typeof value !== "string") return { done: false }
      const parsed = parseJsonString(value)
      if (!isPlainObject(parsed)) return { done: false }
      return { done: true, value: parsed }
    }
    default:
      return { done: false }
  }
}

/**
 * Repairs the failing paths of a rejected tool call against the schema.
 * Returns a deep clone of `args` with the repairs applied plus the repaired
 * paths (for debug logging — never the values), or undefined when no repair
 * applies. The caller re-parses once; the original error stays authoritative.
 */
export function coerceToolArguments(
  parameters: z.ZodType,
  args: unknown,
  error: z.ZodError,
): { value: unknown; paths: string[] } | undefined {
  if (typeof args !== "object" || args === null) return undefined

  let repaired: object | undefined
  const paths: string[] = []

  for (const issue of error.issues) {
    const path = issue.path.filter((segment): segment is string | number => typeof segment !== "symbol")
    if (path.length === 0) continue

    const schema = schemaAtPath(parameters, path)
    if (!schema) continue
    const kind = leafKind(schema)
    if (kind === "unknown") continue

    const repair = repairValue(valueAtPath(args, path), kind)
    if (!repair.done) continue

    if (!repaired) {
      try {
        repaired = structuredClone(args)
      } catch {
        // Values the runtime cannot clone (should not happen for model JSON)
        // disable coercion entirely rather than mutating the caller's object.
        return undefined
      }
    }
    if (!setValueAtPath(repaired, path, repair.value)) continue
    paths.push(path.join("."))
  }

  if (!repaired || paths.length === 0) return undefined
  return { value: repaired, paths }
}
