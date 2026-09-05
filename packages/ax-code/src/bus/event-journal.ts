import { randomUUID } from "node:crypto"
import { encodeSsePayload } from "@/util/sse-queue"
import { Fifo } from "@/util/fifo"

export const EVENT_JOURNAL_MAX_EVENTS = 2_048
export const EVENT_JOURNAL_MAX_BYTES = 16 * 1024 * 1024

export type EventJournalGapReason = "invalid_cursor" | "server_restarted" | "cursor_expired" | "cursor_ahead"

export type EventJournalEntry<T> = {
  id: string
  sequence: number
  value: T
  data: string
  bytes: number
}

export type EventJournalReplay<T> =
  | {
      type: "replay"
      cursor: string
      entries: EventJournalEntry<T>[]
    }
  | {
      type: "gap"
      cursor: string
      reason: EventJournalGapReason
      entries: []
    }

type EventJournalOptions = {
  epoch?: string
  maxEvents?: number
  maxBytes?: number
}

/**
 * A bounded in-memory journal for resumable event streams.
 *
 * The epoch intentionally changes on process restart. A cursor from an older
 * epoch cannot be replayed and must force an authoritative state refresh.
 */
export class EventJournal<T> {
  readonly epoch: string
  readonly maxEvents: number
  readonly maxBytes: number

  private sequence = 0
  private bytes = 0
  private entries = new Fifo<EventJournalEntry<T>>()

  constructor(options: EventJournalOptions = {}) {
    this.epoch = options.epoch ?? randomUUID()
    this.maxEvents = options.maxEvents ?? EVENT_JOURNAL_MAX_EVENTS
    this.maxBytes = options.maxBytes ?? EVENT_JOURNAL_MAX_BYTES
  }

  cursor() {
    return `${this.epoch}:${this.sequence}`
  }

  append(value: T): EventJournalEntry<T> {
    const data = encodeSsePayload(value)
    const entry: EventJournalEntry<T> = {
      id: `${this.epoch}:${++this.sequence}`,
      sequence: this.sequence,
      value,
      data,
      bytes: Buffer.byteLength(data, "utf8"),
    }

    // Deliver an oversized event live, but do not let one frame exceed the
    // journal's entire memory budget. Clearing the retained tail makes older
    // cursors fail closed with cursor_expired on their next reconnect.
    if (entry.bytes > this.maxBytes || this.maxEvents === 0) {
      this.entries.clear()
      this.bytes = 0
      return entry
    }

    this.entries.push(entry)
    this.bytes += entry.bytes
    while (this.entries.size > this.maxEvents || this.bytes > this.maxBytes) {
      const removed = this.entries.shift()
      if (!removed) break
      this.bytes -= removed.bytes
    }
    return entry
  }

  replayAfter(cursor: string): EventJournalReplay<T> {
    const parsed = this.parseCursor(cursor)
    if (!parsed) return this.gap("invalid_cursor")
    if (parsed.epoch !== this.epoch) return this.gap("server_restarted")
    if (parsed.sequence > this.sequence) return this.gap("cursor_ahead")
    if (parsed.sequence === this.sequence) {
      return { type: "replay", cursor: this.cursor(), entries: [] }
    }

    const earliestRetained = this.entries.peek()?.sequence ?? this.sequence + 1
    if (parsed.sequence < earliestRetained - 1) return this.gap("cursor_expired")

    return {
      type: "replay",
      cursor: this.cursor(),
      // Retention only evicts a prefix, so sequences in the live tail are
      // contiguous. Copy just the requested suffix instead of scanning it all.
      entries: this.entries.toArray(parsed.sequence - earliestRetained + 1),
    }
  }

  private gap(reason: EventJournalGapReason): EventJournalReplay<T> {
    return { type: "gap", cursor: this.cursor(), reason, entries: [] }
  }

  private parseCursor(cursor: string) {
    const separator = cursor.lastIndexOf(":")
    if (separator <= 0 || separator === cursor.length - 1) return undefined
    const epoch = cursor.slice(0, separator)
    const rawSequence = cursor.slice(separator + 1)
    if (!/^\d+$/.test(rawSequence)) return undefined
    const sequence = Number(rawSequence)
    if (!Number.isSafeInteger(sequence) || sequence < 0) return undefined
    return { epoch, sequence }
  }
}
