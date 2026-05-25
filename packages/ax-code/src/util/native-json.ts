import z from "zod"

export function parseNativeJson<T>(json: string, schema: z.ZodType<T>, errorMessage: string): T {
  const parsed: unknown = JSON.parse(json)
  const decoded = schema.safeParse(parsed)
  if (!decoded.success) throw new SyntaxError(errorMessage)
  return decoded.data
}

export function parseNativeJsonArray<T>(json: string, itemSchema: z.ZodType<T>, errorMessage: string): T[] {
  return parseNativeJson(json, z.array(itemSchema), errorMessage)
}
