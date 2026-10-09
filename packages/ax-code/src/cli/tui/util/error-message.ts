import { parseJsonRecord } from "@/util/json-record"

function nonEmptyString(value: unknown) {
  return typeof value === "string" && value.length > 0 ? value : undefined
}

export function errorPayloadMessage(value: unknown): string | undefined {
  if (!value || typeof value !== "object") return undefined
  const payload = value as {
    message?: unknown
    error?: unknown
    data?: {
      message?: unknown
    }
  }

  const message = nonEmptyString(payload.message)
  if (message) return message

  const error = nonEmptyString(payload.error)
  if (error) return error

  if (payload.error && typeof payload.error === "object") {
    const nested = payload.error as {
      message?: unknown
      data?: {
        message?: unknown
      }
    }
    return nonEmptyString(nested.message) ?? nonEmptyString(nested.data?.message)
  }

  return nonEmptyString(payload.data?.message)
}

export function unknownErrorMessage(error: unknown, fallback = "An error occurred") {
  if (!error) return fallback
  const payloadMessage = errorPayloadMessage(error)
  if (payloadMessage) return payloadMessage
  try {
    return String(error)
  } catch {
    return fallback
  }
}

export function textErrorMessage(text: string) {
  if (!text) return undefined
  return errorPayloadMessage(parseJsonRecord(text)) ?? text
}

// Dialog error renderer for SDK/API rejections: Error message, plain string,
// or a message buried in an error payload; anything else falls back.
export function requestErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error) return error.message
  const text = nonEmptyString(error)
  if (text) return text
  if (!error || typeof error !== "object") return fallback
  return errorPayloadMessage(error) ?? fallback
}

export async function responseErrorMessage(response: Pick<Response, "status" | "text">) {
  const text = await response.text().catch(() => "")
  return textErrorMessage(text) ?? `Request failed with status ${response.status}`
}

// The v2 SDK client resolves { error } instead of rejecting when throwOnError
// is unset (the default here), so a reply/reject's HTTP/network failure lands
// in the success `.then`, not `.catch`. Turn a resolved error into a throw
// carrying the best available message so the existing `.catch` path (reset
// guard, log, toast, keep prompt mounted for retry) handles it.
export function replyError(error: unknown, fallback: string): Error {
  if (error instanceof Error) return error
  const fromPayload = errorPayloadMessage(error)
  if (fromPayload) return new Error(fromPayload)
  if (typeof error === "string" && error.length > 0) return new Error(error)
  return new Error(fallback)
}
