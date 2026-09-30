import type { WikiBuildProgress } from "@ax-code/ax-wiki"

export type WikiMaintenanceStatus = {
  phase: "queued" | "running" | "ready" | "disabled" | "failed"
  reason: "idle" | "busy" | "permissions" | "disabled" | "non_git" | "building" | "complete" | "failed"
  completed: number
  total: number
  revision: number
}

/** Runtime-independent scheduling port; no timers or tasks survive disposal. */
export function createWikiIdleController(input: {
  idle(): Promise<boolean>
  policy(): Promise<{ enabled: boolean; automatic: boolean; writable: boolean; git: boolean }>
  onError?: (error: unknown) => void
  build(
    signal: AbortSignal,
    progress: (event: WikiBuildProgress) => void,
    options: { explicit: boolean },
  ): Promise<void>
  idleMs?: number
  pollMs?: number
  retryMs?: number
  deadlineMs?: number
}) {
  const idleMs = input.idleMs ?? 30_000
  const pollMs = input.pollMs ?? 5_000
  const retryMs = input.retryMs ?? 60_000
  let status: WikiMaintenanceStatus = { phase: "queued", reason: "idle", completed: 0, total: 0, revision: 0 }
  let timer: ReturnType<typeof setTimeout> | undefined
  let flight: Promise<void> | undefined
  let controller: AbortController | undefined
  let stopped = false
  let explicit = false
  let dirty = true
  let idleSince = Date.now()
  let retryAt = 0
  let failures = 0
  let checking = false
  let activityRevision = 0
  const publish = (next: Partial<WikiMaintenanceStatus>) => {
    status = { ...status, ...next }
  }
  function schedule(ms: number, recheck = false) {
    if (stopped || flight) return
    clearTimeout(timer)
    timer = setTimeout(
      () => {
        timer = undefined
        if (recheck) dirty = true
        void check()
      },
      Math.max(0, ms),
    )
    timer.unref?.()
  }
  async function check() {
    if (stopped || flight || checking) return
    checking = true
    const checkedRevision = activityRevision
    try {
      const policy = await input.policy()
      if (stopped) return
      if (!policy.enabled || !policy.writable || (!explicit && (!policy.automatic || !policy.git))) {
        publish({
          phase: "disabled",
          reason: !policy.enabled || !policy.automatic ? "disabled" : !policy.writable ? "permissions" : "non_git",
        })
        schedule(pollMs)
        return
      }
      const idle = await input.idle()
      if (stopped) return
      if (checkedRevision !== activityRevision) {
        schedule(pollMs)
        return
      }
      if (!idle) {
        idleSince = Date.now()
        publish({ phase: "queued", reason: "busy" })
        schedule(pollMs)
        return
      }
      const wait = Math.max(explicit ? 0 : idleSince + idleMs - Date.now(), retryAt - Date.now())
      if (wait > 0) {
        schedule(Math.min(wait, pollMs))
        return
      }
      if (!explicit && failures >= 3) {
        publish({ phase: "failed", reason: "failed" })
        schedule(300_000)
        return
      }
      if (!dirty) {
        publish({ phase: "ready", reason: "complete" })
        schedule(300_000, true)
        return
      }
      dirty = false
      const runExplicit = explicit
      explicit = false
      controller = new AbortController()
      const signal = controller.signal
      publish({ phase: "running", reason: "building", completed: 0, total: 0 })
      const deadline = setTimeout(
        () => controller?.abort(new Error("Wiki maintenance deadline exceeded")),
        input.deadlineMs ?? 600_000,
      )
      flight = Promise.resolve()
        .then(() =>
          input.build(
            signal,
            (event) => {
              signal.throwIfAborted()
              if (event.type === "plan") publish({ total: event.pageCount })
              if (event.type === "page_start") publish({ completed: event.index - 1, total: event.total })
              if (event.type === "page_complete") publish({ completed: event.index, total: event.total })
            },
            { explicit: runExplicit },
          ),
        )
        .then(() => {
          signal.throwIfAborted()
          failures = 0
          retryAt = 0
          publish({ phase: "ready", reason: "complete", completed: status.total, revision: status.revision + 1 })
        })
        .catch((error) => {
          dirty = true
          if (signal.aborted && signal.reason?.name === "AbortError") {
            publish({ phase: "queued", reason: "busy" })
          } else {
            input.onError?.(error)
            failures++
            retryAt = Date.now() + Math.min(retryMs * 2 ** Math.min(failures - 1, 4), 900_000)
            publish({ phase: "failed", reason: "failed" })
          }
        })
        .finally(() => {
          clearTimeout(deadline)
          controller = undefined
          flight = undefined
          schedule(pollMs)
        })
    } catch (error) {
      input.onError?.(error)
      failures++
      retryAt = Date.now() + retryMs
      publish({ phase: "failed", reason: "failed" })
      schedule(retryMs)
    } finally {
      checking = false
    }
  }
  function activity() {
    activityRevision++
    idleSince = Date.now()
    controller?.abort(new DOMException("Foreground work has priority", "AbortError"))
    schedule(pollMs)
  }
  schedule(idleMs)
  return {
    status: () => ({ ...status }),
    request() {
      if (flight) return
      explicit = true
      dirty = true
      failures = 0
      retryAt = 0
      schedule(0)
    },
    changed() {
      dirty = true
      failures = 0
      retryAt = 0
      activity()
    },
    activity,
    async dispose() {
      stopped = true
      clearTimeout(timer)
      controller?.abort(new DOMException("Wiki maintenance stopped", "AbortError"))
      await flight
    },
  }
}
