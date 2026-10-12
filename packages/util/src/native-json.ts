import z from "zod"
import { parseJsonStrict } from "./json-value"

export function decodeNativeJsonValue<T>(value: unknown, schema: z.ZodType<T>, errorMessage: string): T {
  const decoded = schema.safeParse(value)
  if (!decoded.success) throw new SyntaxError(errorMessage)
  return decoded.data
}

export function parseNativeJson<T>(json: string, schema: z.ZodType<T>, errorMessage: string): T {
  return decodeNativeJsonValue(parseJsonStrict(json), schema, errorMessage)
}

export function parseNativeJsonArray<T>(json: string, itemSchema: z.ZodType<T>, errorMessage: string): T[] {
  return parseNativeJson(json, z.array(itemSchema), errorMessage)
}
