import z from "zod"
import { parseJsonStrict } from "./json-value"

function decodeNativeJsonValue<T>(value: unknown, schema: z.ZodType<T>, errorMessage: string): T {
  const decoded = schema.safeParse(value)
  if (!decoded.success) throw new SyntaxError(errorMessage)
  return decoded.data
}

export function parseNativeJson<T>(json: string, schema: z.ZodType<T>, errorMessage: string): T {
  return decodeNativeJsonValue(parseJsonStrict(json), schema, errorMessage)
}
