import { defineBrandedIdentifier, type BrandedIdentifier } from "@/id/branded"
import { JsonBoolean } from "@/util/schema"

export type ToolID = BrandedIdentifier<"ToolID">

export const ToolID = defineBrandedIdentifier("ToolID", "tool")

export const ToolBoolean = JsonBoolean
