import z from "zod"
import { GRAPH_LIMITS } from "@ax-code/ax-wiki/graph"

const freshness = z.enum(["fresh", "stale", "unknown"])
const contentHash = z.string().regex(/^[a-f0-9]{64}$/)
const count = z.number().int().nonnegative()
const provenance = z.enum(["verified", "inferred", "unavailable"])
const symbolAnchor = z.object({ name: z.string().max(GRAPH_LIMITS.symbolName), provenance })

/** OpenAPI wire description; semantic validation remains in ax-wiki/graph. */
export const WikiGraphSchema = z
  .object({
    schemaVersion: z.literal(1),
    snapshot: z.string().max(128),
    scope: z.literal("wiki-manifest"),
    codeRelationships: z.literal("unavailable"),
    nodes: z
      .array(
        z.object({
          id: z.string().max(1100),
          kind: z.enum(["page", "source", "symbol"]),
          label: z.string().max(1024),
          path: z.string().max(1024),
          freshness,
          recordedReferences: count.max(GRAPH_LIMITS.references),
          observedHash: contentHash.optional(),
          summary: z.string().max(GRAPH_LIMITS.summary),
          symbols: z.array(symbolAnchor).max(GRAPH_LIMITS.symbolsPerNode),
          detail: z.string().max(GRAPH_LIMITS.detail),
          qualified: z.string().max(GRAPH_LIMITS.qualified),
        }),
      )
      .max(GRAPH_LIMITS.nodes),
    edges: z
      .array(
        z.object({
          from: z.string().max(1100),
          to: z.string().max(1100),
          kind: z.union([z.literal("references-source"), z.literal("contains")]),
          freshness,
          recordedHash: contentHash.optional(),
        }),
      )
      .max(GRAPH_LIMITS.edges),
    omitted: z.object({ nodes: count, edges: count }),
  })
  .meta({ ref: "WikiVisualizationGraph" })
