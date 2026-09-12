export type RecapSnapshot = {
  sessionID: string
  revision: string
  status: string
  treeBusy: boolean
  hasMessages: boolean
  enabled: boolean
  delayMs: number
  input: string
  autoScope: "turn" | "conversation"
}

type RecapView = { text?: string; loading?: boolean }

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
  let cancelTimer: (() => void) | undefined
  let active: { abort: AbortController; manual: boolean } | undefined
  let attempted = false
  let disposed = false

  function cancelScheduled() {
    cancelTimer?.()
    cancelTimer = undefined
  }

  function invalidate() {
    cancelScheduled()
    active?.abort.abort()
    active = undefined
    host.show({})
  }

  /** Typing or disabling pauses only the automatic lane: a pending schedule is
   *  cancelled and an in-flight automatic request is aborted so the recap can
   *  re-arm once the prompt clears. Manual requests and a displayed recap
   *  survive — the banner clears on the next turn, not on keystrokes. */
  function pauseAutomatic() {
    cancelScheduled()
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
    if (!old) return
    // Subagents work in child sessions while the parent reports idle, so a
    // finished process means the whole session tree has settled.
    const finished = next.status === "idle" && !next.treeBusy
    const wasFinished = old.status === "idle" && !old.treeBusy
    const changed = next.sessionID !== old.sessionID || next.revision !== old.revision
    if (changed || !finished) {
      invalidate()
      attempted = false
    } else if ((next.input !== "" && next.input !== old.input) || (!next.enabled && old.enabled)) {
      pauseAutomatic()
    }
    if (
      next.sessionID === old.sessionID &&
      finished &&
      (!wasFinished || changed || (old.input !== "" && next.input === "")) &&
      next.enabled &&
      next.hasMessages &&
      !next.input &&
      !attempted &&
      !active
    ) {
      cancelScheduled()
      cancelTimer = host.schedule(() => {
        cancelTimer = undefined
        void request(false)
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
    if (active) return notify("A conversation recap is already being generated.")
    if (!manual && (!snapshot.enabled || snapshot.input || attempted)) return
    cancelScheduled()
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
      } else {
        host.show({ text: result.data.text })
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
