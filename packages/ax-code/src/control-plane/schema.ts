import { Schema } from "effect"
import z from "zod"

import { Identifier } from "@/id/id"
import { withStatics } from "@/util/schema"

export const WorkspaceID = Schema.String.pipe(
  Schema.brand("WorkspaceID"),
  withStatics((s) => ({
    make: (id: string) => s.makeUnsafe(id),
    ascending: (id?: string) => s.makeUnsafe(Identifier.ascending("workspace", id)),
    zod: Identifier.schema("workspace").pipe(z.custom<Schema.Schema.Type<typeof s>>()),
  })),
)

export type WorkspaceID = Schema.Schema.Type<typeof WorkspaceID>
