import { defineBrandedIdentifier, type BrandedIdentifier } from "@/id/branded"

export type PermissionID = BrandedIdentifier<"PermissionID">

export const PermissionID = defineBrandedIdentifier("PermissionID", "permission")
