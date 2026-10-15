/**
 * Elide `text` from in-progress text/reasoning `message.part.updated`
 * snapshots when the deltas already forwarded on this stream cover a prefix
 * of that text.
 *
 * The TUI projection applies `message.part.delta` itself, so a progress
 * snapshot that repeats text the renderer already holds is redundant. The
 * processor publishes a snapshot while the 16ms delta batcher still holds
 * the latest chunks: at snapshot time the covered text is a prefix
 * (`end <= text.length`). Those pending deltas are on the same ordered
 * stream and arrive right after the snapshot, so a renderer that keeps its
 * prefix and then applies them ends in the same state as one that received
 * the full part. `end === text.length` is the special case where nothing
 * is still buffered.
 *
 * An elided snapshot carries `properties.elided = { end, tail }`: the prefix
 * length this side believes the renderer holds and the last 64 chars of it.
 * The renderer checks that against its own text and refetches the session
 * when they disagree, so no periodic full snapshot is needed; every elided
 * snapshot is itself the check.
 *
 * A missing offset, non-text field, or prefix mismatch still forwards the
 * full part. A gap (`offset > end`) invalidates coverage: the renderer skips
 * that delta and every later one, so the next snapshot must be full and
 * heals immediately. Overlap (`offset <= end`) appends only the suffix past
 * `end`, the same reconcile as `appendPartTextDelta`.
 *
 * Reasoning parts publish deltas on the same channel as text parts:
 * `processor-impl` pushes both through the delta batcher, which always sets
 * `field: "text"`. Other fields do not extend coverage.
 *
 * State per part is the coverage end (contiguous from 0) and the last 64
 * covered chars. The input event and its part are never mutated.
 */

const TAIL_CHARS = 64
const MAX_TRACKED_PARTS = 256

export type PartStreamEvent = {
  type?: string
  properties?: unknown
  [key: string]: unknown
}

/** What the worker believes the renderer holds when it elides a snapshot. */
export type ElidedPartCoverage = { end: number; tail: string }

export type PartSnapshotElider = {
  /**
   * Return the event to emit: the original, or a shallow copy whose part has
   * no `text` and whose properties carry `elided`.
   */
  observe<T extends PartStreamEvent>(event: T): T
  /** Drop every part. The next snapshot is treated as the first. */
  reset(): void
}

type PartTrack = {
  /** A full snapshot of this part has been forwarded. */
  full: boolean
  /**
   * End of coverage contiguous from 0. Absent once a missing offset, a
   * non-text field, or a gap (`offset > end`) has invalidated coverage.
   * The next full snapshot re-seeds it.
   */
  end?: number
  /** Last `TAIL_CHARS` of the covered text. Empty while coverage is invalid. */
  tail: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value)
}

function integerOffset(value: unknown): number | undefined {
  return typeof value === "number" && Number.isInteger(value) ? value : undefined
}

function takeTail(text: string): string {
  return text.length <= TAIL_CHARS ? text : text.slice(-TAIL_CHARS)
}

function extendTail(tail: string, delta: string): string {
  if (delta.length >= TAIL_CHARS) return delta.slice(-TAIL_CHARS)
  const next = tail + delta
  return next.length <= TAIL_CHARS ? next : next.slice(-TAIL_CHARS)
}

function timeEnd(part: Record<string, unknown>): unknown {
  const time = part.time
  if (!isRecord(time)) return undefined
  return time.end
}

function withoutText(part: Record<string, unknown>): Record<string, unknown> {
  const copy: Record<string, unknown> = {}
  for (const key of Object.keys(part)) {
    if (key === "text") continue
    copy[key] = part[key]
  }
  return copy
}

export function createPartSnapshotElider(): PartSnapshotElider {
  // Insertion order is observation order. Updating a part moves it to the end
  // so the cap drops the least recently observed part, not the one still streaming.
  const parts = new Map<string, PartTrack>()

  const remember = (partID: string, track: PartTrack) => {
    if (parts.has(partID)) parts.delete(partID)
    else if (parts.size >= MAX_TRACKED_PARTS) {
      const oldest = parts.keys().next().value
      if (oldest !== undefined) parts.delete(oldest)
    }
    parts.set(partID, track)
  }

  const touch = (partID: string, track: PartTrack) => {
    parts.delete(partID)
    parts.set(partID, track)
  }

  const invalidate = (partID: string) => {
    const track = parts.get(partID)
    if (!track || track.end === undefined) {
      if (track) touch(partID, track)
      return
    }
    track.end = undefined
    track.tail = ""
    touch(partID, track)
  }

  const noteDelta = (event: PartStreamEvent) => {
    if (!isRecord(event.properties)) return
    const partID = event.properties.partID
    if (typeof partID !== "string" || partID.length === 0) return
    const offset = integerOffset(event.properties.offset)
    const delta = event.properties.delta
    // Only `field: "text"` carries text/reasoning bytes. Anything else, or an
    // offset we cannot place, means the contiguous prefix is no longer trustworthy.
    if (event.properties.field !== "text" || offset === undefined || typeof delta !== "string") {
      invalidate(partID)
      return
    }
    const track = parts.get(partID)
    // No coverage yet: a delta establishes it only when it begins at 0.
    // After invalidation, `end` stays absent until a full snapshot re-seeds.
    if (!track || track.end === undefined) {
      if (track) {
        touch(partID, track)
        return
      }
      if (offset !== 0) return
      remember(partID, { full: false, end: delta.length, tail: takeTail(delta) })
      return
    }
    // Mirror `appendPartTextDelta`. `offset > end` is a gap: the renderer
    // returns without growing `part.text` and then skips every later delta
    // the same way. Invalidate now so the next snapshot is full and heals
    // immediately, instead of waiting for the heartbeat. Overlap appends
    // only the suffix past `end` (the slice may be empty when the delta is
    // already inside the covered prefix).
    if (offset > track.end) {
      invalidate(partID)
      return
    }
    const appended = delta.slice(track.end - offset)
    if (appended) {
      track.end += appended.length
      track.tail = extendTail(track.tail, appended)
    }
    touch(partID, track)
  }

  const noteSnapshot = <T extends PartStreamEvent>(event: T): T => {
    if (!isRecord(event.properties)) return event
    const part = event.properties.part
    if (!isRecord(part)) return event
    const partID = part.id
    if (typeof partID !== "string" || partID.length === 0) return event
    if (part.type !== "text" && part.type !== "reasoning") return event

    const terminal = typeof timeEnd(part) === "number"
    const text = typeof part.text === "string" ? part.text : undefined
    const track = parts.get(partID)
    // Prefix coverage: the renderer already holds [0, end). The snapshot may
    // be longer; the bytes past `end` are the deltas still in flight.
    // `end === text.length` is the special case where the tail is the
    // snapshot's own tail.
    const prefix =
      track !== undefined && track.end !== undefined && text !== undefined
        ? text.slice(Math.max(0, track.end - TAIL_CHARS), track.end)
        : undefined
    const covered =
      track !== undefined &&
      track.full &&
      track.end !== undefined &&
      text !== undefined &&
      track.end <= text.length &&
      track.tail === prefix

    if (!terminal && covered && track && track.end !== undefined) {
      touch(partID, track)
      const elided: ElidedPartCoverage = { end: track.end, tail: track.tail }
      return {
        ...event,
        properties: {
          ...event.properties,
          part: withoutText(part),
          elided,
        },
      } as T
    }

    // A finished part will not stream further deltas. Drop it instead of
    // keeping a tail that could elide a later reuse of the same id.
    if (terminal) {
      parts.delete(partID)
      return event
    }

    if (text !== undefined) {
      remember(partID, { full: true, end: text.length, tail: takeTail(text) })
    } else {
      remember(partID, { full: true, tail: "" })
    }
    return event
  }

  return {
    observe(event) {
      if (event.type === "message.part.delta") {
        noteDelta(event)
        return event
      }
      if (event.type === "message.part.removed") {
        if (isRecord(event.properties) && typeof event.properties.partID === "string") {
          parts.delete(event.properties.partID)
        }
        return event
      }
      if (event.type === "message.part.updated") return noteSnapshot(event)
      return event
    },
    reset() {
      parts.clear()
    },
  }
}
