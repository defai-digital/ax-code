import {
  checkedText,
  decodeGroups,
  decodePreview,
  encodeChunks,
  encodeHunks,
  encodeRows,
  parseReply,
} from "./protocol.js"
import type { DiffPreview, DuplicateGroup, Hunk, Operation, PatchChunk, Request } from "./protocol.js"
export type CompareOptions = { signal?: AbortSignal; timeoutMs?: number }
export interface DiffEngine {
  readonly backend: "wasm-worker"
  /** One in-flight call per instance; concurrent submissions fail without queueing. */
  compare(rows: readonly (readonly string[])[], threshold: number, options?: CompareOptions): Promise<DuplicateGroup[]>
  diff(before: string, after: string, options?: CompareOptions & { normalize?: boolean }): Promise<DiffPreview>
  /** Strict one-based preview coordinates; preserves bytes and rejects stale context. */
  applyHunks(original: string, hunks: readonly Hunk[], options?: CompareOptions): Promise<string>
  /** Legacy native patch semantics, including whitespace matching and final LF. */
  applyPatch(file: string, original: string, chunks: readonly PatchChunk[], options?: CompareOptions): Promise<string>
  close(): Promise<void>
}
export type DuplicateComparator = DiffEngine
export interface Endpoint {
  post(message: Request): void
  terminate(): Promise<void>
}
export type Spawn = (onMessage: (message: unknown) => void, onFailure: (error: Error) => void) => Endpoint
const TEARDOWN_MS = 1000
/** Host-independent lifecycle. No fallback hides a Wasm failure. */
export function createClient(spawn: Spawn): DiffEngine {
  let worker: Endpoint | undefined
  let ready = false,
    closed = false,
    retiring = false,
    admitting = false,
    sequence = 0
  let stopping: Promise<void> | undefined
  let job:
    | {
        request: Request
        sent: boolean
        failing: boolean
        decode: (value: string) => unknown
        resolve: (value: unknown) => void
        reject: (reason: unknown) => void
        cleanup: () => void
      }
    | undefined
  function bounded(promise: Promise<void>): Promise<void> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("Wasm worker termination timed out")), TEARDOWN_MS)
      promise.then(resolve, reject).finally(() => clearTimeout(timer))
    })
  }
  function stop(): Promise<void> {
    if (!worker) return Promise.resolve()
    retiring = true
    ready = false
    if (!stopping) {
      const old = worker
      const pending = Promise.resolve().then(() => old.terminate())
      stopping = pending
      pending
        .then(
          () => {
            if (worker === old) {
              worker = undefined
              retiring = false
            }
          },
          () => {
            /* Retain ownership; close can retry termination. */
          },
        )
        .finally(() => {
          if (stopping === pending) stopping = undefined
        })
    }
    return bounded(stopping)
  }
  async function fail(reason: unknown) {
    const current = job
    if (current?.failing) return
    if (current) {
      current.failing = true
      current.cleanup()
    }
    try {
      await stop()
    } catch {
      /* close reports termination failure; preserve the caller's original reason. */
    } finally {
      if (job === current) job = undefined
      current?.reject(reason)
    }
  }
  function send() {
    if (!ready || !worker || !job || job.sent || job.failing) return
    job.sent = true
    worker.post(job.request)
  }
  function start() {
    if (worker) {
      send()
      return
    }
    const endpoint = spawn(
      (raw) => {
        if (worker !== endpoint || retiring || job?.failing) return
        try {
          const message = parseReply(raw)
          if (message.type === "ready") {
            if (ready) throw new Error("Unexpected Wasm worker ready message")
            ready = true
            send()
            return
          }
          if (!job?.sent || message.id !== job.request.id) throw new Error("Unexpected Wasm worker response ID")
          if (message.type === "error") throw new Error(message.message)
          const result = job.decode(message.json),
            current = job
          job = undefined
          current.cleanup()
          current.resolve(result)
        } catch (error) {
          void fail(error)
        }
      },
      (error) => {
        if (worker === endpoint && !retiring) void fail(error)
      },
    )
    worker = endpoint
  }
  async function run<T>(
    encode: () => Operation,
    decode: (json: string) => T,
    options: CompareOptions = {},
  ): Promise<T> {
    const signal = options.signal,
      timeoutMs = options.timeoutMs ?? 30_000,
      startTime = performance.now()
    signal?.throwIfAborted()
    if (closed) throw new Error("Wasm comparator is closed")
    if (job || stopping || retiring || admitting) throw new Error("Wasm comparator is busy")
    if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 120_000)
      throw new RangeError("Wasm timeout must be between 1 and 120000 milliseconds")
    let operation: Operation
    admitting = true
    try {
      operation = encode()
    } finally {
      admitting = false
    }
    signal?.throwIfAborted()
    if (closed) throw new Error("Wasm comparator is closed")
    const remaining = timeoutMs - (performance.now() - startTime)
    if (remaining <= 0) throw new Error("Wasm operation timed out during admission")
    return new Promise<T>((resolve, reject) => {
      const abort = () => {
        void fail(signal!.reason)
      }
      const timer = setTimeout(() => {
        void fail(new Error("Wasm operation timed out"))
      }, remaining)
      job = {
        request: { ...operation, id: ++sequence },
        sent: false,
        failing: false,
        decode,
        resolve: (value) => resolve(value as T),
        reject,
        cleanup: () => {
          clearTimeout(timer)
          signal?.removeEventListener("abort", abort)
        },
      }
      signal?.addEventListener("abort", abort, { once: true })
      try {
        start()
      } catch (error) {
        void fail(error)
      }
    })
  }
  return {
    backend: "wasm-worker",
    compare: (rows, threshold, options) => {
      const rowCount = rows.length
      return run(
        () => ({ type: "compare", tokensJson: encodeRows(rows, threshold), threshold }),
        (json) => decodeGroups(json, rowCount),
        options,
      )
    },
    diff: (before, after, options) =>
      run(
        () => ({
          type: "diff",
          before: checkedText(before),
          after: checkedText(after),
          normalize: options?.normalize ?? false,
        }),
        decodePreview,
        options,
      ),
    applyHunks: (original, hunks, options) =>
      run(
        () => ({ type: "hunks", original: checkedText(original), hunksJson: encodeHunks(hunks) }),
        checkedText,
        options,
      ),
    applyPatch: (file, original, chunks, options) =>
      run(
        () => ({
          type: "patch",
          file: checkedText(file),
          original: checkedText(original),
          chunksJson: encodeChunks(chunks),
        }),
        checkedText,
        options,
      ),
    async close() {
      closed = true
      if (job) await fail(new Error("Wasm comparator is closed"))
      await stop()
    },
  }
}
