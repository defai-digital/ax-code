import { Schema } from "effect"
import z from "zod"

import { Identifier } from "@/id/id"
import { withStatics } from "@/util/schema"

// Branded IDs for code graph entities. Each ID carries its entity kind in
// the prefix so we can tell at a glance whether a string is a node, edge,
// or file ID. Mirrors the Identifier helper used by event logs, sessions,
// and projects.

export const CodeNodeID = Schema.String.pipe(
  Schema.brand("CodeNodeID"),
  withStatics((s) => ({
    make: (id: string) => s.makeUnsafe(id),
    ascending: (id?: string) => s.makeUnsafe(Identifier.ascending("code_node", id)),
    zod: Identifier.schema("code_node").pipe(z.custom<Schema.Schema.Type<typeof s>>()),
  })),
)
export type CodeNodeID = Schema.Schema.Type<typeof CodeNodeID>

export const CodeEdgeID = Schema.String.pipe(
  Schema.brand("CodeEdgeID"),
  withStatics((s) => ({
    make: (id: string) => s.makeUnsafe(id),
    ascending: (id?: string) => s.makeUnsafe(Identifier.ascending("code_edge", id)),
    zod: Identifier.schema("code_edge").pipe(z.custom<Schema.Schema.Type<typeof s>>()),
  })),
)
export type CodeEdgeID = Schema.Schema.Type<typeof CodeEdgeID>

export const CodeFileID = Schema.String.pipe(
  Schema.brand("CodeFileID"),
  withStatics((s) => ({
    make: (id: string) => s.makeUnsafe(id),
    ascending: (id?: string) => s.makeUnsafe(Identifier.ascending("code_file", id)),
    zod: Identifier.schema("code_file").pipe(z.custom<Schema.Schema.Type<typeof s>>()),
  })),
)
export type CodeFileID = Schema.Schema.Type<typeof CodeFileID>
