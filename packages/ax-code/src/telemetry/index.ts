import { Log } from "@/util/log"
import { EventQuery } from "@/replay/query"
import type { ReplayEvent } from "@/replay/event"
import type { SessionID } from "@/session/schema"
import { Ssrf } from "@/util/ssrf"

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
    return process.env.AX_CODE_OTLP_ENDPOINT
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

    const { trace } = await import("@opentelemetry/api")
    const tracer = trace.getTracer("ax-code")
    const events = EventQuery.bySession(sessionID)
    if (events.length === 0) return

    const stepFinishes = new Map<number, Extract<ReplayEvent, { type: "step.finish" }>>()
    const toolResults = new Map<string, Extract<ReplayEvent, { type: "tool.result" }>>()
    for (const event of events) {
      if (event.type === "step.finish" && !stepFinishes.has(event.stepIndex)) {
        stepFinishes.set(event.stepIndex, event)
      }
      if (event.type === "tool.result" && !toolResults.has(event.callID)) {
        toolResults.set(event.callID, event)
      }
    }

    const sessionSpan = tracer.startSpan("session", {
      attributes: { "session.id": sessionID },
    })

    for (const event of events) {
      switch (event.type) {
        case "session.start":
          sessionSpan.setAttribute("session.agent", event.agent)
          sessionSpan.setAttribute("session.model", event.model)
          sessionSpan.setAttribute("session.directory", event.directory)
          break
        case "step.start": {
          const stepSpan = tracer.startSpan(`step.${event.stepIndex}`, {
            attributes: { "step.index": event.stepIndex },
          })
          const finish = stepFinishes.get(event.stepIndex)
          if (finish && finish.type === "step.finish") {
            stepSpan.setAttribute("step.finish_reason", finish.finishReason)
            stepSpan.setAttribute("step.tokens.input", finish.tokens.input)
            stepSpan.setAttribute("step.tokens.output", finish.tokens.output)
          }
          stepSpan.end()
          break
        }
        case "tool.call": {
          const toolSpan = tracer.startSpan(`tool.${event.tool}`, {
            attributes: {
              "tool.name": event.tool,
              "tool.call_id": event.callID,
            },
          })
          const result = toolResults.get(event.callID)
          if (result && result.type === "tool.result") {
            toolSpan.setAttribute("tool.status", result.status)
            toolSpan.setAttribute("tool.duration_ms", result.durationMs)
            if (result.error) toolSpan.setAttribute("tool.error", result.error)
          }
          toolSpan.end()
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
          break
      }
    }

    sessionSpan.end()
    log.info("exported session as OTLP trace", { sessionID, events: events.length })
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
