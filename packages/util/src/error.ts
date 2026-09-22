import z from "zod"

// Bounded fallback length for a serialized unknown record: enough to carry a
// deserialized error body, small enough that a huge object cannot flood a
// single log/UI line.
const UNKNOWN_RECORD_MESSAGE_MAX_LENGTH = 2048

/**
 * A readable one-line message for a non-Error object reaching an error
 * formatter — typically a deserialized NamedError body such as
 * `{ name: "SessionNotFoundError", data: { message: "Session not found: ..." } }`
 * rejected by an HTTP client. `String(record)` would render the useless
 * "[object Object]", so prefer the record's own message fields, then a
 * bounded JSON serialization.
 */
function describeUnknownRecord(error: object): string {
  const record = error as { name?: unknown; message?: unknown; data?: { message?: unknown } | null }
  const dataMessage = record.data?.message
  if (typeof dataMessage === "string" && dataMessage.length > 0) return dataMessage
  if (typeof record.message === "string" && record.message.length > 0) return record.message
  if (typeof record.name === "string" && record.name.length > 0) return record.name
  try {
    const serialized = JSON.stringify(error)
    if (typeof serialized === "string") {
      return serialized.length > UNKNOWN_RECORD_MESSAGE_MAX_LENGTH
        ? serialized.slice(0, UNKNOWN_RECORD_MESSAGE_MAX_LENGTH)
        : serialized
    }
  } catch {
    // Circular or otherwise unserializable — fall through.
  }
  return "[unserializable error]"
}

export abstract class NamedError extends Error {
  abstract schema(): z.core.$ZodType
  abstract toObject(): { name: string; data: any }

  static create<Name extends string, Data extends z.core.$ZodType>(name: Name, data: Data) {
    const schema = z
      .object({
        name: z.literal(name),
        data,
      })
      .meta({
        ref: name,
      })
    const result = class extends NamedError {
      public static readonly Schema = schema

      public override readonly name = name as Name

      constructor(
        public readonly data: z.input<Data>,
        options?: ErrorOptions,
      ) {
        // Prefer a human-readable `data.message` for Error.message so
        // generic consumers (logs, tool-error text, toErrorMessage) see
        // the description instead of the bare class name. The class name
        // remains available as `.name`.
        const detail = (data as { message?: unknown } | null | undefined)?.message
        super(typeof detail === "string" && detail.length > 0 ? detail : name, options)
        this.name = name
      }

      static isInstance(input: any): input is InstanceType<typeof result> {
        // typeof null === "object", and `"name" in null` throws — guard it out.
        return typeof input === "object" && input !== null && "name" in input && input.name === name
      }

      schema() {
        return schema
      }

      toObject() {
        return {
          name: name,
          data: this.data,
        }
      }
    }
    Object.defineProperty(result, "name", { value: name })
    return result
  }

  static message(error: unknown): string {
    if (error instanceof Error) return error.message
    if (typeof error === "object" && error !== null) return describeUnknownRecord(error)
    return String(error)
  }

  public static readonly Unknown = NamedError.create(
    "UnknownError",
    z.object({
      message: z.string(),
      // Optional bag for post-hoc annotations (e.g. compaction-fallback retry
      // metadata) so they survive schema re-validation on persistence.
      metadata: z.record(z.string(), z.string()).optional(),
    }),
  )
}
