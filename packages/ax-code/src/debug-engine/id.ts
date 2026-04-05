import { Schema } from "effect"
import z from "zod"

import { Identifier } from "@/id/id"
import { withStatics } from "@/util/schema"

// Branded IDs for debug-engine entities. Mirrors code-intelligence/id.ts.
// Each ID carries its entity kind in the prefix (`refactor_plan`,
// `embedding_cache`) so a raw string is self-describing.

export const RefactorPlanID = Schema.String.pipe(
  Schema.brand("RefactorPlanID"),
  withStatics((s) => ({
    make: (id: string) => s.makeUnsafe(id),
    ascending: (id?: string) => s.makeUnsafe(Identifier.ascending("refactor_plan", id)),
    zod: Identifier.schema("refactor_plan").pipe(z.custom<Schema.Schema.Type<typeof s>>()),
  })),
)
export type RefactorPlanID = Schema.Schema.Type<typeof RefactorPlanID>

export const EmbeddingCacheID = Schema.String.pipe(
  Schema.brand("EmbeddingCacheID"),
  withStatics((s) => ({
    make: (id: string) => s.makeUnsafe(id),
    ascending: (id?: string) => s.makeUnsafe(Identifier.ascending("embedding_cache", id)),
    zod: Identifier.schema("embedding_cache").pipe(z.custom<Schema.Schema.Type<typeof s>>()),
  })),
)
export type EmbeddingCacheID = Schema.Schema.Type<typeof EmbeddingCacheID>
