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
      // Typed subscribers (`Bus.subscribe(InstanceDisposed, cb)`) are keyed by
      // the event type, not "*"; deliver to them too or they never fire.
      const typed = entry.subscriptions.get(InstanceDisposed.type) ?? []
      const wildcard = entry.subscriptions.get("*") ?? []
      if (typed.length === 0 && wildcard.length === 0 && entry.sequencedSubscriptions.length === 0) return
      const event = {
        type: InstanceDisposed.type,
        properties: {
          directory: Instance.directory,
        },
      }
      const entryEvent = entry.journal.append(event)
      await Promise.all([
        ...deliver([...typed, ...wildcard], event, InstanceDisposed.type),
        ...deliver([...entry.sequencedSubscriptions], entryEvent, InstanceDisposed.type),
      ])
    },
  )

  function deliver(subscriptions: Subscription[], payload: unknown, type: string): Pending {
    return subscriptions.map((sub) =>
      // Deferring the call turns a synchronous throw into a rejection that
      // cannot skip later subscribers in the same publish cycle.
      Promise.resolve().then(() => {
        let result: unknown
        try {
          result = sub(payload)
        } catch (err) {
          log.error("subscriber threw", { type, err })
          return
        }
        // Only a promise can still be running after the subscriber returns, so
        // only thenable subscribers pay for a deadline timer. Arming one for a
        // synchronous subscriber costs a timer per subscriber per publish and
        // can never fire.
        if (!isThenable(result)) return result
        return withTimeout(
          Promise.resolve(result).catch((err) => log.error("subscriber threw", { type, err })),
          SUBSCRIBER_TIMEOUT_MS,
          `Bus subscriber for "${type}" timed out after ${SUBSCRIBER_TIMEOUT_MS}ms`,
        ).catch((err) => log.error("subscriber timed out", { type, err }))
      }),
    )
  }

  function isThenable(value: unknown): value is PromiseLike<unknown> {
    return typeof (value as PromiseLike<unknown> | null | undefined)?.then === "function"
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
    // `data` is the instance journal's encoded frame; emitGlobal reuses it
    // instead of serializing the payload a second time.
    return { payload, pending, data: journalEntry.data }
  }

  function emitGlobal(payload: { type: string; properties: unknown }, data: string) {
    GlobalBus.emit(
      "event",
      {
        directory: Instance.directory,
        payload,
      },
      data,
    )
  }

  export async function publish<Definition extends BusEvent.Definition>(
    def: Definition,
    properties: z.output<Definition["properties"]>,
  ) {
    const { payload, pending, data } = prepare(def, properties)
    emitGlobal(payload, data)
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
    options?: { localOnly?: boolean },
  ) {
    const { payload, pending, data } = prepare(def, properties)
    // Global maintenance publishes once with the record's stored directory,
    // while each owning instance still receives its local journal event.
    if (!options?.localOnly) emitGlobal(payload, data)
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
    const registration = guarded(callback)
    current.sequencedSubscriptions.push(registration.deliver)
    const replay = cursor ? current.journal.replayAfter(cursor) : undefined
    return {
      cursor: current.journal.cursor(),
      replay,
      unsubscribe: () => {
        registration.active = false
        const index = current.sequencedSubscriptions.indexOf(registration.deliver)
        if (index !== -1) current.sequencedSubscriptions.splice(index, 1)
      },
    }
  }

  // Deliveries are queued asynchronously from a snapshot of the subscriber
  // list, so a delivery can still be pending when its subscription ends. Each
  // registration gets its own wrapper and active flag: an unsubscribed (or
  // `once`-completed) callback is never invoked again, and unsubscribing one
  // registration of a callback never removes another registration of it.
  function guarded<T>(callback: (event: T) => void) {
    const registration = {
      active: true,
      deliver: (event: T) => {
        if (registration.active) return callback(event)
      },
    }
    return registration
  }

  function raw(type: string, callback: (event: any) => void) {
    log.debug("subscribing", { type })
    const subscriptions = state().subscriptions
    let match = subscriptions.get(type) ?? []
    const registration = guarded(callback)
    match.push(registration.deliver)
    subscriptions.set(type, match)

    return () => {
      log.debug("unsubscribing", { type })
      registration.active = false
      const match = subscriptions.get(type)
      if (!match) return
      const index = match.indexOf(registration.deliver)
      if (index === -1) return
      match.splice(index, 1)
    }
  }
}
