import { randomUUID } from "node:crypto"
import { CALL_TIMEOUT_MS, HUMAN_QUIET_MS, MAX_RECEIPTS, RequestSchema, ViewSchema, reject } from "./protocol"
import type { Request, Result, Select, View } from "./protocol"
import type { SessionID } from "@/session/schema"

export type LiveState = {
  workspace: string
  route: "home" | "session"
  sessionId?: SessionID
  ready: boolean
  blocked: boolean
}

/** UI-only authority. Validation may await; the final check and commit never yield. */
export function createTuiMcpController(options: {
  state: () => LiveState
  validateSession: (sessionId: SessionID, signal: AbortSignal) => Promise<void>
  navigate: (sessionId: SessionID) => void
  now?: () => number
  timeoutMs?: number
}) {
  const instanceId = randomUUID()
  const generation = randomUUID()
  const now = options.now ?? Date.now
  let revision = 0
  let fingerprint: string | undefined
  let lastHumanInput = -Infinity
  let disposed = false
  let inFlight = false
  const pending = new Set<AbortController>()
  const receipts = new Map<string, { signature: string; result: Promise<Result> }>()

  function context(): View {
    const state = options.state()
    const blocked = state.blocked || now() - lastHumanInput < HUMAN_QUIET_MS
    // workspace is part of the fence, but never part of the returned DTO.
    const next = JSON.stringify({ ...state, blocked })
    if (fingerprint !== undefined && next !== fingerprint) revision++
    fingerprint = next
    return ViewSchema.parse({
      instanceId,
      generation,
      revision,
      route: state.route,
      sessionId: state.route === "session" ? state.sessionId : undefined,
      ready: !disposed && state.ready,
      blocked,
    })
  }

  function guard(input: Select): Result | undefined {
    if (disposed) return reject("revoked")
    const view = context()
    if (input.instanceId !== instanceId || input.generation !== generation) return reject("stale_target")
    if (input.expectedRevision !== view.revision) return reject("stale_revision")
    if (!view.ready) return reject("not_ready")
    if (view.blocked) return reject("user_active")
  }

  async function apply(input: Select, outer: AbortSignal): Promise<Result> {
    const invalid = guard(input)
    if (invalid) return invalid
    if (inFlight) return reject("busy")
    if (outer.aborted) return reject("cancelled")
    inFlight = true
    const abort = new AbortController()
    pending.add(abort)
    const cancel = () => abort.abort()
    outer.addEventListener("abort", cancel, { once: true })
    const timer = setTimeout(() => abort.abort(), options.timeoutMs ?? CALL_TIMEOUT_MS)
    const interruptedCode = () =>
      disposed ? ("revoked" as const) : outer.aborted ? ("cancelled" as const) : ("deadline_exceeded" as const)
    let stop: (() => void) | undefined
    const interrupted = new Promise<Result>((resolve) => {
      stop = () => resolve(reject(interruptedCode()))
      abort.signal.addEventListener("abort", stop, { once: true })
    })
    const execution = (async (): Promise<Result> => {
      try {
        await options.validateSession(input.sessionId, abort.signal)
      } catch {
        return reject(abort.signal.aborted ? interruptedCode() : "target_unavailable")
      }
      if (abort.signal.aborted) return reject(interruptedCode())
      const changed = guard(input)
      if (changed) return changed
      // No await between the live guard and the UI route commit.
      try {
        options.navigate(input.sessionId)
        const view = context()
        if (view.route !== "session" || view.sessionId !== input.sessionId) return reject("outcome_unknown")
        return { status: "applied", context: view }
      } catch {
        // A handler may throw after changing route state. Never claim no effect.
        return reject("outcome_unknown")
      }
    })().catch(() => reject("internal_error"))
    // A timed-out validator may ignore cancellation. Keep the single-flight
    // gate until it actually settles, while returning the deadline promptly.
    void execution.then(() => {
      pending.delete(abort)
      inFlight = false
    })
    try {
      return await Promise.race([execution, interrupted])
    } finally {
      clearTimeout(timer)
      outer.removeEventListener("abort", cancel)
      if (stop) abort.signal.removeEventListener("abort", stop)
    }
  }

  return {
    instanceId,
    generation,
    context,
    observe: context,
    humanInput() {
      lastHumanInput = now()
      revision++
    },
    dispose() {
      disposed = true
      for (const abort of pending) abort.abort()
    },
    async dispatch(raw: Request, signal: AbortSignal): Promise<Result> {
      const parsed = RequestSchema.safeParse(raw)
      if (!parsed.success) return reject("invalid_request")
      const input = parsed.data
      if (disposed) return reject("revoked")
      if (input.operation === "get_view_context") {
        try {
          return { status: "context", context: context() }
        } catch {
          return reject("internal_error")
        }
      }
      const signature = JSON.stringify(input)
      const cached = receipts.get(input.requestId)
      if (cached) return cached.signature === signature ? cached.result : reject("request_conflict")
      // Never evict a receipt and accidentally execute an old request again.
      if (receipts.size >= MAX_RECEIPTS) return reject("request_limit")
      const result = apply(input, signal).catch(() => reject("internal_error"))
      receipts.set(input.requestId, { signature, result })
      return result
    },
  }
}
export type TuiMcpController = ReturnType<typeof createTuiMcpController>
