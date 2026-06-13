import { defineBrandedIdentifier, type BrandedIdentifier } from "@/id/branded"

export type PtyID = BrandedIdentifier<"PtyID">

export const PtyID = defineBrandedIdentifier("PtyID", "pty")
