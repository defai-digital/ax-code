import { RequestError } from "@agentclientprotocol/sdk"
import type { PlanEntry } from "@agentclientprotocol/sdk"
import { z } from "zod"
import { parseJsonPayload } from "@/util/json-value"
import { Todo } from "@/session/todo"
import { decodeDataUrlBytes } from "@/util/data-url"

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

export function decodeReplayDataUrl(url: string, fallbackMime: string) {
  const fallback = fallbackMime.split(";")[0]?.trim().toLowerCase() || "application/octet-stream"
  const comma = url.indexOf(",")
  if (!/^data:/i.test(url) || comma < 0) {
    return { mimeType: fallback, base64Data: "", text: "" }
  }

  const declaredMime = url.slice("data:".length, comma).split(";")[0]?.trim().toLowerCase()
  const mimeType = declaredMime?.includes("/") ? declaredMime : fallback
  const bytes = decodeDataUrlBytes(url)
  return {
    mimeType,
    base64Data: bytes?.toString("base64") ?? "",
    text: bytes?.toString("utf8") ?? "",
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
