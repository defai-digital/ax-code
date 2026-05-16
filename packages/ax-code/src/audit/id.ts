import { Schema } from "effect"
import z from "zod"

import { Identifier } from "@/id/id"
import { withStatics } from "@/util/schema"

export const AuditCallID = Schema.String.pipe(
  Schema.brand("AuditCallID"),
  withStatics((s) => ({
    make: (id: string) => s.makeUnsafe(id),
    ascending: (id?: string) => s.makeUnsafe(Identifier.ascending("audit_semantic_call", id)),
    zod: Identifier.schema("audit_semantic_call").pipe(z.custom<Schema.Schema.Type<typeof s>>()),
  })),
)
export type AuditCallID = Schema.Schema.Type<typeof AuditCallID>
