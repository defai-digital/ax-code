import z from "zod"

/**
 * Normalize the common `cmd` spelling emitted by weaker OpenAI-compatible
 * coding models without advertising it in the model-facing schema.
 */
export function withCommandAlias<T extends z.ZodType>(schema: T): z.ZodType<z.infer<T>, z.input<T>> {
  return z.preprocess((raw) => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return raw
    const record = raw as Record<string, unknown>
    if (typeof record["command"] === "string" && record["command"].trim() !== "") return raw
    if (typeof record["cmd"] === "string" && record["cmd"].trim() !== "") {
      return { ...record, command: record["cmd"] }
    }
    return raw
  }, schema) as unknown as z.ZodType<z.infer<T>, z.input<T>>
}
