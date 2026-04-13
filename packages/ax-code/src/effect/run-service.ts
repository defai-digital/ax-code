import { Effect, Layer, ManagedRuntime } from "effect"
import * as ServiceMap from "effect/ServiceMap"
import { registerDisposer } from "./instance-registry"

export const memoMap = Layer.makeMemoMapUnsafe()
const INTERRUPTED_WITHOUT_ERROR = "All fibers interrupted without error"

function isHarmlessInterrupt(err: unknown) {
  const message = err instanceof Error ? err.message : String(err)
  return message === INTERRUPTED_WITHOUT_ERROR
}

export function makeRunPromise<I, S, E>(service: ServiceMap.Service<I, S>, layer: Layer.Layer<I, E>) {
  let rt: ManagedRuntime.ManagedRuntime<I, E> | undefined
  registerDisposer(async () => {
    const current = rt
    rt = undefined
    if (current) {
      await current.dispose().catch((err) => {
        if (isHarmlessInterrupt(err)) return
        throw err
      })
    }
  })

  return <A, Err>(fn: (svc: S) => Effect.Effect<A, Err, I>, options?: Effect.RunOptions) => {
    rt ??= ManagedRuntime.make(layer, { memoMap })
    return rt.runPromise(service.use(fn), options)
  }
}
