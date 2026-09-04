import { defineBrandedIdentifier, type BrandedIdentifier } from "@/id/branded"

export const OperationPlanID = defineBrandedIdentifier("OperationPlanID", "operation_plan")
export type OperationPlanID = BrandedIdentifier<"OperationPlanID">

export const OperationJournalID = defineBrandedIdentifier("OperationJournalID", "operation_journal")
export type OperationJournalID = BrandedIdentifier<"OperationJournalID">

export const OperationTokenID = defineBrandedIdentifier("OperationTokenID", "operation_token")
export type OperationTokenID = BrandedIdentifier<"OperationTokenID">
