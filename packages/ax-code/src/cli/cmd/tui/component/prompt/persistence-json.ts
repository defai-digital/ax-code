import z from "zod"

export function decodePromptPersistenceJsonLine<T>(line: string, schema: z.ZodType<T>): T | undefined {
  try {
    const decoded = schema.safeParse(JSON.parse(line))
    return decoded.success ? decoded.data : undefined
  } catch {
    return undefined
  }
}
