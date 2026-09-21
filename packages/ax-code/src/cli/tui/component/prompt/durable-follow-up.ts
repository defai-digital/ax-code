import z from "zod"
import type { FollowUpInput } from "./follow-up-queue"
import type { useSDK } from "@tui/context/sdk"
import { directoryRequestHeaders } from "@tui/util/request-headers"
import { responseErrorMessage } from "@tui/util/error-message"

const FollowUpRow = z.object({
  id: z.string(),
  sessionID: z.string(),
  kind: z.literal("followup"),
  status: z.enum([
    "queued",
    "waiting_for_idle",
    "paused",
    "running",
    "blocked_permission",
    "blocked_question",
    "failed",
    "completed",
    "cancelled",
  ]),
  title: z.string(),
  position: z.number(),
  time: z.object({ created: z.number(), updated: z.number().optional() }),
  payload: z.preprocess(
    (value) =>
      value && typeof value === "object" && !Array.isArray(value) ? Object.fromEntries(Object.entries(value)) : value,
    z.record(z.string(), z.unknown()),
  ),
  error: z.string().optional(),
})
export type DurableFollowUp = z.infer<typeof FollowUpRow>

/** Minimal SDK surface the follow-up endpoints need; the full useSDK satisfies it. */
export type FollowUpSdk = Pick<ReturnType<typeof useSDK>, "sseConnected" | "url" | "directory" | "fetch">

export function mergeFollowUpSnapshot<T extends { id: string; sessionID?: string } & Record<string, unknown>>(
  current: T[],
  snapshot: unknown[],
  sessionID: string,
  before: Map<string, string>,
  deleted = new Set<string>(),
): Array<T | DurableFollowUp> {
  const fresh = snapshot
    .map((row) => FollowUpRow.safeParse(row))
    .flatMap((row) => (row.success && row.data.sessionID === sessionID ? [row.data] : []))
  const byID = new Map<string, T | DurableFollowUp>(fresh.map((row) => [row.id, row]))
  for (const id of deleted) byID.delete(id)
  const other: T[] = []
  for (const row of current) {
    if (row.kind !== "followup" || row.sessionID !== sessionID) {
      other.push(row)
      continue
    }
    // Events received after the snapshot request take precedence over its older response.
    if (!deleted.has(row.id) && before.get(row.id) !== JSON.stringify(row)) byID.set(row.id, row)
  }
  return [...other, ...byID.values()]
}

export function durableFollowUps(
  rows: readonly unknown[],
  sessionID: string,
  includeHistory = false,
): DurableFollowUp[] {
  return rows
    .flatMap((row) => {
      const parsed = FollowUpRow.safeParse(row)
      return parsed.success &&
        parsed.data.sessionID === sessionID &&
        (includeHistory || !["completed", "cancelled"].includes(parsed.data.status))
        ? [parsed.data]
        : []
    })
    .sort((a, b) => a.position - b.position || a.time.created - b.time.created || a.id.localeCompare(b.id))
}

export function followUpBody(row: DurableFollowUp): FollowUpInput {
  const body = z
    .object({
      parts: z.array(z.object({ type: z.string(), text: z.string().optional() }).passthrough()),
      agent: z.string().optional(),
      variant: z.string().optional(),
      model: z.object({ providerID: z.string(), modelID: z.string() }).optional(),
    })
    .passthrough()
    .parse(row.payload.body)
  return body
}

export function followUpStatus(row: DurableFollowUp) {
  if (row.status === "waiting_for_idle") return "Queued"
  if (row.status === "blocked_permission" || row.status === "blocked_question") return "Awaiting input"
  if (row.status === "failed" && row.payload.interruptionReason === "backend_restart")
    return "Interrupted - inspect before retry"
  return row.status.charAt(0).toUpperCase() + row.status.slice(1)
}

export async function followUpAction(
  sdk: FollowUpSdk,
  id: string,
  action: "pause" | "resume" | "cancel" | "edit" | "send-now" | "retry",
  body?: unknown,
): Promise<DurableFollowUp> {
  if (!sdk.sseConnected) throw new Error("Reconnect before changing saved follow-ups")
  const response = await sdk.fetch(`${sdk.url.replace(/\/$/, "")}/task-queue/${encodeURIComponent(id)}/${action}`, {
    method: "POST",
    headers: directoryRequestHeaders({ directory: sdk.directory, contentType: "application/json" }),
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(10_000),
  })
  if (!response.ok) throw new Error(await responseErrorMessage(response))
  return FollowUpRow.parse(await response.json())
}

export async function pauseFollowUp(sdk: FollowUpSdk, id: string) {
  if (!sdk.sseConnected) throw new Error("Reconnect before editing saved follow-ups")
  const response = await sdk.fetch(`${sdk.url.replace(/\/$/, "")}/task-queue/${encodeURIComponent(id)}`, {
    headers: directoryRequestHeaders({ directory: sdk.directory }),
    signal: AbortSignal.timeout(10_000),
  })
  if (!response.ok) throw new Error(await responseErrorMessage(response))
  const current = FollowUpRow.parse(await response.json())
  return current.status === "paused" ? current : followUpAction(sdk, id, "pause")
}
