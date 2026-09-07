import type { EventJournalEntry, EventJournalReplay } from "@/bus/event-journal"
import { Log } from "@/util/log"
import { AsyncQueue } from "@/util/queue"
import { encodeSsePayload, SSE_HARD_MAX, SSE_WARN_THRESHOLD } from "@/util/sse-queue"

export namespace EventStream {
  const log = Log.create({ service: "server.event-stream" })
  const HEARTBEAT_INTERVAL_MS = 10_000
  // A single frame write that stalls beyond this long means the client has
  // silently died (sleep/wake, proxy drop without RST). Without a deadline the
  // writer loop parks forever and the connection becomes a zombie that still
  // receives every Bus.publish fan-out. Close it instead.
  const WRITE_DEADLINE_MS = 30_000

  export type Frame = { data: string; id?: string }
  export type Writer = {
    readonly aborted: boolean
    onAbort(listener: () => void): void
    writeSSE(frame: Frame): Promise<void>
  }
  export type Subscription<T> = {
    cursor: string
    replay?: EventJournalReplay<T>
    unsubscribe(): void
  }
  export type Control = {
    type: "server.connected" | "server.heartbeat" | "server.resync_required"
    properties: { reason?: string; cursor?: string }
  }
  export type Options<T> = {
    label: string
    cursor?: string
    subscribe(cursor: string | undefined, listener: (entry: EventJournalEntry<T>) => void): Subscription<T>
    filter?(value: T): boolean
    project?(entry: EventJournalEntry<T>): Frame
    control?(event: Control): unknown
    terminate?(value: T): boolean
    maxQueueSize?: number
    warnThreshold?: number
    heartbeatQueueLimit?: number
    writeDeadlineMs?: number
  }

  // Write one frame with a deadline. Resolves "stalled" when the writer hangs
  // past `ms` (the client silently died); re-throws genuine write failures so
  // callers keep the original error-propagation contract.
  async function writeWithDeadline(writer: Writer, frame: Frame, ms: number): Promise<"ok" | "stalled"> {
    let settled = false
    return new Promise<"ok" | "stalled">((resolve, reject) => {
      const timer = setTimeout(() => {
        if (settled) return
        settled = true
        resolve("stalled")
      }, ms)
      timer.unref?.()
      writer.writeSSE(frame).then(
        () => {
          if (settled) return
          settled = true
          clearTimeout(timer)
          resolve("ok")
        },
        (error) => {
          if (settled) return
          settled = true
          clearTimeout(timer)
          reject(error)
        },
      )
    })
  }

  /** Own connection resources; adapters own authorization, scope, and wire envelopes. */
  export async function run<T>(stream: Writer, options: Options<T>) {
    const queue = new AsyncQueue<Frame>()
    const maxQueueSize = options.maxQueueSize ?? SSE_HARD_MAX
    const warnThreshold = options.warnThreshold ?? SSE_WARN_THRESHOLD
    const heartbeatQueueLimit = Math.min(options.heartbeatQueueLimit ?? 256, maxQueueSize)
    let done = false
    let warned = false
    let heartbeat: ReturnType<typeof setInterval> | undefined
    let unsubscribe: (() => void) | undefined

    const detach = () => {
      const cleanup = unsubscribe
      unsubscribe = undefined
      try {
        cleanup?.()
      } catch (error) {
        log.warn("event unsubscribe failed", { stream: options.label, error })
      }
    }
    const stop = () => {
      if (done) return
      done = true
      if (heartbeat !== undefined) clearInterval(heartbeat)
      detach()
      queue.close()
      log.info("event disconnected", { stream: options.label })
    }
    const accepts = (entry: EventJournalEntry<T>) => options.filter?.(entry.value) ?? true
    const push = (entry: EventJournalEntry<T>) => {
      if (done) return
      if (queue.size >= maxQueueSize) {
        log.warn("SSE queue overflow; disconnecting client for resync", {
          stream: options.label,
          queueSize: queue.size,
          hardMax: maxQueueSize,
        })
        stop()
        return
      }
      queue.push(options.project ? options.project(entry) : { data: entry.data, id: entry.id })
      if (queue.size >= warnThreshold && !warned) {
        warned = true
        log.warn("SSE queue approaching capacity", {
          stream: options.label,
          queueSize: queue.size,
          warnThreshold,
          hardMax: maxQueueSize,
        })
      }
    }
    const pushControl = (event: Control, id?: string, limit = maxQueueSize) => {
      if (done || queue.size >= limit) return
      queue.push({ data: encodeSsePayload(options.control ? options.control(event) : event), id })
    }

    // Protect setup too: subscription/replay/projection failures must release
    // resources even when the writer loop has not started yet.
    try {
      stream.onAbort(stop)
      if (done || stream.aborted) return

      const subscription = options.subscribe(options.cursor, (entry) => {
        if (done || !accepts(entry)) return
        push(entry)
        if (options.terminate?.(entry.value)) stop()
      })
      unsubscribe = subscription.unsubscribe
      // A synchronous subscription callback may have already stopped us.
      if (done) detach()

      if (!done && subscription.replay?.type === "replay") {
        const entries = subscription.replay.entries.filter(accepts)
        // Reserve space for acknowledgement. Never silently truncate replay;
        // the workspace adapter's smaller cap can be below journal retention.
        if (entries.length >= maxQueueSize - 1) {
          pushControl(
            {
              type: "server.resync_required",
              properties: { reason: "buffer_overflow", cursor: subscription.replay.cursor },
            },
            subscription.replay.cursor,
          )
        } else {
          for (const entry of entries) {
            push(entry)
            if (done) break
          }
        }
      } else if (!done && subscription.replay?.type === "gap") {
        pushControl(
          {
            type: "server.resync_required",
            properties: { reason: subscription.replay.reason, cursor: subscription.replay.cursor },
          },
          subscription.replay.cursor,
        )
      }

      pushControl({ type: "server.connected", properties: {} }, subscription.cursor)
      if (!done) {
        heartbeat = setInterval(() => {
          try {
            pushControl({ type: "server.heartbeat", properties: {} }, undefined, heartbeatQueueLimit)
          } catch (error) {
            log.warn("event heartbeat failed", { stream: options.label, error })
          }
        }, HEARTBEAT_INTERVAL_MS)
        heartbeat.unref?.()
      }

      const writeDeadlineMs = options.writeDeadlineMs ?? WRITE_DEADLINE_MS
      for await (const frame of queue) {
        if (stream.aborted) break
        if ((await writeWithDeadline(stream, frame, writeDeadlineMs)) === "stalled") {
          log.warn("event write stalled; closing connection", { stream: options.label })
          // Close the queue before leaving the loop: the iterator parks on an
          // awaited next() that `break` cannot interrupt, so stop() releases the
          // pending read (CLOSED) and lets the for-await terminate cleanly.
          stop()
          break
        }
      }
    } finally {
      stop()
    }
  }
}
