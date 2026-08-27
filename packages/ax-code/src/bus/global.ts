import { EventEmitter } from "events"
import { EventJournal, type EventJournalEntry, type EventJournalReplay } from "./event-journal"

export type GlobalBusEvent = {
  directory?: string
  payload: any
}

class GlobalEventBus {
  private readonly events = new EventEmitter<{ event: [GlobalBusEvent] }>()
  private readonly sequenced = new EventEmitter<{ event: [EventJournalEntry<GlobalBusEvent>] }>()
  private readonly journal = new EventJournal<GlobalBusEvent>()

  emit(_eventName: "event", event: GlobalBusEvent) {
    const entry = this.journal.append(event)
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
