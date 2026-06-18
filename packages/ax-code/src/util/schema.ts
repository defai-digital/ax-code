import z from "zod"

/**
 * @deprecated Legacy schema helper. New code should use Zod directly.
 */
export const withStatics =
  <S extends object, M extends Record<string, unknown>>(methods: (schema: S) => M) =>
  (schema: S): S & M =>
    Object.assign(schema, methods(schema))

export const JsonBoolean = z.preprocess((value) => {
  if (typeof value !== "string") return value
  const normalized = value.trim().toLowerCase()
  if (normalized === "true" || normalized === "1") return true
  if (normalized === "false" || normalized === "0") return false
  return value
}, z.boolean())

function normalizeJsonNumberValue(value: unknown) {
  if (typeof value !== "string") return value
  const trimmed = value.trim()
  if (trimmed === "") return value
  const parsed = Number(trimmed)
  return Number.isFinite(parsed) ? parsed : value
}

export function JsonNumber(schema: z.ZodNumber) {
  return z.preprocess(normalizeJsonNumberValue, schema)
}
