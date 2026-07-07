import path from "path"
import { Global } from "@/global"
import { Filesystem } from "@/util/filesystem"
import { FileLock } from "@/util/filelock"
import { Log } from "@/util/log"
import { SuperLongPolicy } from "./super-long-policy"

const log = Log.create({ service: "super-long-runtime" })

type RunState = {
  startedAt: number
  lastSeenAt: number
  // Cumulative steps taken across ALL prompt-loop invocations of this
  // session while Super-Long was active. The in-memory totalSteps counter
  // resets on every prompt() invocation, so without this a crash/restart
  // would hand a Super-Long run a fresh cumulative-step budget.
  totalSteps?: number
}

type Store = {
  runs?: Record<string, RunState>
  pacing?: Record<string, SuperLongPolicy.PacingState>
}

export namespace SuperLongRuntime {
  const STORE_PATH = path.join(Global.Path.state, "super-long-runtime.json")
  const STORE_PATH_ENV = "AX_CODE_SUPER_LONG_RUNTIME_STORE"
  const RUN_RETENTION_MS = 7 * 24 * 60 * 60 * 1000
  const LOCK_TIMEOUT_MS = 2_000
  // Stale locks from crashed processes should clear well within the lock
  // timeout window, otherwise a crash mid-write blocks durable pacing for the
  // FileLock default (5 min) even though each acquire only waits 2s. A normal
  // store update is sub-second, so anything older than a few timeouts is a
  // dead holder. The caller (llm-impl.applySuperLongPacing) already falls
  // back to process-local pacing on a lock failure, so this is about how fast
  // cross-process pacing coordination recovers, not about loop survival.
  const LOCK_STALE_MS = 30_000

  export async function sessionStartedAt(input: { sessionID: string; now: number }): Promise<number> {
    const run = await touchRun(input)
    return run.startedAt
  }

  /**
   * Touches (or creates) the durable run record: refreshes lastSeenAt,
   * accumulates `stepsDelta` into the cross-invocation step counter, and
   * returns both the durable start anchor and the cumulative step count.
   */
  export async function touchRun(input: {
    sessionID: string
    now: number
    stepsDelta?: number
  }): Promise<{ startedAt: number; totalSteps: number }> {
    const delta =
      input.stepsDelta !== undefined && Number.isFinite(input.stepsDelta) && input.stepsDelta > 0
        ? Math.floor(input.stepsDelta)
        : 0
    return updateStore((store) => {
      const runs = (store.runs ??= {})
      const existing = runs[input.sessionID]
      if (existing) {
        existing.lastSeenAt = input.now
        existing.totalSteps = (Number.isFinite(existing.totalSteps) ? existing.totalSteps! : 0) + delta
        return { startedAt: existing.startedAt, totalSteps: existing.totalSteps }
      }
      runs[input.sessionID] = {
        startedAt: input.now,
        lastSeenAt: input.now,
        totalSteps: delta,
      }
      return { startedAt: input.now, totalSteps: delta }
    }, input.now)
  }

  /**
   * Read-only lookup of a session's durable run start. Unlike
   * `sessionStartedAt` this never creates a record — status reporting
   * must not start the 72h clock for sessions that have not run yet.
   */
  export async function peekSessionStartedAt(sessionID: string): Promise<number | undefined> {
    const store = await readStore()
    const run = store.runs?.[sessionID]
    return run && validRunState(run) ? run.startedAt : undefined
  }

  export async function reservePacing(input: {
    key: string
    now: number
    policy: SuperLongPolicy.PacingPolicy
  }): Promise<{ decision: SuperLongPolicy.PacingDecision; state?: SuperLongPolicy.PacingState }> {
    return updateStore((store) => {
      const pacing = (store.pacing ??= {})
      const state = pacing[input.key] ?? { timestamps: [] }
      const decision = SuperLongPolicy.evaluatePacing({ now: input.now, state, policy: input.policy })
      if (decision.waitMs > 0) {
        pacing[input.key] = { timestamps: decision.timestamps }
        return { decision }
      }
      const next = SuperLongPolicy.recordRequest({ now: input.now, state, policy: input.policy })
      pacing[input.key] = next
      return { decision, state: next }
    }, input.now)
  }

  export async function releasePacingReservation(input: {
    key: string
    timestamp: number
    now: number
  }): Promise<void> {
    await updateStore((store) => {
      const state = store.pacing?.[input.key]
      if (!state) return
      const timestamps = [...state.timestamps]
      const index = timestamps.indexOf(input.timestamp)
      if (index === -1) return
      timestamps.splice(index, 1)
      if (timestamps.length === 0) delete store.pacing?.[input.key]
      else state.timestamps = timestamps
    }, input.now)
  }

  export async function resetForTest(): Promise<void> {
    await Filesystem.writeJson(storePath(), {})
  }

  async function updateStore<T>(fn: (store: Store) => T, now: number): Promise<T> {
    const filepath = storePath()
    const lock = await FileLock.acquire(filepath, { timeoutMs: LOCK_TIMEOUT_MS, staleMs: LOCK_STALE_MS })
    try {
      const store = await readStore()
      prune(store, now)
      const result = fn(store)
      prune(store, now)
      await Filesystem.writeJson(filepath, store, 0o600)
      return result
    } finally {
      lock[Symbol.dispose]()
    }
  }

  async function readStore(): Promise<Store> {
    const filepath = storePath()
    const raw = await Filesystem.readJson<unknown>(filepath).catch((error) => {
      if ((error as NodeJS.ErrnoException)?.code === "ENOENT") return {} as Store
      log.warn("failed to read super-long runtime store", { filepath, error })
      throw error
    })
    if (!validRecord(raw)) {
      const error = new Error("Invalid super-long runtime store: expected object")
      log.warn("failed to read super-long runtime store", { filepath, error })
      throw error
    }
    const store = raw as Store
    return {
      runs: validRecord(store.runs) ? store.runs : {},
      pacing: validRecord(store.pacing) ? store.pacing : {},
    }
  }

  function storePath() {
    return process.env[STORE_PATH_ENV] || STORE_PATH
  }

  function prune(store: Store, now: number) {
    for (const [sessionID, run] of Object.entries(store.runs ?? {})) {
      if (!validRunState(run) || now - run.lastSeenAt > RUN_RETENTION_MS) {
        delete store.runs?.[sessionID]
      }
    }
    for (const [key, state] of Object.entries(store.pacing ?? {})) {
      if (!validPacingState(state) || state.timestamps.length === 0) {
        delete store.pacing?.[key]
      }
    }
  }

  function validRecord(value: unknown): value is Record<string, any> {
    return !!value && typeof value === "object" && !Array.isArray(value)
  }

  function validRunState(value: unknown): value is RunState {
    return validRecord(value) && Number.isFinite(value.startedAt) && Number.isFinite(value.lastSeenAt)
  }

  function validPacingState(value: unknown): value is SuperLongPolicy.PacingState {
    return (
      validRecord(value) &&
      Array.isArray(value.timestamps) &&
      value.timestamps.every((item) => typeof item === "number" && Number.isFinite(item))
    )
  }
}
