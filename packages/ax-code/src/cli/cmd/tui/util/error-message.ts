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
  return errorPayloadMessage(error) ?? String(error)
}

export function textErrorMessage(text: string) {
  if (!text) return undefined
  return errorPayloadMessage(parseJsonRecord(text)) ?? text
}

export async function responseErrorMessage(response: Pick<Response, "status" | "text">) {
  const text = await response.text().catch(() => "")
  return textErrorMessage(text) ?? `Request failed with status ${response.status}`
}
