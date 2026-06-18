import z from "zod"
import { JsonBoolean } from "@/util/schema"

export const QueryBoolean = z.preprocess((value) => {
  if (typeof value !== "string") return value
  const normalized = value.trim().toLowerCase()
  if (normalized === "") return true
  if (normalized === "true" || normalized === "1") return true
  if (normalized === "false" || normalized === "0") return false
  return value
}, z.boolean())

export { JsonBoolean }

function normalizeQueryNumberValue(value: unknown) {
  if (typeof value !== "string") return value
  const trimmed = value.trim()
  if (trimmed === "") return undefined
  if (!/^[+-]?(?:\d+\.?\d*|\.\d+)$/.test(trimmed)) return value
  const parsed = Number(trimmed)
  return Number.isFinite(parsed) ? parsed : value
}

export function OptionalQueryNumber(schema: z.ZodNumber) {
  return z.preprocess(normalizeQueryNumberValue, schema.optional()).optional()
}

export function DefaultQueryNumber(schema: z.ZodNumber, defaultValue: number) {
  return z.preprocess(normalizeQueryNumberValue, schema.optional()).default(defaultValue)
}
