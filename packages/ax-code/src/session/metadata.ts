import z from "zod"

export namespace SessionMetadata {
  export const MAX_PRODUCT_METADATA_BYTES = 8 * 1024

  const ID = z.string().min(1).max(160)
  const OptionalID = ID.optional()

  export const Queue = z
    .object({
      queueItemId: OptionalID,
      groupId: OptionalID,
      source: z.enum(["manual", "scheduled", "workflow", "multi-run"]).optional(),
    })
    .strict()
    .meta({ ref: "QueueSessionMetadata" })
  export type Queue = z.output<typeof Queue>

  export const MultiRun = z
    .object({
      groupId: ID,
      variantId: ID,
      model: OptionalID,
      agent: OptionalID,
      worktree: z.string().min(1).max(4096).optional(),
    })
    .strict()
    .meta({ ref: "MultiRunSessionMetadata" })
  export type MultiRun = z.output<typeof MultiRun>

  export const Automation = z
    .object({
      taskId: ID,
      runId: OptionalID,
      owner: z.enum(["sidecar", "attached-backend"]),
    })
    .strict()
    .meta({ ref: "AutomationSessionMetadata" })
  export type Automation = z.output<typeof Automation>

  export const Review = z
    .object({
      reviewId: OptionalID,
      baseline: z.string().min(1).max(4096).optional(),
    })
    .strict()
    .meta({ ref: "ReviewSessionMetadata" })
  export type Review = z.output<typeof Review>

  export const App = z
    .object({
      pinned: z.boolean().optional(),
      label: z.string().min(1).max(160).optional(),
    })
    .strict()
    .meta({ ref: "AppSessionMetadata" })
  export type App = z.output<typeof App>

  export const Product = z
    .object({
      queue: Queue.optional(),
      multiRun: MultiRun.optional(),
      automation: Automation.optional(),
      review: Review.optional(),
      app: App.optional(),
    })
    .strict()
    .meta({ ref: "SessionProductMetadata" })
  export type Product = z.output<typeof Product>

  export const Namespace = z.enum(["queue", "multiRun", "automation", "review", "app"])
  export type Namespace = z.output<typeof Namespace>

  const namespaceSchemas = {
    queue: Queue,
    multiRun: MultiRun,
    automation: Automation,
    review: Review,
    app: App,
  } satisfies Record<Namespace, z.ZodType>

  export const Metadata = z
    .record(z.string(), z.unknown())
    .superRefine((metadata, ctx) => {
      const product = productOnly(metadata)
      const encoded = JSON.stringify(product)
      const bytes = encoded ? Buffer.byteLength(encoded, "utf8") : 0
      if (bytes > MAX_PRODUCT_METADATA_BYTES) {
        ctx.addIssue({
          code: "custom",
          message: `Reserved session metadata is too large: ${bytes} bytes (max ${MAX_PRODUCT_METADATA_BYTES})`,
        })
      }

      for (const issue of unsafeKeyIssues(product)) {
        ctx.addIssue({
          code: "custom",
          path: issue.path,
          message: `Reserved session metadata must not contain unsafe key "${issue.key}"`,
        })
      }

      for (const namespace of Namespace.options) {
        if (!(namespace in metadata)) continue
        const parsed = namespaceSchemas[namespace].safeParse(metadata[namespace])
        if (parsed.success) continue
        for (const issue of parsed.error.issues) {
          ctx.addIssue({
            ...issue,
            path: [namespace, ...issue.path],
          })
        }
      }
    })
    .meta({ ref: "SessionMetadata" })
  export type Metadata = z.output<typeof Metadata>

  export function validate(metadata: Record<string, unknown>): Metadata {
    return Metadata.parse(metadata)
  }

  export function product(metadata: Record<string, unknown> | undefined): Product {
    return Product.parse(productOnly(metadata ?? {}))
  }

  export function mergeNamespace(
    metadata: Record<string, unknown> | undefined,
    namespace: Namespace,
    value: unknown | undefined,
  ): Metadata {
    const next = { ...(metadata ?? {}) }
    if (value === undefined) {
      delete next[namespace]
    } else {
      next[namespace] = namespaceSchemas[namespace].parse(value)
    }
    return validate(next)
  }

  function productOnly(metadata: Record<string, unknown>): Partial<Record<Namespace, unknown>> {
    const result: Partial<Record<Namespace, unknown>> = {}
    for (const namespace of Namespace.options) {
      if (namespace in metadata) result[namespace] = metadata[namespace]
    }
    return result
  }

  function unsafeKeyIssues(
    input: unknown,
    path: Array<string | number> = [],
  ): Array<{ path: Array<string | number>; key: string }> {
    if (!input || typeof input !== "object") return []
    if (Array.isArray(input)) {
      return input.flatMap((item, index) => unsafeKeyIssues(item, [...path, index]))
    }
    const issues: Array<{ path: Array<string | number>; key: string }> = []
    for (const [key, value] of Object.entries(input)) {
      if (isUnsafeKey(key)) issues.push({ path: [...path, key], key })
      issues.push(...unsafeKeyIssues(value, [...path, key]))
    }
    return issues
  }

  function isUnsafeKey(key: string) {
    return /^(token|secret|password|api[_-]?key|authorization|authHeader|rawPrompt|prompt|diff|artifact|cache)$/i.test(
      key,
    )
  }
}
