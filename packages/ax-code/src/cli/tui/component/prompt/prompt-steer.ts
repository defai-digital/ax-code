/**
 * Send-now ("steer") delivery for a busy session.
 *
 * Ordinary busy-session submissions are durable follow-ups that start after
 * the running turn ends (ADR-106). Steering instead admits the text into the
 * *running* generation: the prompt loop writes it as a user message at its
 * next step boundary, after the in-flight tool calls settle and before the
 * next model request, and a correction admitted at the finish line extends
 * the run by one iteration instead of being dropped. This is the Codex /
 * Claude Code delivery point; Kimi Code, Grok Build and DeepSeek Harness
 * expose the same thing as an explicit per-message gesture over a queue
 * default, which is the shape AX Code adopts.
 *
 * Steering carries text only and is best-effort: when the generation ended
 * before admission the caller falls back to the ordinary follow-up path so
 * nothing the user typed is lost.
 */

export type SteerReceiptStatus = "accepted" | "applied" | "rejected"

export type SteerClient = {
  steering(parameters: {
    sessionID: string
  }): Promise<{ data?: { generation: string | null } | undefined; error?: unknown }>
  steer(parameters: {
    sessionID: string
    expectedGeneration: string
    clientID: string
    text: string
  }): Promise<{ data?: { status: SteerReceiptStatus; reason?: string } | undefined; error?: unknown }>
}

export type SteerOutcome =
  | { kind: "delivered"; status: "accepted" | "applied" }
  | { kind: "fallback"; reason: string }
  | { kind: "failed"; message: string }

/** Rejections that mean "no live generation to steer": queue the text instead. */
const FALLBACK_REASONS = new Set(["generation_not_active", "generation_ended_before_application"])

export function isSteerableDraft(input: { mode: string; statusType: string | undefined; hasAttachments: boolean }) {
  return (
    input.mode === "normal" && !input.hasAttachments && (input.statusType === "busy" || input.statusType === "retry")
  )
}

export async function steerBusySession(
  client: SteerClient,
  input: { sessionID: string; clientID: string; text: string },
): Promise<SteerOutcome> {
  const state = await client.steering({ sessionID: input.sessionID }).catch((error: unknown) => ({
    data: undefined,
    error,
  }))
  if (state.error) return { kind: "failed", message: errorText(state.error) }
  const generation = state.data?.generation
  if (!generation) return { kind: "fallback", reason: "generation_not_active" }

  const receipt = await client
    .steer({ sessionID: input.sessionID, expectedGeneration: generation, clientID: input.clientID, text: input.text })
    .catch((error: unknown) => ({ data: undefined, error }))
  if (receipt.error) return { kind: "failed", message: errorText(receipt.error) }
  const data = receipt.data
  if (!data) return { kind: "failed", message: "steering returned no receipt" }
  if (data.status === "rejected") {
    const reason = data.reason ?? "rejected"
    if (FALLBACK_REASONS.has(reason)) return { kind: "fallback", reason }
    return { kind: "failed", message: reason }
  }
  return { kind: "delivered", status: data.status }
}

function errorText(error: unknown) {
  if (error instanceof Error) return error.message
  if (typeof error === "string") return error
  if (error && typeof error === "object") {
    const record = error as { message?: unknown; data?: { message?: unknown } }
    if (typeof record.message === "string") return record.message
    if (typeof record.data?.message === "string") return record.data.message
  }
  return "steering request failed"
}
