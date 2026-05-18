/**
 * @deprecated Effect-Schema helpers. New code should not import from
 * here. Per ARCHITECTURE.md, Effect is frozen outside src/effect/,
 * src/session/, src/file/watcher.ts, and src/util/effect-zod.ts. Use Zod
 * (`z.object()`) for all new schema work; use the existing effect-zod
 * bridge if you need to interoperate with legacy Effect-Schema IDs.
 */
import { Schema } from "effect"

/**
 * Attach static methods to a schema object. Designed to be used with `.pipe()`:
 *
 * @example
 *   export const Foo = fooSchema.pipe(
 *     withStatics((schema) => ({
 *       zero: schema.makeUnsafe(0),
 *       from: Schema.decodeUnknownOption(schema),
 *     }))
 *   )
 */
export const withStatics =
  <S extends object, M extends Record<string, unknown>>(methods: (schema: S) => M) =>
  (schema: S): S & M =>
    Object.assign(schema, methods(schema))

declare const NewtypeBrand: unique symbol
type NewtypeBrand<Tag extends string> = { readonly [NewtypeBrand]: Tag }

/**
 * Nominal wrapper for scalar types. The class itself is a valid schema —
 * pass it directly to `Schema.decode`, `Schema.decodeEffect`, etc.
 *
 * @example
 *   class QuestionID extends Newtype<QuestionID>()("QuestionID", Schema.String) {
 *     static make(id: string): QuestionID {
 *       return this.makeUnsafe(id)
 *     }
 *   }
 *
 *   Schema.decodeEffect(QuestionID)(input)
 */
export function Newtype<Self>() {
  return <const Tag extends string, S extends Schema.Top>(tag: Tag, schema: S) => {
    type Branded = NewtypeBrand<Tag>

    abstract class Base {
      declare readonly [NewtypeBrand]: Tag

      static makeUnsafe(value: Schema.Schema.Type<S>): Self {
        return value as unknown as Self
      }
    }

    Object.setPrototypeOf(Base, schema)

    return Base as unknown as (abstract new (_: never) => Branded) & {
      readonly makeUnsafe: (value: Schema.Schema.Type<S>) => Self
    } & Omit<Schema.Opaque<Self, S, {}>, "makeUnsafe">
  }
}
