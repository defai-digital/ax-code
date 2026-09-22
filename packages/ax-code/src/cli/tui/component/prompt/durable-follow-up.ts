import z from "zod"
import type { FollowUpInput } from "./follow-up-queue"
import type { useSDK } from "@tui/context/sdk"
import { directoryRequestHeaders } from "@tui/util/request-headers"
import { responseErrorMessage } from "@tui/util/error-message"

/**
 * Queue row kinds the busy-session async submission routes create: text
 * follow-ups (ADR-106 D4) plus the command/prompt/shell rows command_async,
 * prompt_async, and shell_async enqueue. Only "followup" rows carry editable,
 * steerable prompt text; the others are opaque queued work the list still
 * needs to show so they do not vanish until they execute.
 */
export const FOLLOW_UP_KINDS = ["followup", "command", "prompt", "shell"] as const
export type FollowUpKind = (typeof FOLLOW_UP_KINDS)[number]

const FOLLOW_UP_KIND_SET: ReadonlySet<string> = new Set(FOLLOW_UP_KINDS)

const FollowUpRow = z.object({
  id: z.string(),
  sessionID: z.string(),
  kind: z.enum(FOLLOW_UP_KINDS),
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
    // Rows of the four known kinds merge by id (event precedence below);
    // unknown kinds and other sessions stay opaque passthrough entries.
    if (typeof row.kind !== "string" || !FOLLOW_UP_KIND_SET.has(row.kind) || row.sessionID !== sessionID) {
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

/** True when the row carries editable, steerable prompt text — only followup rows do. */
export function isTextFollowUp(row: DurableFollowUp): boolean {
  return row.kind === "followup"
}

function oneLineLabel(text: string): string {
  const line = text.split("\n")[0].trim()
  return line.length > 120 ? `${line.slice(0, 117)}...` : line
}

/**
 * `/goal <arguments>` from a command_async payload (or the composer's command
 * id + arguments), collapsed to one bounded line. Shared by the queue list and
 * the busy-acceptance toast so both show the same command line.
 */
export function commandLineLabel(command: string, args = ""): string {
  const name = command.trim().replace(/^\/+/, "")
  if (!name) return ""
  return oneLineLabel([`/${name}`, args.trim()].filter(Boolean).join(" "))
}

function payloadBodyString(row: DurableFollowUp, key: string): string {
  const body = row.payload?.body
  if (!body || typeof body !== "object") return ""
  const value = (body as Record<string, unknown>)[key]
  return typeof value === "string" ? value : ""
}

/**
 * Display label for a queue row. Follow-up rows keep their server title
 * verbatim; the other busy-session kinds get a short kind tag plus, where the
 * payload carries one, the command line (`/goal <arguments>`) on one line.
 */
export function followUpLabel(row: DurableFollowUp): string {
  if (row.kind === "followup") return row.title
  const derived =
    row.kind === "command"
      ? commandLineLabel(payloadBodyString(row, "command"), payloadBodyString(row, "arguments"))
      : row.kind === "shell"
        ? oneLineLabel(payloadBodyString(row, "command"))
        : oneLineLabel(row.title)
  return `[${row.kind}] ${derived || oneLineLabel(row.title)}`
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
