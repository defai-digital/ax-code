import z from "zod"
import { parseJsonResult } from "./json-value"

export function decodeNativeJsonValue<T>(value: unknown, schema: z.ZodType<T>, errorMessage: string): T {
  const decoded = schema.safeParse(value)
  if (!decoded.success) throw new SyntaxError(errorMessage)
  return decoded.data
}

export function parseNativeJson<T>(json: string, schema: z.ZodType<T>, errorMessage: string): T {
  const parsed = parseJsonResult(json)
  if (!parsed.ok) {
    const { error } = parsed
    if (error instanceof Error) throw error
    throw new SyntaxError(String(error))
  }
  return decodeNativeJsonValue(parsed.value, schema, errorMessage)
}

export function parseNativeJsonArray<T>(json: string, itemSchema: z.ZodType<T>, errorMessage: string): T[] {
  return parseNativeJson(json, z.array(itemSchema), errorMessage)
}
