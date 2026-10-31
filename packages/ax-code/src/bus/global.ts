import { EventEmitter } from "events"
import { EventJournal, type EventJournalEntry, type EventJournalReplay } from "./event-journal"

export type GlobalBusEvent = {
  directory?: string
  payload: any
}

// Build the journal frame around an already-encoded payload frame. The key
// order (`directory` first) and the elision of an `undefined` directory match
// `JSON.stringify({ directory, payload })` byte for byte, so the journal, replay
// and /global/event output are unchanged — only the second serialization pass
// (and its traversal of the whole payload) is gone.
function encodeEnvelope(event: GlobalBusEvent, payloadData: string) {
  if (event.directory === undefined) return `{"payload":${payloadData}}`
  return `{"directory":${JSON.stringify(event.directory)},"payload":${payloadData}}`
}

class GlobalEventBus {
  private readonly events = new EventEmitter<{ event: [GlobalBusEvent] }>()
  private readonly sequenced = new EventEmitter<{ event: [EventJournalEntry<GlobalBusEvent>] }>()
  private readonly journal = new EventJournal<GlobalBusEvent>()

  /**
   * `payloadData` is the already-encoded JSON for `event.payload`. Publishers
   * that own that frame (see Bus.emitGlobal) pass it so the global journal can
   * reuse those bytes instead of serializing the envelope a second time.
   */
  emit(_eventName: "event", event: GlobalBusEvent, payloadData?: string) {
    const entry = this.journal.append(event, payloadData === undefined ? undefined : encodeEnvelope(event, payloadData))
    // Sequence-aware listeners run first so a raw listener that synchronously
    // publishes another event cannot make the journal arrive out of order.
    const sequenced = this.sequenced.emit("event", entry)
    const emitted = this.events.emit("event", event)
    return sequenced || emitted
  }

  on(_eventName: "event", listener: (event: GlobalBusEvent) => void) {
    this.events.on("event", listener)
    return this
  }

  off(_eventName: "event", listener: (event: GlobalBusEvent) => void) {
    this.events.off("event", listener)
    return this
  }

  setMaxListeners(count: number) {
    this.events.setMaxListeners(count)
    this.sequenced.setMaxListeners(count)
    return this
  }

  subscribeFrom(
    cursor: string | undefined,
    listener: (entry: EventJournalEntry<GlobalBusEvent>) => void,
  ): {
    cursor: string
    replay?: EventJournalReplay<GlobalBusEvent>
    unsubscribe: () => void
  } {
    this.sequenced.on("event", listener)
    const replay = cursor ? this.journal.replayAfter(cursor) : undefined
    return {
      cursor: this.journal.cursor(),
      replay,
      unsubscribe: () => this.sequenced.off("event", listener),
    }
  }
}

export const GlobalBus = new GlobalEventBus()

// GlobalBus is an intentional broadcast hub — the default max listener
// count of 10 is too low because each SSE client connected to
// /global/event registers a dedicated listener, and the TUI worker,
// workspace-server and tests all add their own on top. Node otherwise
// prints MaxListenersExceededWarning. The warning does not affect event
// delivery; this explicit ceiling reflects the expected number of concurrent
// SSE clients. Individual listeners are still removed via `off` on disconnect.
GlobalBus.setMaxListeners(200)
