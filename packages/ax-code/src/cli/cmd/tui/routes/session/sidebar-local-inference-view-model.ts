import { AX_ENGINE_PROVIDER_ID } from "@/provider/ax-engine/constants"

type SidebarInferenceMessage = {
  id: string
  role: string
  providerID?: string
  modelID?: string
  time?: {
    created?: number
    completed?: number
  }
  tokens?: {
    input?: number
    output?: number
  }
}

export type SidebarLocalInferenceView = {
  modelID: string
  prefillRate?: string
  decodeRate?: string
}

const RATE_MIN_ELAPSED_SECONDS = 0.5

function formatRate(tokens: number, seconds: number): string | undefined {
  if (tokens <= 0 || seconds < RATE_MIN_ELAPSED_SECONDS) return undefined
  const rate = tokens / seconds
  if (!Number.isFinite(rate) || rate <= 0) return undefined
  if (rate >= 10_000) return `${Math.round(rate / 1000)}k t/s`
  if (rate >= 1_000) return `${(rate / 1000).toFixed(1)}k t/s`
  if (rate >= 100) return `${Math.round(rate)} t/s`
  return `${rate.toFixed(1)} t/s`
}

function firstOutputStart(parts: readonly unknown[]): number | undefined {
  let earliest: number | undefined
  for (const value of parts) {
    if (!value || typeof value !== "object") continue
    const part = value as { type?: unknown; time?: unknown }
    if (part.type !== "text" && part.type !== "reasoning") continue
    const time = part.time && typeof part.time === "object" ? (part.time as { start?: unknown }) : undefined
    const start = time?.start
    if (typeof start !== "number" || !Number.isFinite(start)) continue
    if (earliest === undefined || start < earliest) earliest = start
  }
  return earliest
}

export function sidebarLocalInferenceView(input: {
  messages: readonly SidebarInferenceMessage[]
  partsByMessage: Record<string, readonly unknown[] | undefined>
  now?: number
}): SidebarLocalInferenceView | undefined {
  const message = input.messages.findLast(
    (item) =>
      item.role === "assistant" &&
      item.providerID === AX_ENGINE_PROVIDER_ID &&
      ((item.tokens?.input ?? 0) > 0 || (item.tokens?.output ?? 0) > 0),
  )
  if (!message) return undefined

  const startedAt = message.time?.created
  if (typeof startedAt !== "number" || !Number.isFinite(startedAt)) return undefined

  const firstOutputAt = firstOutputStart(input.partsByMessage[message.id] ?? [])
  if (firstOutputAt === undefined || firstOutputAt < startedAt) return undefined

  const now = input.now ?? Date.now()
  const completedAt =
    typeof message.time?.completed === "number" && Number.isFinite(message.time.completed) ? message.time.completed : now
  const inputTokens = message.tokens?.input ?? 0
  const outputTokens = message.tokens?.output ?? 0

  const prefillRate = formatRate(inputTokens, (firstOutputAt - startedAt) / 1000)
  const decodeRate = formatRate(outputTokens, (Math.max(completedAt, firstOutputAt) - firstOutputAt) / 1000)
  if (!prefillRate && !decodeRate) return undefined

  return {
    modelID: message.modelID ?? "unknown",
    prefillRate,
    decodeRate,
  }
}
