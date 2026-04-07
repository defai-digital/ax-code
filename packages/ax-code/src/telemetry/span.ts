/**
 * Lightweight span helper for instrumenting code paths with OpenTelemetry.
 *
 * Usage:
 * ```ts
 * import { withSpan } from "@/telemetry/span"
 *
 * const result = await withSpan("tool.edit", { file: path }, async (span) => {
 *   const content = await fs.readFile(path)
 *   span.setAttribute("file.size", content.length)
 *   return applyEdit(content, edit)
 * })
 * ```
 *
 * When OTel is not enabled, the function runs without tracing overhead.
 */

import { Telemetry } from "./index"

type Span = {
  setAttribute(key: string, value: string | number | boolean): void
  setStatus(status: { code: number; message?: string }): void
  end(): void
}

const noop: Span = {
  setAttribute() {},
  setStatus() {},
  end() {},
}

export async function withSpan<T>(
  name: string,
  attributes: Record<string, string | number | boolean>,
  fn: (span: Span) => Promise<T>,
): Promise<T> {
  if (!Telemetry.enabled()) return fn(noop)

  try {
    const { trace, SpanStatusCode } = await import("@opentelemetry/api")
    const tracer = trace.getTracer("ax-code")
    return tracer.startActiveSpan(name, { attributes }, async (span) => {
      try {
        const result = await fn(span)
        span.setStatus({ code: SpanStatusCode.OK })
        return result
      } catch (err) {
        span.setStatus({ code: SpanStatusCode.ERROR, message: err instanceof Error ? err.message : String(err) })
        throw err
      } finally {
        span.end()
      }
    })
  } catch {
    // OTel not available, run without tracing
    return fn(noop)
  }
}

/** Synchronous span variant for CPU-bound operations. */
export function withSpanSync<T>(
  name: string,
  attributes: Record<string, string | number | boolean>,
  fn: (span: Span) => T,
): T {
  // Sync spans can't lazily import OTel, so only instrument if already initialized
  if (!Telemetry.enabled()) return fn(noop)
  return fn(noop) // OTel sync spans require pre-initialized tracer; skip for simplicity
}
