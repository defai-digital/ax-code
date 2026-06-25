import { RequestError } from "@agentclientprotocol/sdk"
import type { PlanEntry } from "@agentclientprotocol/sdk"
import { z } from "zod"
import { parseJsonPayload } from "@/util/json-value"
import { Todo } from "@/session/todo"

const ACP_TODO_STATUSES: ReadonlyArray<PlanEntry["status"]> = ["pending", "in_progress", "completed"]

export function isHttpUri(uri: string) {
  try {
    const protocol = new URL(uri).protocol
    return protocol === "http:" || protocol === "https:"
  } catch {
    return false
  }
}

export function uriProtocol(uri: string) {
  try {
    return new URL(uri).protocol
  } catch {
    return undefined
  }
}

function toPlanEntryStatus(status: Todo.Info["status"]): PlanEntry["status"] {
  if (ACP_TODO_STATUSES.includes(status as PlanEntry["status"])) {
    return status as PlanEntry["status"]
  }
  if (status === "cancelled") return "completed"
  return "pending"
}

export function decodeTodoPlanEntries(value: unknown): PlanEntry[] | null {
  const result = z.array(Todo.Info).safeParse(value)
  if (!result.success) {
    return null
  }
  return result.data.map((todo) => ({
    priority: "medium",
    status: toPlanEntryStatus(todo.status),
    content: todo.content,
  }))
}

// Convert an internal todowrite tool's serialized output into ACP PlanEntry[].
// Returns null when the output isn't valid JSON (silent skip) or when the
// shape doesn't match Todo.Info (logged). Callers send the entries via a
// sessionUpdate "plan" event when non-null.
export function parseTodoPlanEntries(rawOutput: string): PlanEntry[] | null {
  const parsed = parseJsonPayload(rawOutput)
  if (parsed === undefined) return null
  return decodeTodoPlanEntries(parsed)
}

function isBase64Payload(value: string) {
  return value.length > 0 && value.length % 4 !== 1 && /^[A-Za-z0-9+/]*={0,2}$/.test(value)
}

function normalizeBase64DataUrlBody(value: string): string | undefined {
  let decoded: string
  try {
    decoded = decodeURIComponent(value)
  } catch {
    return undefined
  }
  const normalized = decoded.replace(/\s+/g, "")
  return isBase64Payload(normalized) ? normalized : undefined
}

export function decodeReplayDataUrl(url: string, fallbackMime: string) {
  const comma = url.indexOf(",")
  if (!/^data:/i.test(url) || comma < 0) {
    return { mimeType: fallbackMime, base64Data: "", text: "" }
  }

  const metadata = url.slice("data:".length, comma)
  const body = url.slice(comma + 1)
  const metadataParts = metadata.split(";").filter(Boolean)
  const mimeType = metadataParts.find((part) => part.includes("/")) ?? fallbackMime
  const isBase64 = metadataParts.some((part) => part.toLowerCase() === "base64")
  if (isBase64) {
    const normalizedBody = normalizeBase64DataUrlBody(body)
    if (!normalizedBody) return { mimeType, base64Data: "", text: "" }
    return {
      mimeType,
      base64Data: normalizedBody,
      text: Buffer.from(normalizedBody, "base64").toString("utf-8"),
    }
  }

  try {
    const text = decodeURIComponent(body)
    return {
      mimeType,
      base64Data: Buffer.from(text, "utf-8").toString("base64"),
      text,
    }
  } catch {
    return { mimeType, base64Data: "", text: "" }
  }
}

export function parseListSessionsCursor(cursor: string | null | undefined): number | undefined {
  if (cursor === undefined || cursor === null) return undefined
  const trimmed = cursor.trim()
  if (!trimmed) return undefined
  if (!/^\d+$/.test(trimmed)) {
    throw RequestError.invalidParams(JSON.stringify({ error: "Invalid session list cursor" }))
  }
  const parsed = Number(trimmed)
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw RequestError.invalidParams(JSON.stringify({ error: "Invalid session list cursor" }))
  }
  return parsed
}

export function sessionUpdatedMs(session: { time: { updated: unknown } }): number {
  return typeof session.time.updated === "number" && Number.isFinite(session.time.updated) ? session.time.updated : 0
}
