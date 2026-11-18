import { APICallError } from "ai"
import { parseJsonRecord } from "../util/json-record"
import { isRecord } from "../util/record"
import { eventData, mapSSEEvents } from "./sse-events"

export const AX_TRUST_STREAM_KEEPALIVE_HEADER = "x-ax-stream-keepalive"

export function normalizeAxTrustStream(response: Response): Response {
  if (!response.ok) return response
  return mapSSEEvents(response, (event) => {
    if (!event.includes('"error"')) return event
    const data = eventData(event)
    const error = parseJsonRecord(data)?.error
    if (!isRecord(error) || typeof error.message !== "string") return event

    // After early headers the gateway carries the would-be HTTP status in
    // the final SSE frame. A mid-stream timeout has no status in its frame.
    let status = error.status
    if (status === undefined && (error.code === "upstream_timeout" || error.code === "stream_timeout")) status = 504
    if (typeof status !== "number" || !Number.isInteger(status) || status < 400 || status > 599) return event
    const headers = Object.fromEntries(response.headers)
    const retryAfter = error.retry_after
    if (typeof retryAfter === "number" && Number.isSafeInteger(retryAfter) && retryAfter >= 0) {
      headers["retry-after"] = String(retryAfter)
    }
    throw new APICallError({
      message: error.message,
      url: response.url,
      requestBodyValues: undefined,
      statusCode: status,
      responseHeaders: headers,
      responseBody: data,
    })
  })
}
