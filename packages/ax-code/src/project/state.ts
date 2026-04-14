import { Log } from "@/util/log"

export namespace State {
  interface Entry {
    state: unknown
    dispose?: (state: any) => Promise<void>
  }

  const log = Log.create({ service: "state" })
  const recordsByKey = new Map<string, Map<Function, Entry>>()

  // Return type for `create`: the cached getter, plus an `invalidate`
  // method that drops the current entry for the active root key (and
  // runs its dispose hook, if any). Callers use invalidate() to force
  // a rebuild on the next get() — for example, Provider.invalidate()
  // fires from the `/auth/:providerID` server handler so a fresh API
  // key shows up in the provider list without waiting for a full
  // Instance.reload (which would also wipe LSP clients, MCP
  // connections, sessions, etc.). See issue #13.
  export type Getter<S> = (() => S) & {
    invalidate: () => Promise<void>
  }

  export function create<S>(
    root: () => string,
    init: () => S,
    dispose?: (state: Awaited<S>) => Promise<void>,
  ): Getter<S> {
    const get = (() => {
      const key = root()
      let entries = recordsByKey.get(key)
      if (!entries) {
        entries = new Map<Function, Entry>()
        recordsByKey.set(key, entries)
      }
      const exists = entries.get(init)
      if (exists) return exists.state as S
      const state = init()
      entries.set(init, {
        state,
        dispose,
      })
      // If `state` is a Promise that rejects, remove it from the cache
      // so the next call retries initialization instead of returning the
      // same stuck rejection forever. This is the safety net for transient
      // failures in provider init (DNS timeout, expired key, network error).
      Promise.resolve(state).catch(() => {
        // Only remove if the entry still points to this exact value —
        // a concurrent invalidate() + re-init should not be clobbered.
        const current = entries.get(init)
        if (current && current.state === state) {
          entries.delete(init)
          log.info("auto-invalidated failed state", { key })
        }
      })
      return state
    }) as Getter<S>
    get.invalidate = async () => {
      const key = root()
      const entries = recordsByKey.get(key)
      if (!entries) return
      const entry = entries.get(init)
      if (!entry) return
      entries.delete(init)
      if (!entry.dispose) return
      // Run the dispose hook on the cached state. Await the state
      // first in case it's a Promise — matches the pattern in
      // dispose() below, which also tolerates async init functions.
      // Errors are logged but swallowed: invalidation must not fail
      // because a stale entry's cleanup threw.
      await Promise.resolve(entry.state)
        .then((s) => entry.dispose!(s))
        .catch((err) => log.error("error while invalidating state", { err, key }))
    }
    return get
  }

  export async function dispose(key: string) {
    const entries = recordsByKey.get(key)
    if (!entries) return

    log.info("waiting for state disposal to complete", { key })

    let disposalFinished = false

    setTimeout(() => {
      if (!disposalFinished) {
        log.warn(
          "state disposal is taking an unusually long time - if it does not complete in a reasonable time, please report this as a bug",
          { key },
        )
      }
    }, 10000).unref()

    const tasks: Promise<void>[] = []
    for (const [init, entry] of entries) {
      if (!entry.dispose) continue

      const label = typeof init === "function" ? init.name : String(init)

      const task = Promise.resolve(entry.state)
        .then((state) => entry.dispose!(state))
        .catch((error) => {
          log.error("Error while disposing state:", { error, key, init: label })
        })

      tasks.push(task)
    }
    await Promise.all(tasks)

    entries.clear()
    recordsByKey.delete(key)

    disposalFinished = true
    log.info("state disposal completed", { key })
  }
}
