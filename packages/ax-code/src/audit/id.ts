import { defineBrandedIdentifier, type BrandedIdentifier } from "@/id/branded"

export const AuditCallID = defineBrandedIdentifier("AuditCallID", "audit_semantic_call")
export type AuditCallID = BrandedIdentifier<"AuditCallID">
