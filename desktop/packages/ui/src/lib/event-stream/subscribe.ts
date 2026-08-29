/**
 * subscribeEventStream — ref-counted simple facade over createEventTransport
 * for the two small EventSource consumers (openchamber app events and web
 * notifications). Lazily connects on the first subscriber and closes on the
 * last unsubscribe. Entries are keyed by URL; the first subscriber's profile
 * (heartbeat / backoff) wins for the lifetime of the entry.
 *
 * The facade parses the openchamber envelope protocol ({ type, properties }):
 * unparseable frames are dropped, the `openchamber:event-stream-ready`
 * envelope is consumed as the ready signal (fired through onReady, never
 * forwarded), everything else is forwarded to onEnvelope.
 */

import { createEventTransport } from "./client"
import type { BackoffProfile, EventTransport } from "./types"

export type EventStreamEnvelope = {
  type: string
  properties: unknown
}

export type SubscribeEventStreamOptions = {
  url: string
  heartbeatTimeoutMs?: number
  backoff?: Partial<BackoffProfile>
  onEnvelope: (env: EventStreamEnvelope) => void
  onReady?: () => void
}

const EVENT_STREAM_READY_TYPE = "openchamber:event-stream-ready"

// Browser-native EventSource retries on a roughly constant ~3s timer; that is
// the schedule the notification stream has always effectively run on, so it
// is the facade default (no overriding per-attempt escalation).
const DEFAULT_BACKOFF: BackoffProfile = {
  baseMs: 3_000,
  capVisibleMs: 3_000,
  capHiddenMs: 3_000,
  maxExponent: 0,
}

type Subscriber = {
  onEnvelope: (env: EventStreamEnvelope) => void
  onReady?: () => void
}

type Entry = {
  transport: EventTransport
  subscribers: Set<Subscriber>
}

const entries = new Map<string, Entry>()

const parseEnvelope = (raw: unknown): EventStreamEnvelope | null => {
  if (typeof raw !== "string" || raw.trim().length === 0) {
    return null
  }

  try {
    const parsed = JSON.parse(raw)
    const type = typeof parsed?.type === "string" ? parsed.type : ""
    if (!type) {
      return null
    }
    return { type, properties: parsed?.properties }
  } catch {
    return null
  }
}

export function subscribeEventStream(opts: SubscribeEventStreamOptions): () => void {
  if (typeof window === "undefined" || typeof EventSource !== "function") {
    return () => {}
  }

  const key = opts.url
  let entry = entries.get(key)
  if (!entry) {
    const subscribers = new Set<Subscriber>()
    const transport = createEventTransport(
      {
        drivers: { primary: { kind: "sse-eventsource", url: opts.url } },
        transport: "sse",
        heartbeatTimeoutMs: opts.heartbeatTimeoutMs,
        backoff: { ...DEFAULT_BACKOFF, ...opts.backoff },
        // The small consumers never subscribed to browser lifecycle events;
        // keep it that way (browser-native EventSource had none either).
        interruptSignals: false,
      },
      {
        onFrame: (frame) => {
          const envelope = parseEnvelope(frame)
          if (!envelope) {
            return
          }
          if (envelope.type === EVENT_STREAM_READY_TYPE) {
            for (const subscriber of subscribers) {
              subscriber.onReady?.()
            }
            return
          }
          for (const subscriber of subscribers) {
            subscriber.onEnvelope(envelope)
          }
        },
        onConnected: () => {},
      },
    )
    entry = { transport, subscribers }
    entries.set(key, entry)
  }

  const subscriber: Subscriber = { onEnvelope: opts.onEnvelope, ...(opts.onReady ? { onReady: opts.onReady } : {}) }
  entry.subscribers.add(subscriber)

  return () => {
    const current = entries.get(key)
    if (!current) {
      return
    }
    current.subscribers.delete(subscriber)
    if (current.subscribers.size === 0) {
      current.transport.close()
      entries.delete(key)
    }
  }
}
