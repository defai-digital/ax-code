import fs from "node:fs/promises"
import { unlinkSync, writeFileSync } from "node:fs"
import path from "node:path"
import { createHash, randomUUID } from "node:crypto"
import z from "zod"
import { Global } from "@/global"
import { Filesystem } from "@/util/filesystem"
import { Log } from "@/util/log"
import { parseJsonResult } from "@/util/json-value"
import { currentLockHost, isSameProcessLockHost } from "@/util/process-lock"
import { sleep } from "@/util/timeout"

// Provider concurrency governor (PRD-2026-09-22 Waves B and C).
//
// The AX Trust gateway (and other shared gateways) enforce an opaque,
// account-wide concurrent-request pool. Reactive retry alone cannot keep a
// single process — let alone several parallel `ax-code run` processes on one
// machine — under that bound, so every provider request must first acquire a
// slot here:
//
//   using slot = await ProviderConcurrencyGovernor.acquire({ providerID })
//   ...entire provider request lifetime (setup through full response drain)...
//   // `using` exit (or slot[Symbol.dispose]()) releases the slot
//
// Two layers, composed:
//
//   Layer 1 (in-process): one FIFO semaphore per providerID. Bounds THIS
//   process's own fan-out (tool calls, subagents, council/arena members,
//   workflow children) and is the fair "wait my share" queue.
//
//   Layer 2 (cross-process, best-effort): one lease file per held slot under
//   <state>/provider-slots/<providerHash>/, with PID+host liveness and TTL
//   so a crashed holder's slot is reclaimable. Bounds the whole machine. This
//   layer ALWAYS fails open: any I/O error, timeout, or unexpected exception
//   is treated as "admission granted" — it is risk reduction, never a gate
//   that can wedge a request Layer 1 already admitted.
//
// This module is deliberately bootstrap-independent: it imports no config or
// Instance and takes everything (limit overrides, state root) as parameters,
// so it is unit-testable in isolation. The future wiring point (Wave D,
// processor-impl.ts) reads its own config and passes `configuredLimit` in.
//
// ADR-084: this module only ever tracks request-lease counts and durations —
// no cost or dollar figures.

const log = Log.create({ service: "provider-concurrency-governor" })

interface LeaseBody {
  pid: number
  host: string
  acquiredAt: number
  ttlMs: number
}

// Lease bodies are untrusted filesystem input; validate before probing (a
// negative PID would make process.kill() signal a process group). Mirrors
// the ProcessLockBody validation in util/process-lock.ts.
const LeaseBodySchema = z
  .object({
    pid: z.number().int().positive().safe(),
    host: z.string(),
    acquiredAt: z.number().int().nonnegative().safe(),
    ttlMs: z.number().int().positive().safe(),
  })
  .passthrough()

interface ProviderState {
  inFlight: number
  queue: Array<{ resolve: () => void; reject: (e: unknown) => void }>
}

const providers = new Map<string, ProviderState>()

function stateFor(providerID: string): ProviderState {
  let state = providers.get(providerID)
  if (!state) {
    state = { inFlight: 0, queue: [] }
    providers.set(providerID, state)
  }
  return state
}

function abortError(): unknown {
  // Same shape as session/retry.ts sleep()'s rejection (not imported from
  // there — this module must not depend on session internals).
  return new DOMException("Aborted", "AbortError")
}

function isAbortError(err: unknown): boolean {
  return err instanceof DOMException && err.name === "AbortError"
}

function noopDisposable(): Disposable {
  return {
    // `Disposable` is the built-in TypeScript interface (a plain
    // `{ [Symbol.dispose](): void }`); src/util/filelock.ts relies on the
    // same global type and exports no Disposable of its own, so there is
    // nothing to import — the shapes are identical by construction.
    [Symbol.dispose]: () => {},
  }
}

function resolveLimit(input: ProviderConcurrencyGovernor.AcquireInput): number {
  // Precedence: explicit `limit` argument > operator env var > caller-read
  // `configuredLimit` (per-provider config, supplied by future wiring) >
  // hardcoded default. The env var beats config because it is the operator's
  // machine-wide escape hatch.
  if (typeof input.limit === "number") return input.limit
  const raw = process.env[ProviderConcurrencyGovernor.ENV_LIMIT]?.trim()
  if (raw && /^\d+$/.test(raw)) {
    const parsed = Number.parseInt(raw, 10)
    if (parsed > 0) return parsed
  }
  if (typeof input.configuredLimit === "number") return input.configuredLimit
  return ProviderConcurrencyGovernor.DEFAULT_LIMIT
}

function isUnlimited(limit: number): boolean {
  // Fail open: a nonsensical limit must never block a provider request.
  return !Number.isFinite(limit) || limit <= 0
}

function providerHash(providerID: string): string {
  return createHash("sha256").update(providerID).digest("hex").slice(0, 16)
}

async function readLeaseBody(file: string): Promise<LeaseBody | undefined> {
  const text = await fs.readFile(file, "utf-8").catch((err: NodeJS.ErrnoException) => {
    if (err?.code === "ENOENT") return undefined
    throw err
  })
  if (!text) return undefined
  const parsed = parseJsonResult(text)
  if (!parsed.ok) return undefined
  const decoded = LeaseBodySchema.safeParse(parsed.value)
  return decoded.success ? (decoded.data as LeaseBody) : undefined
}

async function pruneLeaseFile(file: string): Promise<boolean> {
  try {
    await fs.unlink(file)
    return true
  } catch (err) {
    if ((err as NodeJS.ErrnoException)?.code === "ENOENT") return true
    log.debug("failed to prune provider slot lease", { file, err })
    return false
  }
}

// Count live leases in `dir`, pruning abandoned ones along the way. Liveness
// logic mirrors src/util/filelock.ts `maybeSteal` (not exported there, so
// replicated here with credit): a lease is dead when its TTL expired, or when
// it is same-host and its PID no longer exists (kill(pid, 0) ESRCH). Entries
// from other hosts are trusted within their TTL — PIDs cannot be probed
// cross-host. Corrupted/unparseable bodies count as live until their mtime
// outlives the TTL window (the same conservative rule filelock applies to
// empty lockfiles: never reclaim something that might be mid-write).
async function countLiveLeases(dir: string): Promise<number> {
  const entries = await fs.readdir(dir)
  let live = 0
  for (const name of entries) {
    if (!name.endsWith(".json")) continue
    // @scan-suppress security_scan - readdir supplies a single entry name beneath the internal lease directory.
    const file = path.join(dir, name)
    const body = await readLeaseBody(file).catch(() => undefined)
    if (!body) {
      const mtimeMs = await fs
        .stat(file)
        .then((stats) => stats.mtimeMs)
        .catch(() => undefined)
      if (mtimeMs === undefined) continue // vanished — not holding anything
      if (Date.now() - mtimeMs > ProviderConcurrencyGovernor.DEFAULT_TTL_MS) {
        await pruneLeaseFile(file) // abandoned beyond any legitimate write
      } else {
        live++ // ambiguous (possibly mid-write) — count conservatively
      }
      continue
    }
    if (Date.now() - body.acquiredAt > body.ttlMs) {
      await pruneLeaseFile(file)
      continue
    }
    if (isSameProcessLockHost(body) && body.pid !== process.pid) {
      try {
        process.kill(body.pid, 0)
      } catch (err) {
        if ((err as NodeJS.ErrnoException)?.code === "ESRCH") {
          await pruneLeaseFile(file)
          continue
        }
        // EPERM etc. means the process exists — the lease stays live.
      }
    }
    live++
  }
  return live
}

interface HeldLease {
  file: string
  heartbeat: NodeJS.Timeout
}

async function writeLease(dir: string, ttlMs: number): Promise<HeldLease> {
  // @scan-suppress security_scan - The lease filename consists only of the process ID and a generated UUID.
  const file = path.join(dir, `${process.pid}-${randomUUID()}.json`)
  const body: LeaseBody = {
    pid: process.pid,
    host: currentLockHost(),
    acquiredAt: Date.now(),
    ttlMs,
  }
  // O_EXCL create, same as filelock.writeLockFile, so two racers can never
  // share a filename (the random UUID makes collision negligible anyway).
  const handle = await fs.open(file, "wx")
  try {
    await handle.writeFile(JSON.stringify(body))
  } finally {
    await handle.close()
  }
  // @scan-suppress lifecycle_scan - releaseLease clears the returned interval before synchronously unlinking its file.
  const heartbeat = setInterval(() => {
    // Keep this tiny write synchronous with releaseLease: a pending async
    // write could recreate the file after disposal. r+ also refuses to create
    // a lease already reclaimed by another process.
    try {
      writeFileSync(file, JSON.stringify({ ...body, acquiredAt: Date.now() }), { flag: "r+" })
    } catch (err) {
      log.warn("provider slot lease heartbeat failed", { file, err })
    }
  }, HEARTBEAT_INTERVAL_MS)
  heartbeat.unref()
  return { file, heartbeat }
}

function releaseLease(lease: HeldLease | undefined): void {
  if (!lease) return
  clearInterval(lease.heartbeat)
  try {
    // Sync unlink inside Symbol.dispose, matching filelock's BUG-117 lesson:
    // an async delete lets the file linger after dispose returns, so the next
    // acquirer would count a slot that is already free. Our filename is
    // unique per acquire (uuid), so this can never delete another holder's
    // lease even after our body was pruned and replaced.
    unlinkSync(lease.file)
  } catch {
    // Best-effort release: ENOENT (already pruned as stale) and any other
    // error are swallowed — the TTL reclaims the slot eventually.
  }
}

// Layer 2: acquire a cross-process lease slot, or fail open. Never throws
// except AbortError (a caller-initiated cancel is not an internal failure).
async function acquireCrossProcessLease(opts: {
  dir: string
  limit: number
  timeoutMs: number
  ttlMs: number
  signal?: AbortSignal
}): Promise<HeldLease | undefined> {
  const deadline = Date.now() + opts.timeoutMs
  try {
    await fs.mkdir(opts.dir, { recursive: true })
    while (true) {
      opts.signal?.throwIfAborted()
      let live: number
      try {
        live = await countLiveLeases(opts.dir)
      } catch (err) {
        if ((err as NodeJS.ErrnoException)?.code === "ENOENT") live = 0
        else throw err
      }
      if (live < opts.limit) return await writeLease(opts.dir, opts.ttlMs)
      if (Date.now() >= deadline) {
        log.warn("cross-process provider slot wait timed out; admitting without a lease", {
          dir: opts.dir,
          limit: opts.limit,
          live,
          timeoutMs: opts.timeoutMs,
        })
        return undefined
      }
      await sleep(POLL_INTERVAL_MS)
    }
  } catch (err) {
    if (opts.signal?.aborted) throw abortError()
    if (isAbortError(err)) throw err
    // Fail open, always: Layer 2 is best-effort risk reduction, never a
    // hard gate that can wedge a request Layer 1 already admitted.
    log.warn("cross-process provider slot layer failed open", { dir: opts.dir, err })
    return undefined
  }
}

function releaseInProcess(state: ProviderState): void {
  state.inFlight = Math.max(0, state.inFlight - 1)
  // Hand the slot to the next FIFO waiter directly; inFlight stays at the
  // limit until that waiter disposes, so no later arrival can jump the queue.
  const next = state.queue.shift()
  if (next) {
    state.inFlight++
    next.resolve()
  }
}

// Poll cadence while waiting for a foreign lease to clear. FileLock polls at
// 50ms for its mutex; 200ms is enough for a counting semaphore whose holders
// release in seconds, and keeps idle stat traffic low.
const POLL_INTERVAL_MS = 200

// Heartbeat cadence — refreshes acquiredAt well inside the TTL while held.
// 30s against a 120s TTL gives four missed refreshes before pruning.
const HEARTBEAT_INTERVAL_MS = 30_000

export namespace ProviderConcurrencyGovernor {
  // Default concurrent-request bound per provider when nothing overrides it.
  // 8 comfortably covers a main session plus a few subagents/council members
  // while staying below typical shared-gateway pool sizes; the incident that
  // motivated this module involved several simultaneous requests from
  // parallel processes on one machine.
  export const DEFAULT_LIMIT = 8

  // Operator escape hatch: applies to every provider, beats per-provider
  // config (an operator-set env var should win over what a project config
  // file says).
  export const ENV_LIMIT = "AX_CODE_PROVIDER_MAX_CONCURRENT_REQUESTS"

  // Cross-process lease TTL: must exceed the longest legitimate provider
  // request heartbeat gap, short enough that a crashed holder's slots free
  // up reasonably fast. The heartbeat re-writes `acquiredAt` well inside
  // this window while a slot is genuinely held.
  export const DEFAULT_TTL_MS = 120_000

  // Bounded total Layer 2 wait before failing open. Layer 1 already provides
  // fair in-process queuing, so Layer 2 only needs to keep THIS process from
  // exceeding the machine-wide bound — callers never wait indefinitely here.
  export const DEFAULT_CROSS_PROCESS_TIMEOUT_MS = 30_000

  export interface AcquireInput {
    providerID: string
    /** Explicit per-call limit override. */
    limit?: number
    /** Rejects with AbortError if aborted while queued (or during the Layer 2 wait). */
    signal?: AbortSignal
    /** Default true; false skips the cross-process layer for this acquire (tests). */
    crossProcess?: boolean
    /**
     * For future wiring (Wave D): a caller that already read
     * `provider.<id>.options.maxConcurrentRequests` passes it here. This
     * module must not import src/config, so it cannot read config itself.
     * Precedence: `limit` > env var > `configuredLimit` > DEFAULT_LIMIT.
     */
    configuredLimit?: number
    /** Test-only injection of the state root (default: Global.Path.state). */
    stateRoot?: string
    /** Test-only bound on the Layer 2 wait before failing open (default 30s). */
    crossProcessTimeoutMs?: number
  }

  /**
   * Acquire one concurrency slot for a provider request. Await this, then
   * keep the returned Disposable for the ENTIRE lifetime of one provider
   * request (setup through full response drain); disposing releases the
   * in-process slot and, if held, the cross-process lease — exactly once,
   * idempotently.
   *
   * Rejects only with AbortError (DOMException) when `signal` aborts while
   * queued or during the cross-process wait. Everything else fails open: an
   * admission-control bug must never block a provider request forever.
   */
  export async function acquire(input: AcquireInput): Promise<Disposable> {
    try {
      return await acquireInner(input)
    } catch (err) {
      if (input.signal?.aborted) throw abortError()
      if (isAbortError(err)) throw err
      log.error("provider concurrency governor failed open", { providerID: input.providerID, err })
      return noopDisposable()
    }
  }

  /** Test helper — reset in-process queue state between unit tests. */
  export function resetForTests(providerID?: string) {
    // Follows retry.ts resetNetworkCircuit's naming/visibility convention.
    // Assumes no in-flight acquires: disposables created before the reset
    // keep operating on their detached state objects (harmless).
    if (providerID) {
      providers.delete(providerID)
    } else {
      providers.clear()
    }
  }
}

async function acquireInner(input: ProviderConcurrencyGovernor.AcquireInput): Promise<Disposable> {
  input.signal?.throwIfAborted()

  const providerID = input.providerID
  if (typeof providerID !== "string" || providerID === "") {
    // Defensive: a malformed key can never gate (fail open).
    return noopDisposable()
  }

  const limit = resolveLimit(input)
  if (isUnlimited(limit)) {
    // Unlimited: no in-process gate, and counting against "unlimited" on the
    // machine is meaningless, so skip Layer 2 as well.
    return noopDisposable()
  }

  // ---- Layer 1: in-process FIFO semaphore ----
  const state = stateFor(providerID)
  if (state.inFlight < limit) {
    state.inFlight++
  } else {
    await new Promise<void>((resolve, reject) => {
      const waiter = { resolve, reject }
      state.queue.push(waiter)
      if (input.signal) {
        const signal = input.signal
        const onAbort = () => {
          const index = state.queue.indexOf(waiter)
          if (index !== -1) state.queue.splice(index, 1)
          reject(abortError())
        }
        // @scan-suppress race_scan - Both settlement wrappers below remove this listener; an abort removes itself through once.
        signal.addEventListener("abort", onAbort, { once: true })
        // `once` removes the listener only after the abort fires. A normal
        // release-handoff resolves the waiter without firing abort, leaving a
        // dangling listener on a long-lived shared signal. Wrap both settle
        // callbacks once so every path removes the listener, keeping
        // releaseInProcess (which calls next.resolve()) unaware of cleanup.
        const cleanup = () => signal.removeEventListener("abort", onAbort)
        waiter.resolve = () => {
          cleanup()
          resolve()
        }
        waiter.reject = (err: unknown) => {
          cleanup()
          reject(err)
        }
      }
    })
    // Resolved means a release handed this waiter the slot (inFlight was
    // already re-incremented by the releaser); rejected means aborted, which
    // propagates out of acquireInner untouched.
  }

  // ---- Layer 2: cross-process lease (best-effort, fail-open) ----
  let lease: HeldLease | undefined
  if (input.crossProcess !== false) {
    try {
      const stateRoot = input.stateRoot ?? Filesystem.resolve(Global.Path.state)
      // @scan-suppress security_scan - The only variable path component is a fixed-width hexadecimal provider hash.
      const dir = path.join(stateRoot, "provider-slots", providerHash(providerID))
      lease = await acquireCrossProcessLease({
        dir,
        limit,
        timeoutMs: input.crossProcessTimeoutMs ?? ProviderConcurrencyGovernor.DEFAULT_CROSS_PROCESS_TIMEOUT_MS,
        ttlMs: ProviderConcurrencyGovernor.DEFAULT_TTL_MS,
        signal: input.signal,
      })
    } catch (err) {
      // Abort during the Layer 2 wait must unwind the Layer 1 slot too. Any
      // non-abort error was already failed open inside the callee, so this
      // path only fires on setup bugs — fail open there as well, keeping the
      // slot (the caller's request proceeds ungated cross-process).
      if (isAbortError(err)) {
        releaseInProcess(state)
        throw err
      }
      lease = undefined
    }
  }

  // A signal can arrive after FIFO handoff or while the lease write awaits
  // I/O. Ownership has transferred, so unwind both layers before rejecting.
  if (input.signal?.aborted) {
    releaseLease(lease)
    releaseInProcess(state)
    throw abortError()
  }

  let disposed = false
  return {
    [Symbol.dispose]: () => {
      if (disposed) return
      disposed = true
      releaseLease(lease)
      releaseInProcess(state)
    },
  }
}
