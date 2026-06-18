import z from "zod"

export const QueryBoolean = z.preprocess((value) => {
  if (typeof value !== "string") return value
  const normalized = value.trim().toLowerCase()
  if (normalized === "") return true
  if (normalized === "true" || normalized === "1") return true
  if (normalized === "false" || normalized === "0") return false
  return value
}, z.boolean())
