import z from "zod"
import { Log } from "../util/log"
import { toErrorMessage } from "../util/error-message"
import { Instance } from "../project/instance"
import { BusEvent } from "./bus-event"
import { GlobalBus } from "./global"
import { withTimeout } from "../util/timeout"
import { EventJournal, type EventJournalEntry, type EventJournalReplay } from "./event-journal"

export namespace Bus {
  const log = Log.create({ service: "bus" })
  // Subscriber-owned callback boundaries must settle before the bus gives up
  // waiting for them. Plugin event hooks have a 15-second deadline; keeping a
  // small outer margin lets that boundary abort and retire a stalled plugin
  // instead of allowing Bus.publish() to return while the hook is still live.
  export const SUBSCRIBER_TIMEOUT_MS = 16_000
  type Subscription = (event: any) => void
  type SequencedSubscription = (entry: EventJournalEntry<any>) => void
  type Pending = Promise<unknown>[]

  export const InstanceDisposed = BusEvent.define(
    "server.instance.disposed",
    z.object({
      directory: z.string(),
    }),
  )

  const state = Instance.state(
    () => {
      const subscriptions = new Map<string, Subscription[]>()
      const sequencedSubscriptions: SequencedSubscription[] = []
      const journal = new EventJournal<any>()

      return {
        subscriptions,
        sequencedSubscriptions,
        journal,
      }
    },
    async (entry) => {
      const wildcard = entry.subscriptions.get("*") ?? []
      if (wildcard.length === 0 && entry.sequencedSubscriptions.length === 0) return
      const event = {
        type: InstanceDisposed.type,
        properties: {
          directory: Instance.directory,
        },
      }
      const entryEvent = entry.journal.append(event)
      await Promise.all([
        ...deliver([...wildcard], event, InstanceDisposed.type),
        ...deliver([...entry.sequencedSubscriptions], entryEvent, InstanceDisposed.type),
      ])
    },
  )

  function deliver(subscriptions: Subscription[], payload: unknown, type: string): Pending {
    return subscriptions.map((sub) =>
      withTimeout(
        Promise.resolve()
          .then(() => sub(payload))
          .catch((err) => log.error("subscriber threw", { type, err })),
        SUBSCRIBER_TIMEOUT_MS,
        `Bus subscriber for "${type}" timed out after ${SUBSCRIBER_TIMEOUT_MS}ms`,
      ).catch((err) => log.error("subscriber timed out", { type, err })),
    )
  }

  function prepare<Definition extends BusEvent.Definition>(
    def: Definition,
    properties: z.output<Definition["properties"]>,
  ) {
    const payload = {
      type: def.type,
      properties,
    }
    const journalEntry = state().journal.append(payload)
    log.debug("publishing", {
      type: def.type,
    })
    const pending: Pending = []
    for (const key of [def.type, "*"]) {
      const match = [...(state().subscriptions.get(key) ?? [])]
      for (const sub of match) {
        // Wrap in Promise.resolve().then so a synchronous throw from any
        // subscriber becomes a rejected promise instead of propagating up
        // and skipping later subscribers in the same publish cycle.
        pending.push(...deliver([sub], payload, def.type))
      }
    }
    pending.push(...deliver([...state().sequencedSubscriptions], journalEntry, def.type))
    return { payload, pending }
  }

  function emitGlobal(payload: { type: string; properties: unknown }) {
    GlobalBus.emit("event", {
      directory: Instance.directory,
      payload,
    })
  }

  export async function publish<Definition extends BusEvent.Definition>(
    def: Definition,
    properties: z.output<Definition["properties"]>,
  ) {
    const { payload, pending } = prepare(def, properties)
    emitGlobal(payload)
    return Promise.all(pending)
  }

  /**
   * Publish without waiting for subscribers to finish. Use only when the
   * authoritative state has already been committed and eventual delivery is
   * sufficient for observers.
   */
  export function publishDetached<Definition extends BusEvent.Definition>(
    def: Definition,
    properties: z.output<Definition["properties"]>,
  ) {
    const { payload, pending } = prepare(def, properties)
    emitGlobal(payload)
    void Promise.all(pending).catch((err) => {
      log.warn("subscriber failed during detached publish", {
        event: def.type,
        error: toErrorMessage(err),
        stack: err instanceof Error ? err.stack : undefined,
      })
    })
  }

  export function subscribe<Definition extends BusEvent.Definition>(
    def: Definition,
    callback: (event: { type: Definition["type"]; properties: z.infer<Definition["properties"]> }) => void,
  ) {
    return raw(def.type, callback)
  }

  export function once<Definition extends BusEvent.Definition>(
    def: Definition,
    callback: (event: {
      type: Definition["type"]
      properties: z.infer<Definition["properties"]>
    }) => "done" | undefined,
  ) {
    const unsub = subscribe(def, (event) => {
      if (callback(event)) unsub()
    })
    return unsub
  }

  export function subscribeAll(callback: (event: any) => void) {
    return raw("*", callback)
  }

  export function subscribeAllFrom(
    cursor: string | undefined,
    callback: (entry: EventJournalEntry<any>) => void,
  ): {
    cursor: string
    replay?: EventJournalReplay<any>
    unsubscribe: () => void
  } {
    const current = state()
    current.sequencedSubscriptions.push(callback)
    const replay = cursor ? current.journal.replayAfter(cursor) : undefined
    return {
      cursor: current.journal.cursor(),
      replay,
      unsubscribe: () => {
        const index = current.sequencedSubscriptions.indexOf(callback)
        if (index !== -1) current.sequencedSubscriptions.splice(index, 1)
      },
    }
  }

  function raw(type: string, callback: (event: any) => void) {
    log.debug("subscribing", { type })
    const subscriptions = state().subscriptions
    let match = subscriptions.get(type) ?? []
    match.push(callback)
    subscriptions.set(type, match)

    return () => {
      log.debug("unsubscribing", { type })
      const match = subscriptions.get(type)
      if (!match) return
      const index = match.indexOf(callback)
      if (index === -1) return
      match.splice(index, 1)
    }
  }
}
