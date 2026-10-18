import fs from "fs/promises"
import path from "path"
import { sleep as defaultSleep } from "../util/timeout"
import { parseJsonResult } from "../util/json-value"

/**
 * Guards for the out-of-tree snapshot Git store (ADR-248).
 *
 * Captures can collide with a concurrent writer's index lock, and a process
 * killed mid-capture leaves a half-staged index behind. These helpers keep the
 * retry, stale-lock, marker and packing rules out of `snapshot/index.ts` so
 * they can be exercised with an injected clock and sleep.
 */

/** A capture lock younger than this is never treated as abandoned. */
export const STALE_LOCK_MS = 60_000
/** Every N successful captures the store is packed with a bounded `gc --auto`. */
export const PACK_EVERY = 50
/** Hard time box for one packing run. */
export const PACK_TIMEOUT_MS = 60_000

const LOCK_COLLISION =
  /(index\.lock|\.lock': File exists|cannot lock ref|another git process|Unable to create|Unable to write new index|failed to lock|lock file already exists|reference already exists)/i

export class CaptureCollisionError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "CaptureCollisionError"
  }
}

/** True for a transient Git write/lock collision that is safe to retry. */
export function isCaptureCollision(error: unknown): boolean {
  if (error instanceof CaptureCollisionError) return true
  const message = error instanceof Error ? error.message : String(error)
  return LOCK_COLLISION.test(message)
}

/** Build a capture error that stays retryable when Git reported lock contention. */
export function captureFailure(prefix: string, code: number, stderr: string): Error {
  const message = `${prefix} exited with code ${code}`
  if (LOCK_COLLISION.test(stderr)) return new CaptureCollisionError(message)
  return new Error(message)
}

export type CaptureRetryConfig = {
  attempts?: number
  minDelayMs?: number
  maxDelayMs?: number
  sleep?: (ms: number) => Promise<void>
  random?: () => number
  isRetryable?: (error: unknown) => boolean
}

function jitter(minDelayMs: number, maxDelayMs: number, random: () => number) {
  const span = Math.max(0, maxDelayMs - minDelayMs)
  return Math.round(minDelayMs + random() * span)
}

/**
 * Run a capture attempt up to `attempts` times (default 3), sleeping a
 * jittered 50-250 ms between transient collisions.
 */
export async function withCaptureRetry<T>(run: () => Promise<T>, config: CaptureRetryConfig = {}): Promise<T> {
  // Clamp to at least one attempt: a configured 0 would skip the loop entirely
  // and fall through to `throw last`, which is still undefined at that point.
  const attempts = Math.max(1, config.attempts ?? 3)
  const minDelayMs = config.minDelayMs ?? 50
  const maxDelayMs = config.maxDelayMs ?? 250
  const sleep = config.sleep ?? defaultSleep
  const random = config.random ?? Math.random
  const isRetryable = config.isRetryable ?? isCaptureCollision
  let last: unknown
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await run()
    } catch (error) {
      last = error
      if (attempt >= attempts || !isRetryable(error)) throw error
      await sleep(jitter(minDelayMs, maxDelayMs, random))
    }
  }
  throw last
}

export type StaleLockInput = {
  /** Lock file to inspect. */
  lock: string
  /** Snapshot store root. A lock outside it is never removed. */
  store: string
  now?: number
  staleMs?: number
}

/**
 * Remove one lock file when it is inside the snapshot store and older than the
 * stale window. Returns true only when the file was actually removed.
 */
export async function removeStaleLock(input: StaleLockInput): Promise<boolean> {
  const store = path.resolve(input.store)
  const lock = path.resolve(input.lock)
  // Never step outside the snapshot store, and never touch the store root.
  if (lock === store || !lock.startsWith(store + path.sep)) return false
  const stat = await fs.lstat(lock).catch(() => undefined)
  // Symlinks are not ours to remove; Git's own lock files are plain files.
  if (!stat?.isFile()) return false
  const now = input.now ?? Date.now()
  const staleMs = input.staleMs ?? STALE_LOCK_MS
  if (now - stat.mtimeMs < staleMs) return false
  // Only a successful removal counts: force:true suppresses ENOENT, but an
  // EACCES/EPERM/EBUSY failure must not be reported as "lock cleared" — the
  // caller would otherwise proceed straight into the collision it was trying
  // to pre-clear.
  return fs.rm(lock, { force: true }).then(
    () => true,
    () => false,
  )
}

/** Fixed set of top-level Git locks the capture path contends for. */
export function snapshotLockPaths(gitdir: string): string[] {
  return ["index.lock", "HEAD.lock", "packed-refs.lock", "config.lock"].map((name) => path.join(gitdir, name))
}

/** Remove any stale top-level Git lock inside the store. */
export async function clearStaleSnapshotLocks(input: {
  gitdir: string
  now?: number
  staleMs?: number
}): Promise<string[]> {
  const removed: string[] = []
  for (const lock of snapshotLockPaths(input.gitdir)) {
    if (await removeStaleLock({ lock, store: input.gitdir, now: input.now, staleMs: input.staleMs })) removed.push(lock)
  }
  return removed
}

export type CaptureMarker = {
  pid: number
  startedAt: number
}

export function captureMarkerPath(gitdir: string): string {
  return path.join(gitdir, "ax-code", "capture.marker")
}

export async function writeCaptureMarker(gitdir: string, marker: CaptureMarker): Promise<void> {
  const file = captureMarkerPath(gitdir)
  await fs.mkdir(path.dirname(file), { recursive: true })
  await fs.writeFile(file, JSON.stringify(marker))
}

export async function removeCaptureMarker(gitdir: string): Promise<void> {
  await fs.rm(captureMarkerPath(gitdir), { force: true }).catch(() => undefined)
}

function parseMarker(value: unknown): CaptureMarker | undefined {
  if (!value || typeof value !== "object") return undefined
  const record = value as Record<string, unknown>
  const pid = typeof record.pid === "number" ? record.pid : undefined
  const startedAt = typeof record.startedAt === "number" ? record.startedAt : undefined
  if (pid === undefined || startedAt === undefined) return undefined
  return { pid, startedAt }
}

function pidAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    // EPERM means the process exists but belongs to another user.
    return (error as NodeJS.ErrnoException | undefined)?.code === "EPERM"
  }
}

export type MarkerRecoveryInput = {
  gitdir: string
  now?: number
  staleMs?: number
  pidAlive?: (pid: number) => boolean
}

/**
 * An interrupted capture is only abandoned when its marker is old enough or
 * its owner is gone. A fresh marker from a live process belongs to a capture
 * that is still running in another process and must be left alone.
 */
export function markerInterrupted(
  marker: CaptureMarker,
  input: { now?: number; staleMs?: number; pidAlive?: (pid: number) => boolean } = {},
): boolean {
  const now = input.now ?? Date.now()
  const staleMs = input.staleMs ?? STALE_LOCK_MS
  if (!Number.isFinite(marker.startedAt)) return true
  if (now - marker.startedAt >= staleMs) return true
  if (marker.pid === process.pid) return true
  const alive = input.pidAlive ?? pidAlive
  if (!Number.isFinite(marker.pid)) return true
  return !alive(marker.pid)
}

/**
 * Discard the partial on-disk state of an interrupted capture: the marker, the
 * torn staging index, and any index lock it left behind. Returns true when a
 * recovery actually happened.
 *
 * The marker is claimed with an atomic rename before anything is deleted.
 * Between the read above and the deletes, another process can complete its
 * own recovery and start a fresh capture with a new marker and a live index;
 * without the claim, this pass would delete that capture's index mid-write.
 * The rename either wins (the marker path is gone, so concurrent recovery
 * returns false and concurrent captures write a fresh marker at the canonical
 * path) or fails (someone else recovered first — report no recovery).
 */
export async function recoverInterruptedCapture(input: MarkerRecoveryInput): Promise<boolean> {
  const file = captureMarkerPath(input.gitdir)
  const text = await fs.readFile(file, "utf8").catch(() => undefined)
  if (text === undefined) return false
  const parsed = parseJsonResult(text)
  const marker = parsed.ok ? parseMarker(parsed.value) : undefined
  if (marker) {
    if (!markerInterrupted(marker, input)) return false
  } else {
    // Filesystem.write is atomic, so an unparseable marker is a leftover. Wait
    // for the stale window before touching it in case it is mid-write.
    const stat = await fs.stat(file).catch(() => undefined)
    const now = input.now ?? Date.now()
    const staleMs = input.staleMs ?? STALE_LOCK_MS
    if (!stat || now - stat.mtimeMs < staleMs) return false
  }
  const claim = `${file}.${process.pid}.${Date.now()}.reclaiming`
  const claimed = await fs.rename(file, claim).then(
    () => true,
    () => false,
  )
  if (!claimed) return false
  await fs.rm(path.join(input.gitdir, "index"), { force: true }).catch(() => undefined)
  await fs.rm(path.join(input.gitdir, "index.lock"), { force: true }).catch(() => undefined)
  await fs.rm(claim, { force: true }).catch(() => undefined)
  return true
}

/**
 * Counts successful captures and gates bounded packing. `maybePack` refuses to
 * start while a capture is in progress or another pack is already running, so
 * packing never overlaps either operation.
 */
export class CapturePacker {
  private successes = 0
  private running = false
  private readonly every: number

  constructor(input: { every?: number } = {}) {
    this.every = input.every ?? PACK_EVERY
  }

  get captures() {
    return this.successes
  }

  get packing() {
    return this.running
  }

  /** Record one successful capture; true when a pack is due. */
  recordSuccess(): boolean {
    this.successes += 1
    return this.successes % this.every === 0
  }

  /** Run a packing pass unless one is already running or a capture is active. */
  async maybePack(run: () => Promise<void>, opts: { capturing: boolean }): Promise<boolean> {
    if (opts.capturing || this.running) return false
    this.running = true
    try {
      await run()
      return true
    } finally {
      this.running = false
    }
  }
}
