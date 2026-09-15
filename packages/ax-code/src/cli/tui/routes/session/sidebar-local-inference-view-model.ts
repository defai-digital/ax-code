import { AX_ENGINE_PROVIDER_ID } from "@/provider/ax-engine/constants"
import { parseStepTokenWindows, stepDecodeEnd } from "./step-windows"

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

// Per-step prefill window: from the previous step's last activity (tool
// execution excluded) to this step's first output token. Message-level token
// counts ACCUMULATE across steps (each tool-calling loop re-sends the full
// context), so dividing them by the whole turn span charges tool execution
// time against decode and counts every step's re-sent context against the
// first step's prefill — both rates come out wildly wrong on multi-step
// turns. Each finished step contributes its own tokens and window instead.
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

  const now = input.now ?? Date.now()
  const { steps, sawStepPart } = parseStepTokenWindows(input.partsByMessage[message.id] ?? [], now)

  // Older sessions may carry no step parts at all: fall back to the
  // message-level totals attributed to a single step so the panel still has
  // something accurate to show for single-step turns.
  if (!sawStepPart && steps.length === 1) {
    steps[0].input = message.tokens?.input ?? 0
    steps[0].output = message.tokens?.output ?? 0
    steps[0].finished = true
  }

  let prefillTokens = 0
  let prefillMs = 0
  let decodeTokens = 0
  let decodeMs = 0
  for (let i = 0; i < steps.length; i++) {
    const step = steps[i]
    // The in-flight step has no usage yet — pairing its window with tokens
    // from earlier steps would drag the decode rate down while tools run.
    if (!step.finished) continue

    const firstOut = step.firstOut
    const end = stepDecodeEnd(step)
    if (firstOut !== undefined && end !== undefined && end > firstOut && step.output > 0) {
      decodeTokens += step.output
      decodeMs += end - firstOut
    }

    if (firstOut === undefined || step.input <= 0) continue
    if (i === 0) {
      if (firstOut > startedAt) {
        prefillTokens += step.input
        prefillMs += firstOut - startedAt
      }
      continue
    }
    const prev = steps[i - 1]
    const prevEnd = stepDecodeEnd(prev)
    if (prevEnd === undefined) continue
    const toolMs =
      prev.toolStart !== undefined && prev.toolEnd !== undefined ? Math.max(0, prev.toolEnd - prev.toolStart) : 0
    const gap = firstOut - prevEnd - toolMs
    if (gap <= 0) continue
    prefillTokens += step.input
    prefillMs += gap
  }

  const prefillRate = formatRate(prefillTokens, prefillMs / 1000)
  const decodeRate = formatRate(decodeTokens, decodeMs / 1000)
  if (!prefillRate && !decodeRate) return undefined

  return {
    modelID: message.modelID ?? "unknown",
    prefillRate,
    decodeRate,
  }
}
