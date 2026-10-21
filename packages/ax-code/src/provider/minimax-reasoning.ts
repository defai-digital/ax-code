import { modelIdFinalSegment } from "./model-id"
import { isRecord } from "../util/record"
import { parseJsonResult } from "../util/json-value"

// SDK instances are cached across models. Inspect each request before body
// compression rather than capturing the model that first created the SDK.
export function isMiniMaxM3ChatRequest(npm: string, body: unknown): boolean {
  if (npm !== "@ai-sdk/openai-compatible" || typeof body !== "string") return false
  const parsed = parseJsonResult(body)
  if (!parsed.ok || !isRecord(parsed.value) || typeof parsed.value.model !== "string") return false
  return /^minimax-m3$/i.test(modelIdFinalSegment(parsed.value.model)) && parsed.value.stream === true
}

function normalizeEvent(event: string): string {
  const lines = event.split(/\r\n|\r|\n/)
  const data = lines.filter((line) => line.startsWith("data:")).map((line) => line.slice(5).replace(/^ /, ""))
  const parsed = parseJsonResult(data.join("\n"))
  if (!parsed.ok || !isRecord(parsed.value) || !Array.isArray(parsed.value.choices)) return event
  let changed = false
  for (const choice of parsed.value.choices) {
    if (!isRecord(choice) || !isRecord(choice.delta)) continue
    const delta = choice.delta
    // MiniMax can emit both fields for the same text. Prefer SDK-native
    // text to avoid duplicating reasoning; empty fields still need the fallback.
    if (
      (delta.reasoning_content != null && delta.reasoning_content !== "") ||
      (delta.reasoning != null && delta.reasoning !== "") ||
      !Array.isArray(delta.reasoning_details)
    )
      continue
    const text = delta.reasoning_details
      .flatMap((detail) =>
        isRecord(detail) && detail.type === "reasoning.text" && typeof detail.text === "string" ? [detail.text] : [],
      )
      .join("")
    if (!text) continue
    delta.reasoning_content = text
    changed = true
  }
  if (!changed) return event
  // Preserve SSE metadata/comments while replacing the data payload.
  return [...lines.filter((line) => !line.startsWith("data:")), `data: ${JSON.stringify(parsed.value)}`].join("\n")
}

/** MiniMax M3 split reasoning fallback, before the SDK drops unknown fields. */
export function normalizeMiniMaxReasoning(response: Response, enabled: boolean): Response {
  if (!enabled || !response.body || !response.headers.get("content-type")?.includes("text/event-stream"))
    return response
  let pending = ""
  const body = response.body
    .pipeThrough(new TextDecoderStream())
    .pipeThrough(
      new TransformStream<string, string>({
        transform(chunk, controller) {
          pending += chunk
          let boundary: RegExpExecArray | null
          while ((boundary = /\r\n\r\n|\n\n|\r\r/.exec(pending))) {
            controller.enqueue(normalizeEvent(pending.slice(0, boundary.index)) + boundary[0])
            pending = pending.slice(boundary.index + boundary[0].length)
          }
        },
        flush(controller) {
          if (pending) controller.enqueue(normalizeEvent(pending))
        },
      }),
    )
    .pipeThrough(new TextEncoderStream())
  const headers = new Headers(response.headers)
  headers.delete("content-length")
  return new Response(body, { status: response.status, statusText: response.statusText, headers })
}
