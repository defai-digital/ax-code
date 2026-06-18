import z from "zod"

export const QueryBoolean = z.preprocess((value) => {
  if (typeof value !== "string") return value
  const normalized = value.trim().toLowerCase()
  if (normalized === "") return true
  if (normalized === "true" || normalized === "1") return true
  if (normalized === "false" || normalized === "0") return false
  return value
}, z.boolean())

function normalizeEmptyQueryValue(value: unknown) {
  if (typeof value !== "string") return value
  return value.trim() === "" ? undefined : value
}

export function OptionalQueryNumber(schema: z.ZodNumber) {
  return z.preprocess(normalizeEmptyQueryValue, schema.optional()).optional()
}

export function DefaultQueryNumber(schema: z.ZodNumber, defaultValue: number) {
  return z.preprocess(normalizeEmptyQueryValue, schema.optional()).default(defaultValue)
}
