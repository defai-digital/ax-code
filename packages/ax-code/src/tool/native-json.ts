import z from "zod"

export function parseNativeJsonArray<T>(json: string, itemSchema: z.ZodType<T>, errorMessage: string): T[] {
  const parsed: unknown = JSON.parse(json)
  const decoded = z.array(itemSchema).safeParse(parsed)
  if (!decoded.success) throw new SyntaxError(errorMessage)
  return decoded.data
}
