import { defineBrandedIdentifier, type BrandedIdentifier } from "@/id/branded"

export const WorkspaceID = defineBrandedIdentifier("WorkspaceID", "workspace")

export type WorkspaceID = BrandedIdentifier<"WorkspaceID">
