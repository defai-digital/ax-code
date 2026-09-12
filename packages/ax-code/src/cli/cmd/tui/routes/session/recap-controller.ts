export type RecapSnapshot = {
  sessionID: string
  revision: string
  status: string
  treeBusy: boolean
  hasMessages: boolean
  enabled: boolean
  delayMs: number
  pregenerate: boolean
  input: string
  autoScope: "turn" | "conversation"
}

type RecapView = { text?: string; loading?: boolean }

/** Lead time before the idle delay mark at which an automatic recap starts
 *  generating, so the banner can appear at the mark instead of one model
 *  latency after it. */
export const RECAP_PREGENERATE_LEAD_MS = 2_500

/** Owns one presentation request; invalidation also rejects late successful responses. */
export function createRecapController(host: {
  snapshot: () => RecapSnapshot
  request: (input: {
    sessionID: string
    scope: "turn" | "conversation"
    signal: AbortSignal
  }) => Promise<{ data?: { text: string | null }; error?: unknown }>
  schedule: (task: () => void, delayMs: number) => () => void
  show: (view: RecapView) => void
  notify: (message: string) => void
}) {
  let previous: RecapSnapshot | undefined
  let cancelArm: (() => void) | undefined
  let cancelReveal: (() => void) | undefined
  let active: { abort: AbortController; manual: boolean } | undefined
  /** Pregenerated text held for the delay mark; undefined when nothing is held. */
  let held: string | undefined
  let attempted = false
  let disposed = false

  function cancelTimers() {
    cancelArm?.()
    cancelArm = undefined
    cancelReveal?.()
    cancelReveal = undefined
    held = undefined
  }

  function invalidate() {
    cancelTimers()
    active?.abort.abort()
    active = undefined
    host.show({})
  }

  /** Typing or disabling pauses only the automatic lane: a pending schedule is
   *  cancelled, held pregenerated text is dropped, and an in-flight automatic
   *  request is aborted so the recap can re-arm once the prompt clears. Manual
   *  requests and a displayed recap survive — the banner clears on the next
   *  turn, not on keystrokes. */
  function pauseAutomatic() {
    cancelTimers()
    if (active && !active.manual) {
      active.abort.abort()
      active = undefined
      attempted = false
    }
  }

  function update() {
    if (disposed) return
    const next = host.snapshot()
    const old = previous
    previous = next
    // Subagents work in child sessions while the parent reports idle, so a
    // finished process means the whole session tree has settled.
    const finished = next.status === "idle" && !next.treeBusy
    const wasFinished = old ? old.status === "idle" && !old.treeBusy : false
    const sessionChanged = Boolean(old && next.sessionID !== old.sessionID)
    const changed = sessionChanged || Boolean(old && next.revision !== old.revision)
    if (old && (changed || !finished)) {
      invalidate()
      attempted = false
    } else if (old && ((next.input !== "" && next.input !== old.input) || (!next.enabled && old.enabled))) {
      pauseAutomatic()
    }
    // Arm on first observation of a settled session, on navigating to one,
    // and on the existing idle-edge / revision / prompt-cleared paths
    // (ADR-095). Requiring a same-session idle edge skipped resume and
    // session switches: the first snapshot was stored and never armed.
    if (
      finished &&
      (!old || sessionChanged || !wasFinished || changed || (old.input !== "" && next.input === "")) &&
      next.enabled &&
      next.hasMessages &&
      !next.input &&
      !attempted &&
      !active
    ) {
      cancelArm?.()
      cancelReveal?.()
      const lead = next.pregenerate ? RECAP_PREGENERATE_LEAD_MS : 0
      cancelArm = host.schedule(
        () => {
          cancelArm = undefined
          void request(false)
        },
        Math.max(0, next.delayMs - lead),
      )
      cancelReveal = host.schedule(() => {
        cancelReveal = undefined
        if (held === undefined) return
        const text = held
        held = undefined
        host.show({ text })
      }, next.delayMs)
    }
  }

  async function request(manual: boolean) {
    if (disposed) return
    update()
    const snapshot = host.snapshot()
    const notify = (message: string) => {
      if (manual) host.notify(message)
    }
    if (snapshot.status !== "idle" || snapshot.treeBusy)
      return notify("Wait for the current work to finish before requesting a recap.")
    if (!snapshot.hasMessages) return notify("There is no conversation history to recap.")
    if (active?.manual) return notify("A conversation recap is already being generated.")
    if (active && !manual) return
    if (!manual && (!snapshot.enabled || snapshot.input || attempted)) return
    // A manual request replaces an in-flight automatic pregeneration.
    active?.abort.abort()
    cancelArm?.()
    cancelArm = undefined
    if (manual) {
      cancelReveal?.()
      cancelReveal = undefined
      held = undefined
    }
    attempted = true
    const current = { abort: new AbortController(), manual }
    active = current
    host.show({ loading: manual })
    try {
      const result = await host.request({
        sessionID: snapshot.sessionID,
        scope: manual ? "conversation" : snapshot.autoScope,
        signal: current.abort.signal,
      })
      update()
      if (disposed || active !== current) return
      if (result.error) {
        notify("Could not generate a conversation recap. Try /recap again.")
        host.show({})
      } else if (!result.data?.text) {
        notify("No recap is available for this conversation or provider yet.")
        host.show({})
      } else if (manual || cancelReveal === undefined) {
        host.show({ text: result.data.text })
      } else {
        // Reveal is still pending: hold the pregenerated text for the delay mark.
        held = result.data.text
      }
    } catch {
      update()
      if (active !== current || disposed) return
      notify("Could not generate a conversation recap. Try /recap again.")
      host.show({})
    } finally {
      if (active === current) active = undefined
    }
  }

  return {
    update,
    manual: () => request(true),
    dispose() {
      disposed = true
      invalidate()
    },
  }
}
