import z from "zod"
import { Log } from "../util/log"
import { Instance } from "../project/instance"
import { BusEvent } from "./bus-event"
import { GlobalBus } from "./global"
import { withTimeout } from "../util/timeout"

export namespace Bus {
  const log = Log.create({ service: "bus" })
  const BUS_SUBSCRIBER_TIMEOUT_MS = 10_000
  type Subscription = (event: any) => void
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

      return {
        subscriptions,
      }
    },
    async (entry) => {
      const wildcard = entry.subscriptions.get("*")
      if (!wildcard) return
      const event = {
        type: InstanceDisposed.type,
        properties: {
          directory: Instance.directory,
        },
      }
      for (const sub of [...wildcard]) {
        sub(event)
      }
    },
  )

  function prepare<Definition extends BusEvent.Definition>(def: Definition, properties: z.output<Definition["properties"]>) {
    const payload = {
      type: def.type,
      properties,
    }
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
        pending.push(
          withTimeout(
            Promise.resolve()
              .then(() => sub(payload))
              .catch((err) => log.error("subscriber threw", { type: def.type, err })),
            BUS_SUBSCRIBER_TIMEOUT_MS,
            `Bus subscriber for "${def.type}" timed out after ${BUS_SUBSCRIBER_TIMEOUT_MS}ms`,
          ).catch((err) => log.error("subscriber timed out", { type: def.type, err })),
        )
      }
    }
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
    void Promise.all(pending)
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

  function raw(type: string, callback: (event: any) => void) {
    log.info("subscribing", { type })
    const subscriptions = state().subscriptions
    let match = subscriptions.get(type) ?? []
    match.push(callback)
    subscriptions.set(type, match)

    return () => {
      log.info("unsubscribing", { type })
      const match = subscriptions.get(type)
      if (!match) return
      const index = match.indexOf(callback)
      if (index === -1) return
      match.splice(index, 1)
    }
  }
}
