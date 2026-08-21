import z from "zod"

// Local copy of the core JsonNumber helper (util/schema) so the quality
// contract schemas stay self-contained. Normalizes numeric strings parsed
// from JSON artifacts while leaving non-numeric values untouched.

function normalizeJsonNumberValue(value: unknown) {
  if (typeof value === "number" && Number.isInteger(value) && !Number.isSafeInteger(value)) return Number.NaN
  if (typeof value !== "string") return value
  const trimmed = value.trim()
  if (trimmed === "") return value
  if (!/^[+-]?(?:\d+\.?\d*|\.\d+)$/.test(trimmed)) return value
  const parsed = Number(trimmed)
  if (Number.isInteger(parsed) && !Number.isSafeInteger(parsed)) return value
  return Number.isFinite(parsed) ? parsed : value
}

export function JsonNumber(schema: z.ZodNumber) {
  return z.preprocess(normalizeJsonNumberValue, schema)
}
