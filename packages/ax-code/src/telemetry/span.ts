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

import { createRequire } from "node:module"
import { Telemetry } from "./index"
import { Log } from "@/util/log"
import { toErrorMessage } from "../util/error-message"

const log = Log.create({ service: "telemetry-span" })
const require = createRequire(import.meta.url)

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
        span.setStatus({ code: SpanStatusCode.ERROR, message: toErrorMessage(err) })
        throw err
      } finally {
        try {
          span.end()
        } catch {}
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
  if (!Telemetry.enabled()) return fn(noop)

  // Only OTel setup (module load / tracer / span creation) falls back to a
  // noop span here. `fn` must not be reachable from this try: if it were,
  // an error `fn` throws would be caught by this same block (after already
  // being rethrown below) and `fn` would run a second time via the
  // `fn(noop)` fallback — silently double-executing side effects and
  // replacing the original error with whatever the second run produces.
  let span: Span
  let SpanStatusCode: { OK: number; ERROR: number }
  try {
    const otel = require("@opentelemetry/api")
    SpanStatusCode = otel.SpanStatusCode
    const tracer = otel.trace.getTracer("ax-code")
    span = tracer.startSpan(name, { attributes })
  } catch {
    log.warn("withSpanSync telemetry support unavailable; falling back to noop")
    return fn(noop)
  }

  try {
    const result = fn(span)
    span.setStatus({ code: SpanStatusCode.OK })
    return result
  } catch (err) {
    span.setStatus({ code: SpanStatusCode.ERROR, message: toErrorMessage(err) })
    throw err
  } finally {
    span.end()
  }
}
