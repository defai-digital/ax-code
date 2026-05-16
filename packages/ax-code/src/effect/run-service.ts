import { Cause, Effect, Exit, Layer, ManagedRuntime } from "effect"
import * as ServiceMap from "effect/ServiceMap"
import { registerDisposer } from "./instance-registry"

export const memoMap = Layer.makeMemoMapUnsafe()

export function makeRunPromise<I, S, E>(service: ServiceMap.Service<I, S>, layer: Layer.Layer<I, E>) {
  let rt: ManagedRuntime.ManagedRuntime<I, E> | undefined
  registerDisposer(async () => {
    const current = rt
    rt = undefined
    if (current) {
      const exit = await Effect.runPromiseExit(current.disposeEffect)
      if (!Exit.isFailure(exit)) return
      if (Exit.hasInterrupts(exit) && !Exit.hasFails(exit) && !Exit.hasDies(exit)) return
      throw new Error("ManagedRuntime dispose failed", { cause: exit.cause })
    }
  })

  return <A, Err>(fn: (svc: S) => Effect.Effect<A, Err, I>, options?: Effect.RunOptions) => {
    rt ??= ManagedRuntime.make(layer, { memoMap })
    return rt.runPromiseExit(service.use(fn), options).then((exit) => {
      if (!Exit.isFailure(exit)) return exit.value
      const error = Cause.squash(exit.cause)
      throw error instanceof Error ? error : new Error(String(error))
    })
  }
}
