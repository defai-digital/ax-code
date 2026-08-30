import { Log } from "@/util/log"
import { EventQuery } from "@/replay/query"
import type { ReplayEvent } from "@/replay/event"
import type { SessionID } from "@/session/schema"
import { Ssrf } from "@/util/ssrf"
import { Flag } from "@/flag/flag"

const log = Log.create({ service: "telemetry" })

/**
 * R23: OpenTelemetry OTLP export.
 *
 * Opt-in export of session trace spans to an external observability system.
 * Enable by setting AX_CODE_OTLP_ENDPOINT environment variable.
 *
 * Each session becomes a trace, each step becomes a span, tool calls become child spans.
 */
export namespace Telemetry {
  let provider: any
  let exporter: any
  let initialized = false
  let initPromise: Promise<void> | undefined

  export function endpoint(): string | undefined {
    return Flag.AX_CODE_OTLP_ENDPOINT
  }

  export function enabled(): boolean {
    return !!endpoint()
  }

  export async function init() {
    if (initialized || !enabled()) return
    if (initPromise) return initPromise
    initPromise = (async () => {
      try {
        const endpointUrl = endpoint()
        if (endpointUrl) {
          await Ssrf.assertPublicUrl(endpointUrl, "AX_CODE_OTLP_ENDPOINT")
        }
        const { NodeTracerProvider, SimpleSpanProcessor } = await import("@opentelemetry/sdk-trace-node")
        const { OTLPTraceExporter } = await import("@opentelemetry/exporter-trace-otlp-http")
        const { resourceFromAttributes } = await import("@opentelemetry/resources")
        const { ATTR_SERVICE_NAME, ATTR_SERVICE_VERSION } = await import("@opentelemetry/semantic-conventions")

        if (!endpointUrl) return
        exporter = new OTLPTraceExporter({
          url: endpointUrl,
          fetch: (url: string | URL, init?: RequestInit) =>
            Ssrf.pinnedFetch(url.toString(), { ...init, label: "AX_CODE_OTLP_ENDPOINT" }),
        } as any)
        provider = new NodeTracerProvider({
          resource: resourceFromAttributes({
            [ATTR_SERVICE_NAME]: "ax-code",
            [ATTR_SERVICE_VERSION]: typeof AX_CODE_VERSION === "string" ? AX_CODE_VERSION : "local",
          }),
          spanProcessors: [new SimpleSpanProcessor(exporter)],
        })
        provider.register()
        initialized = true
        log.info("OTLP telemetry initialized", { endpoint: endpointUrl })
      } catch (e) {
        log.warn("failed to initialize OTLP telemetry", { error: e })
      } finally {
        initPromise = undefined
      }
    })()
    return initPromise
  }

  /** Export a session's events as OTLP trace spans */
  export async function exportSession(sessionID: SessionID) {
    if (!initialized) await init()
    if (!initialized) return

    const { trace, context } = await import("@opentelemetry/api")
    const tracer = trace.getTracer("ax-code")
    // Exported sessions are historical (this is a batch/backfill export, see
    // `ax-code audit otlp`, often run long after the session finished) so span
    // start/end times must come from the recorded event timestamps. Using
    // `bySession` (no timestamp) previously left every span's start/end at
    // whatever instant `startSpan`/`end()` defaulted to (export time), which
    // collapsed the entire trace into a single moment and destroyed all
    // duration/latency information — the whole point of exporting a trace.
    const rows = EventQuery.bySessionWithTimestamp(sessionID)
    if (rows.length === 0) return

    const stepFinishes = new Map<number, { event: Extract<ReplayEvent, { type: "step.finish" }>; time: number }>()
    const toolResults = new Map<string, { event: Extract<ReplayEvent, { type: "tool.result" }>; time: number }>()
    for (const row of rows) {
      const event = row.event_data
      if (event.type === "step.finish" && !stepFinishes.has(event.stepIndex)) {
        stepFinishes.set(event.stepIndex, { event, time: row.time_created })
      }
      if (event.type === "tool.result" && !toolResults.has(event.callID)) {
        toolResults.set(event.callID, { event, time: row.time_created })
      }
    }

    const sessionStart = rows[0].time_created
    const sessionEnd = rows[rows.length - 1].time_created
    const sessionSpan = tracer.startSpan("session", {
      attributes: { "session.id": sessionID },
      startTime: sessionStart,
    })
    const sessionCtx = trace.setSpan(context.active(), sessionSpan)
    // Tool spans nest under the most recent step span (falling back to the
    // session span for tool calls seen before any step).
    let stepCtx = sessionCtx

    for (const row of rows) {
      const event = row.event_data
      const time = row.time_created
      switch (event.type) {
        case "session.start":
          sessionSpan.setAttribute("session.agent", event.agent)
          sessionSpan.setAttribute("session.model", event.model)
          sessionSpan.setAttribute("session.directory", event.directory)
          break
        case "step.start": {
          const stepSpan = tracer.startSpan(
            `step.${event.stepIndex}`,
            {
              attributes: { "step.index": event.stepIndex },
              startTime: time,
            },
            sessionCtx,
          )
          const finish = stepFinishes.get(event.stepIndex)
          if (finish) {
            stepSpan.setAttribute("step.finish_reason", finish.event.finishReason)
            stepSpan.setAttribute("step.tokens.input", finish.event.tokens.input)
            stepSpan.setAttribute("step.tokens.output", finish.event.tokens.output)
          }
          stepSpan.end(finish ? finish.time : time)
          stepCtx = trace.setSpan(sessionCtx, stepSpan)
          break
        }
        case "tool.call": {
          const result = toolResults.get(event.callID)
          const toolSpan = tracer.startSpan(
            `tool.${event.tool}`,
            {
              attributes: {
                "tool.name": event.tool,
                "tool.call_id": event.callID,
              },
              startTime: time,
            },
            stepCtx,
          )
          if (result) {
            toolSpan.setAttribute("tool.status", result.event.status)
            toolSpan.setAttribute("tool.duration_ms", result.event.durationMs)
            if (result.event.error) toolSpan.setAttribute("tool.error", result.event.error)
          }
          toolSpan.end(result ? result.time : time)
          break
        }
        case "error":
          sessionSpan.setAttribute("error", true)
          sessionSpan.setAttribute("error.type", event.errorType)
          sessionSpan.setAttribute("error.message", event.message)
          break
        case "session.end":
          sessionSpan.setAttribute("session.reason", event.reason)
          sessionSpan.setAttribute("session.total_steps", event.totalSteps)
          if (event.stopCode) sessionSpan.setAttribute("session.stop_code", event.stopCode)
          break
      }
    }

    sessionSpan.end(sessionEnd)
    log.info("exported session as OTLP trace", { sessionID, events: rows.length })
  }

  export async function shutdown() {
    if (initPromise) await initPromise
    if (!initialized) return
    try {
      await exporter?.shutdown?.()
      await provider?.shutdown?.()
      provider = undefined
      exporter = undefined
      initialized = false
      log.info("OTLP telemetry shutdown")
    } catch (e) {
      log.warn("OTLP shutdown error", { error: e })
    }
  }
}

declare const AX_CODE_VERSION: string | undefined
