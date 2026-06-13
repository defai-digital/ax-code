import { defineBrandedIdentifier, type BrandedIdentifier } from "@/id/branded"

export type EventLogID = BrandedIdentifier<"EventLogID">
export const EventLogID = defineBrandedIdentifier("EventLogID", "event")
