import z from "zod"
import { Identifier } from "@ax-code/util/identifier"

// Branded identifier machinery for @ax-code/ax-code-reason.
//
// Mirrors the core's defineBrandedIdentifier shape, but the prefix lives
// with the definition: the package must not depend on the core id module.
// IDs keep the core-compatible `<prefix>_<base62>` format (rpl_/ebc_/dpt_)
// so values round-trip across the package boundary unchanged.
//
// Cross-boundary note: project IDs and graph node IDs cross the host port
// as plain strings, so ProjectID / CodeNodeID below are plain-string types
// (with a `make` helper for CodeNodeID), not nominal brands.

declare const BrandedIdentifier: unique symbol

export type BrandedIdentifier<Tag extends string> = string & {
  readonly [BrandedIdentifier]: Tag
}

export function defineBrandedIdentifier<const Tag extends string, const Prefix extends string>(
  tag: Tag,
  prefix: Prefix,
) {
  type ID = BrandedIdentifier<Tag>
  const schema = z
    .string()
    .startsWith(prefix + "_")
    .pipe(z.custom<ID>())

  return {
    make(id: string): ID {
      return id as ID
    },
    ascending(id?: string): ID {
      if (id !== undefined) {
        const parsed = schema.safeParse(id)
        if (!parsed.success) throw new Error(`ID ${id} does not start with ${prefix}_`)
        return parsed.data
      }
      return `${prefix}_${Identifier.ascending()}` as ID
    },
    descending(id?: string): ID {
      if (id !== undefined) {
        const parsed = schema.safeParse(id)
        if (!parsed.success) throw new Error(`ID ${id} does not start with ${prefix}_`)
        return parsed.data
      }
      return `${prefix}_${Identifier.descending()}` as ID
    },
    zod: schema,
    tag,
    prefix,
  } as const
}

// Project identity crosses the host port as a plain string.
export type ProjectID = string

// Graph node IDs cross the GraphPort as plain strings (hosts with nominal
// brands convert at the adapter boundary).
export type CodeNodeID = string
export const CodeNodeID = {
  make(id: string): CodeNodeID {
    return id
  },
}

// Branded IDs for engine entities. Each ID carries its entity kind in the
// prefix so a raw string is self-describing.
export const RefactorPlanID = defineBrandedIdentifier("RefactorPlanID", "rpl")
export type RefactorPlanID = BrandedIdentifier<"RefactorPlanID">

export const EmbeddingCacheID = defineBrandedIdentifier("EmbeddingCacheID", "ebc")
export type EmbeddingCacheID = BrandedIdentifier<"EmbeddingCacheID">

export const DebugPatternID = defineBrandedIdentifier("DebugPatternID", "dpt")
export type DebugPatternID = BrandedIdentifier<"DebugPatternID">
