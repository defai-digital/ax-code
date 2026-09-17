import z from "zod"
import { MessageV2 } from "../session/message-v2"

/**
 * Shared contract for caller-supplied subagent output schemas.
 *
 * Delegated work is only machine-checkable if the caller can state the shape it
 * expects and the runtime can prove the child satisfied it. Both `task` and
 * `task_parallel` reuse this module so validation, the mapping onto the
 * existing structured-output turn, and result extraction cannot drift apart.
 *
 * The schema is validated at the TOOL BOUNDARY, before any child session is
 * created: a malformed schema must fail fast rather than cost a full subagent
 * run and then silently degrade to prose.
 */
export namespace TaskOutputSchema {
  // A caller-supplied schema is input, so bounds are deliberate: 64KiB matches
  // the skill sidecar ceiling, and the depth cap stops a pathological nested
  // document from making validation itself the expensive part.
  export const MAX_SERIALIZED_BYTES = 64 * 1024
  export const MAX_DEPTH = 32

  /**
   * Returns a human-readable problem when the schema is unusable, or undefined
   * when it is acceptable. Never throws: callers surface the message through
   * their own schema/permission channel.
   */
  export function inspect(schema: unknown): string | undefined {
    if (typeof schema !== "object" || schema === null || Array.isArray(schema)) {
      return "output_schema must be a JSON Schema object"
    }

    let serialized: string | undefined
    try {
      serialized = JSON.stringify(schema)
    } catch {
      return "output_schema must be JSON-serializable"
    }
    if (serialized === undefined) return "output_schema must be JSON-serializable"

    const bytes = Buffer.byteLength(serialized, "utf8")
    if (bytes > MAX_SERIALIZED_BYTES) {
      return `output_schema exceeds ${MAX_SERIALIZED_BYTES} bytes (got ${bytes})`
    }

    const stack: Array<{ value: unknown; depth: number }> = [{ value: schema, depth: 1 }]
    while (stack.length > 0) {
      const current = stack.pop()
      if (!current) break
      if (current.depth > MAX_DEPTH) return `output_schema nesting exceeds ${MAX_DEPTH} levels`

      const value = current.value
      if (Array.isArray(value)) {
        for (const item of value) stack.push({ value: item, depth: current.depth + 1 })
        continue
      }
      if (typeof value !== "object" || value === null) continue

      const record = value as Record<string, unknown>
      // Local `#/...` pointers stay resolvable inside the schema itself;
      // anything else would require a network or filesystem fetch that the
      // provider-side validator does not perform.
      const ref = record.$ref
      if (typeof ref === "string" && !ref.startsWith("#")) {
        return `output_schema must not use external $ref ("${ref.slice(0, 80)}")`
      }
      for (const child of Object.values(record)) stack.push({ value: child, depth: current.depth + 1 })
    }

    return undefined
  }

  /** Maps an inspected schema onto the runtime's existing structured-output format. */
  export function toFormat(schema: Record<string, unknown>): MessageV2.OutputFormat {
    return { type: "json_schema", schema, retryCount: 2 }
  }

  /**
   * Extracts the captured structured value from a finished subagent turn.
   * Returns undefined when the child produced no structured output, which is
   * distinct from a captured `null`/`false`/`0` value.
   */
  export function fromResult(result: { info: { role: string; structured?: unknown } }): unknown | undefined {
    if (result.info.role !== "assistant") return undefined
    return result.info.structured
  }

  /** Renders the captured value as a delimited block for the parent model. */
  export function render(value: unknown): string {
    return ["<task_structured_output>", JSON.stringify(value, null, 2) ?? "null", "</task_structured_output>"].join(
      "\n",
    )
  }

  /**
   * Zod fragment for the tool parameter. Refinement runs during tool-argument
   * parsing, so an invalid schema is rejected before execution begins.
   */
  export const Parameter = z
    .record(z.string(), z.any())
    .describe(
      "Optional JSON Schema the subagent must return as its final result. The captured value is returned in the " +
        "task result metadata as `structured` and echoed in a <task_structured_output> block. The schema must be a " +
        "JSON object; external $ref is rejected. Not supported with background: true.",
    )
    .superRefine((schema, ctx) => {
      const problem = inspect(schema)
      if (problem) ctx.addIssue({ code: z.ZodIssueCode.custom, message: problem })
    })
}
