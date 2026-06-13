import { defineBrandedIdentifier, type BrandedIdentifier } from "@/id/branded"

// Branded IDs for debug-engine entities. Mirrors code-intelligence/id.ts.
// Each ID carries its entity kind in the prefix (`refactor_plan`,
// `embedding_cache`) so a raw string is self-describing.

export const RefactorPlanID = defineBrandedIdentifier("RefactorPlanID", "refactor_plan")
export type RefactorPlanID = BrandedIdentifier<"RefactorPlanID">

export const EmbeddingCacheID = defineBrandedIdentifier("EmbeddingCacheID", "embedding_cache")
export type EmbeddingCacheID = BrandedIdentifier<"EmbeddingCacheID">

export const DebugPatternID = defineBrandedIdentifier("DebugPatternID", "debug_pattern")
export type DebugPatternID = BrandedIdentifier<"DebugPatternID">
