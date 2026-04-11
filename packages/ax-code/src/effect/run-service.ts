import { Effect, Layer, ManagedRuntime } from "effect"
import * as ServiceMap from "effect/ServiceMap"
import { registerDisposer } from "./instance-registry"

export const memoMap = Layer.makeMemoMapUnsafe()

export interface RunPromise<I, S, E> {
  <A, Err>(fn: (svc: S) => Effect.Effect<A, Err, I>, options?: Effect.RunOptions): Promise<A>
  dispose(): Promise<void>
}

export function makeRunPromise<I, S, E>(service: ServiceMap.Service<I, S>, layer: Layer.Layer<I, E>): RunPromise<I, S, E> {
  let rt: ManagedRuntime.ManagedRuntime<I, E> | undefined
  let dead = false
  const stop = async () => {
    const current = rt
    rt = undefined
    if (current) await current.dispose()
  }
  const off = registerDisposer(async () => {
    await stop()
  })

  const run = <A, Err>(fn: (svc: S) => Effect.Effect<A, Err, I>, options?: Effect.RunOptions) => {
    if (dead) return Promise.reject(new Error("run promise disposed"))
    rt ??= ManagedRuntime.make(layer, { memoMap })
    return rt.runPromise(service.use(fn), options)
  }

  return Object.assign(run, {
    dispose: async () => {
      if (dead) return
      dead = true
      off()
      await stop()
    },
  })
}
