import { defineBrandedIdentifier, type BrandedIdentifier } from "@/id/branded"

export type ToolID = BrandedIdentifier<"ToolID">

export const ToolID = defineBrandedIdentifier("ToolID", "tool")
