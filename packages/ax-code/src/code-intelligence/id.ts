import { defineBrandedIdentifier, type BrandedIdentifier } from "@/id/branded"

// Branded IDs for code graph entities. Each ID carries its entity kind in
// the prefix so we can tell at a glance whether a string is a node, edge,
// or file ID. Mirrors the Identifier helper used by event logs, sessions,
// and projects.

export const CodeNodeID = defineBrandedIdentifier("CodeNodeID", "code_node")
export type CodeNodeID = BrandedIdentifier<"CodeNodeID">

export const CodeEdgeID = defineBrandedIdentifier("CodeEdgeID", "code_edge")
export type CodeEdgeID = BrandedIdentifier<"CodeEdgeID">

export const CodeFileID = defineBrandedIdentifier("CodeFileID", "code_file")
export type CodeFileID = BrandedIdentifier<"CodeFileID">

export const LspCacheID = defineBrandedIdentifier("LspCacheID", "code_intel_lsp_cache")
export type LspCacheID = BrandedIdentifier<"LspCacheID">
