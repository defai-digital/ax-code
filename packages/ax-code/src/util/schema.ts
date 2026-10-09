import z from "zod"

export const JsonBoolean = z.preprocess((value) => {
  if (typeof value !== "string") return value
  const normalized = value.trim().toLowerCase()
  if (normalized === "true" || normalized === "1") return true
  if (normalized === "false" || normalized === "0") return false
  return value
}, z.boolean())

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
