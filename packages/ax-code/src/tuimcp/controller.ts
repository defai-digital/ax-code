import { TuiDebugScreenSchema } from "@ax-code/sdk/tui-debug"
import { setTimeout as sleep } from "node:timers/promises"
import type { TuiDebugAction, TuiDebugScreen } from "@ax-code/sdk/tui-debug"
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
  debug?: {
    blocked: () => boolean
    fence: () => string
    snapshot: () => TuiDebugScreen
    input: (action: TuiDebugAction) => void
  }
}) {
  const instanceId = randomUUID()
  const generation = randomUUID()
  const now = options.now ?? Date.now
  let revision = 0
  let fingerprint: string | undefined
  let lastHumanInput = -Infinity
  let disposed = false
  let inFlight = false
  let waiters = 0
  const pending = new Set<AbortController>()
  const receipts = new Map<string, { signature: string; result: Promise<Result> }>()

  function context(): View {
    const state = options.state()
    const blocked = state.blocked || now() - lastHumanInput < HUMAN_QUIET_MS
    // workspace is part of the fence, but never part of the returned DTO.
    const next = JSON.stringify({
      ...state,
      blocked,
      debugFence: options.debug?.fence(),
      debugBlocked: options.debug?.blocked(),
    })
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

  function guard(
    input: Pick<Select, "instanceId" | "generation" | "expectedRevision">,
    debug = false,
  ): Result | undefined {
    if (disposed) return reject("revoked")
    const view = context()
    if (input.instanceId !== instanceId || input.generation !== generation) return reject("stale_target")
    if (input.expectedRevision !== view.revision) return reject("stale_revision")
    if (!view.ready) return reject("not_ready")
    if (debug ? options.debug?.blocked() || now() - lastHumanInput < HUMAN_QUIET_MS : view.blocked)
      return reject("user_active")
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

  function snapshot(input: { instanceId: string; generation: string }): Result {
    if (disposed) return reject("revoked")
    if (!options.debug) return reject("debug_disabled")
    if (input.instanceId !== instanceId || input.generation !== generation) return reject("stale_target")
    if (options.debug.blocked()) return reject("user_active")
    try {
      const view = context()
      // No await: the context and buffer are sampled in the same JS turn.
      const screen = options.debug.snapshot()
      if (screen.text.length > 48_000) return reject("snapshot_too_large")
      return { status: "snapshot", context: view, screen: TuiDebugScreenSchema.parse(screen) }
    } catch {
      return reject("internal_error")
    }
  }

  async function wait(input: Extract<Request, { operation: "wait_for_tui" }>, signal: AbortSignal): Promise<Result> {
    if (waiters >= 4) return reject("busy")
    waiters++
    const abort = new AbortController()
    pending.add(abort)
    const cancel = () => abort.abort()
    signal.addEventListener("abort", cancel, { once: true })
    // A monotonic deadline is independent of injected state/revision clocks.
    const deadline = performance.now() + input.timeoutMs
    try {
      while (true) {
        if (disposed) return reject("revoked")
        if (signal.aborted) return reject("cancelled")
        const result = snapshot(input)
        if (result.status !== "snapshot") return result
        if (
          (input.text === undefined || result.screen.text.includes(input.text)) &&
          (input.afterFrameId === undefined || result.screen.frameId > input.afterFrameId)
        )
          return result
        const remaining = deadline - performance.now()
        if (remaining <= 0) return reject("condition_timeout")
        await sleep(Math.min(25, remaining), undefined, { signal: abort.signal })
      }
    } catch {
      return reject(disposed ? "revoked" : "cancelled")
    } finally {
      waiters--
      pending.delete(abort)
      signal.removeEventListener("abort", cancel)
    }
  }

  function inputAction(input: Extract<Request, { operation: "tui_input" }>, signal: AbortSignal): Result {
    if (!options.debug) return reject("debug_disabled")
    if (signal.aborted) return reject("cancelled")
    const invalid = guard(input, true)
    if (invalid) return invalid
    if (inFlight) return reject("busy")
    inFlight = true
    try {
      if (input.action.kind === "click") {
        const screen = options.debug.snapshot()
        if (screen.frameId !== input.action.expectedFrameId) return reject("stale_frame")
        if (input.action.x >= screen.width || input.action.y >= screen.height) return reject("invalid_request")
      }
      // A synchronous adapter emits one bounded parser input, never backend commands.
      options.debug.input(input.action)
      revision++
      return { status: "applied", context: context() }
    } catch {
      return reject("outcome_unknown")
    } finally {
      inFlight = false
    }
  }

  return {
    instanceId,
    generation,
    debugEnabled: !!options.debug,
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
      if (input.operation === "get_tui_snapshot") return snapshot(input)
      if (input.operation === "wait_for_tui") return wait(input, signal)
      const signature = JSON.stringify(input)
      const cached = receipts.get(input.requestId)
      if (cached) return cached.signature === signature ? cached.result : reject("request_conflict")
      // Never evict a receipt and accidentally execute an old request again.
      if (receipts.size >= MAX_RECEIPTS) return reject("request_limit")
      const result = (
        input.operation === "tui_input" ? Promise.resolve(inputAction(input, signal)) : apply(input, signal)
      ).catch(() => reject("internal_error"))
      receipts.set(input.requestId, { signature, result })
      return result
    },
  }
}
export type TuiMcpController = ReturnType<typeof createTuiMcpController>
