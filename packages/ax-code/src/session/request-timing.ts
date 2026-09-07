import type { LanguageModelV3Middleware, LanguageModelV3StreamPart } from "@ai-sdk/provider"
import z from "zod"

/** Optional local profiling at the provider adapter boundary, before SDK tool execution. */
export namespace RequestTiming {
  export const Info = z.object({
    boundary: z.literal("provider-adapter"),
    attempt: z.number().int().positive(),
    setupMs: z.number().nonnegative(),
    firstContentMs: z.number().nonnegative().optional(),
    firstTextMs: z.number().nonnegative().optional(),
    streamMs: z.number().nonnegative().optional(),
  })
  export type Info = z.infer<typeof Info>

  export function create(now = () => performance.now()) {
    const enteredAt = now()
    let latest: Info | undefined
    const middleware: LanguageModelV3Middleware = {
      specificationVersion: "v3",
      async wrapStream({ doStream }) {
        const dispatchedAt = now()
        const timing: Info = {
          boundary: "provider-adapter",
          attempt: (latest?.attempt ?? 0) + 1,
          // On retry this includes earlier attempts and SDK backoff since entry.
          setupMs: dispatchedAt - enteredAt,
        }
        latest = timing
        const result = await doStream()
        return {
          ...result,
          stream: result.stream.pipeThrough(
            new TransformStream<LanguageModelV3StreamPart, LanguageModelV3StreamPart>({
              transform(part, controller) {
                const elapsed = now() - dispatchedAt
                const delta =
                  part.type === "text-delta" || part.type === "reasoning-delta" || part.type === "tool-input-delta"
                if ((delta && part.delta.length > 0) || part.type === "tool-call") {
                  timing.firstContentMs ??= elapsed
                }
                if (part.type === "text-delta" && part.delta.length > 0) timing.firstTextMs ??= elapsed
                if (part.type === "finish") timing.streamMs ??= elapsed
                controller.enqueue(part)
              },
            }),
          ),
        }
      },
    }
    return { middleware, snapshot: () => (latest ? { ...latest } : undefined) }
  }
}
