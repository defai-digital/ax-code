import { defineBrandedIdentifier, type BrandedIdentifier } from "@/id/branded"
import z from "zod"

export type ToolID = BrandedIdentifier<"ToolID">

export const ToolID = defineBrandedIdentifier("ToolID", "tool")

export const ToolBoolean = z.preprocess((value) => {
  if (typeof value !== "string") return value
  const normalized = value.trim().toLowerCase()
  if (normalized === "true" || normalized === "1") return true
  if (normalized === "false" || normalized === "0") return false
  return value
}, z.boolean())
