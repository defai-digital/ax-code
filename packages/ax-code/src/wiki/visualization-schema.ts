import z from "zod"
import { GRAPH_LIMITS } from "@ax-code/ax-wiki/graph"

const freshness = z.enum(["fresh", "stale", "unknown"])
const contentHash = z.string().regex(/^[a-f0-9]{64}$/)
const count = z.number().int().nonnegative()

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
          kind: z.enum(["page", "source"]),
          label: z.string().max(1024),
          path: z.string().max(1024),
          freshness,
          recordedReferences: count.max(GRAPH_LIMITS.references),
          observedHash: contentHash.optional(),
        }),
      )
      .max(GRAPH_LIMITS.nodes),
    edges: z
      .array(
        z.object({
          from: z.string().max(1100),
          to: z.string().max(1100),
          kind: z.literal("references-source"),
          freshness,
          recordedHash: contentHash.optional(),
        }),
      )
      .max(GRAPH_LIMITS.edges),
    omitted: z.object({ nodes: count, edges: count }),
  })
  .meta({ ref: "WikiVisualizationGraph" })
