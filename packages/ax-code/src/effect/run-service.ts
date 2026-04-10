import { Effect, Layer, ManagedRuntime } from "effect"
import * as ServiceMap from "effect/ServiceMap"
import { registerDisposer } from "./instance-registry"

export const memoMap = Layer.makeMemoMapUnsafe()

export function makeRunPromise<I, S, E>(service: ServiceMap.Service<I, S>, layer: Layer.Layer<I, E>) {
  let rt: ManagedRuntime.ManagedRuntime<I, E> | undefined
  registerDisposer(async () => {
    const current = rt
    rt = undefined
    if (current) await current.dispose()
  })

  return <A, Err>(fn: (svc: S) => Effect.Effect<A, Err, I>, options?: Effect.RunOptions) => {
    rt ??= ManagedRuntime.make(layer, { memoMap })
    return rt.runPromise(service.use(fn), options)
  }
}
