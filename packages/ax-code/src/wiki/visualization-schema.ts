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
          kind: z.union([z.literal("references-source"), z.literal("contains"), z.literal("uses")]),
          freshness,
          recordedHash: contentHash.optional(),
        }),
      )
      .max(GRAPH_LIMITS.edges),
    omitted: z.object({ nodes: count, edges: count }),
    pages: z
      .array(
        z.object({
          id: z.string().max(1100),
          path: z.string().max(1024),
          title: z.string().max(1024),
          purpose: z.string().max(GRAPH_LIMITS.summary),
          summary: z.string().max(GRAPH_LIMITS.summary),
          generatedAt: z.string().max(64),
          sources: z.array(z.string().max(1024)).max(GRAPH_LIMITS.sourcesPerPage),
          stale: count,
          unknown: count,
          changed: z.array(z.string().max(1024)).max(GRAPH_LIMITS.sourcesPerPage),
          unverified: z.array(z.string().max(1024)).max(GRAPH_LIMITS.sourcesPerPage).optional(),
          // Citations past `sourcesPerPage`, which `sources` cannot list. The
          // page's own state needs them: `stale`/`unknown` above describe the
          // listed list only.
          omitted: z.object({ sources: count, stale: count, unknown: count }),
          related: z.array(z.object({ id: z.string().max(1100), shared: count })).max(GRAPH_LIMITS.related),
          markdown: z.string().max(GRAPH_LIMITS.markdown),
          truncated: z.boolean(),
        }),
      )
      .max(GRAPH_LIMITS.pageInfos)
      .optional(),
    overview: z
      .object({
        generatedAt: z.string().max(64),
        repositoryHead: z.string().max(128),
        model: z.string().max(256),
        indexedSources: count,
        citedSources: count,
        areas: z.array(z.object({ path: z.string().max(1024), indexed: count, cited: count })).max(GRAPH_LIMITS.areas),
      })
      .optional(),
    modules: z
      .object({
        rule: z.string().max(256),
        groups: z.array(z.object({ path: z.string().max(1024), files: count })).max(GRAPH_LIMITS.moduleGroups),
        dependencies: z
          .array(z.object({ from: z.string().max(1024), to: z.string().max(1024), imports: count }))
          .max(GRAPH_LIMITS.moduleDependencies),
      })
      .optional(),
  })
  .meta({ ref: "WikiVisualizationGraph" })
