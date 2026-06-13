import z from "zod"

import { Identifier } from "./id"

declare const BrandedIdentifier: unique symbol

export type BrandedIdentifier<Tag extends string> = string & {
  readonly [BrandedIdentifier]: Tag
}

export function defineBrandedIdentifier<const Tag extends string, const Prefix extends Identifier.Prefix>(
  tag: Tag,
  prefix: Prefix,
) {
  type ID = BrandedIdentifier<Tag>
  const schema = Identifier.schema(prefix).pipe(z.custom<ID>())

  return {
    make(id: string): ID {
      return id as ID
    },
    ascending(id?: string): ID {
      return Identifier.ascending(prefix, id) as ID
    },
    zod: schema,
    tag,
    prefix,
  } as const
}

export function defineBrandedString<const Tag extends string>(tag: Tag) {
  type ID = BrandedIdentifier<Tag>
  const schema = z.string().pipe(z.custom<ID>())

  return {
    make(id: string): ID {
      return id as ID
    },
    zod: schema,
    tag,
  } as const
}
