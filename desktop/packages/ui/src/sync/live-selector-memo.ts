/**
 * Snapshot memoization for cross-store live selectors.
 *
 * `useLiveSyncSelector` re-runs its selector over every child store on every
 * store notification. During token streaming the hot events
 * (`message.part.updated`/`delta`, `message.updated`) replace only the
 * `part`/`message` slices — `session` and `session_status` keep their
 * references. The sidebar aggregations only read those stable slices, so the
 * memo skips both the selector and its equality check whenever the slices a
 * selector reads are reference-unchanged across all stores.
 */

type LiveSliceSource = {
  session: readonly unknown[]
  session_status?: Record<string, unknown>
  permission?: Record<string, readonly unknown[]>
}

export const areSliceDepsEqual = (left: readonly unknown[], right: readonly unknown[]): boolean => {
  if (left.length !== right.length) {
    return false
  }
  for (let index = 0; index < left.length; index += 1) {
    if (!Object.is(left[index], right[index])) {
      return false
    }
  }
  return true
}

/** Deps for selectors that read only `state.session` (e.g. session lists). */
export const getSessionSliceDeps = (states: readonly LiveSliceSource[]): readonly unknown[] =>
  states.map((state) => state.session)

/**
 * Deps for selectors that read `state.session_status` and use `state.session`
 * for tie-breaking (status aggregation, single-session status lookups).
 */
export const getSessionStatusSliceDeps = (states: readonly LiveSliceSource[]): readonly unknown[] => {
  const deps: unknown[] = []
  for (const state of states) {
    deps.push(state.session_status, state.session)
  }
  return deps
}

/** Deps for selectors that read only `state.session_status` (e.g. counters). */
export const getStatusOnlySliceDeps = (states: readonly LiveSliceSource[]): readonly unknown[] =>
  states.map((state) => state.session_status)

/** Deps for selectors that read only `state.permission` (e.g. approval counters). */
export const getPermissionSliceDeps = (states: readonly LiveSliceSource[]): readonly unknown[] =>
  states.map((state) => state.permission)

export type LiveSnapshotMemoOptions<TStates, T> = {
  selector: (states: TStates) => T
  isEqual: (left: T, right: T) => boolean
  getDeps?: (states: TStates) => readonly unknown[]
}

/**
 * Returns a snapshot function with two cache layers:
 * 1. slice deps — if the slice references the selector reads are unchanged,
 *    the previous result is returned without running the selector at all;
 * 2. result equality — if the selector produced an equivalent value, the
 *    previous reference is returned so subscribers skip re-renders.
 */
export function createLiveSnapshotMemo<TStates, T>(options: LiveSnapshotMemoOptions<TStates, T>): (states: TStates) => T {
  const { selector, isEqual, getDeps } = options
  let initialized = false
  let cachedResult: T
  let cachedDeps: readonly unknown[] | null = null

  return (states) => {
    const nextDeps = getDeps ? getDeps(states) : null
    if (initialized && nextDeps && cachedDeps && areSliceDepsEqual(cachedDeps, nextDeps)) {
      return cachedResult
    }

    const next = selector(states)
    cachedDeps = nextDeps
    if (initialized && isEqual(cachedResult, next)) {
      return cachedResult
    }

    cachedResult = next
    initialized = true
    return next
  }
}
