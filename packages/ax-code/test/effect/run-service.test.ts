import { expect, test } from "bun:test"
import { Effect, Layer, ServiceMap } from "effect"
import { disposeInstance } from "../../src/effect/instance-registry"
import { makeRunPromise } from "../../src/effect/run-service"

class Shared extends ServiceMap.Service<Shared, { readonly id: number }>()("@test/Shared") {}

test("makeRunPromise shares dependent layers through the shared memo map", async () => {
  let n = 0

  const shared = Layer.effect(
    Shared,
    Effect.sync(() => {
      n += 1
      return Shared.of({ id: n })
    }),
  )

  class One extends ServiceMap.Service<One, { readonly get: () => Effect.Effect<number> }>()("@test/One") {}
  const one = Layer.effect(
    One,
    Effect.gen(function* () {
      const svc = yield* Shared
      return One.of({
        get: Effect.fn("One.get")(() => Effect.succeed(svc.id)),
      })
    }),
  ).pipe(Layer.provide(shared))

  class Two extends ServiceMap.Service<Two, { readonly get: () => Effect.Effect<number> }>()("@test/Two") {}
  const two = Layer.effect(
    Two,
    Effect.gen(function* () {
      const svc = yield* Shared
      return Two.of({
        get: Effect.fn("Two.get")(() => Effect.succeed(svc.id)),
      })
    }),
  ).pipe(Layer.provide(shared))

  const runOne = makeRunPromise(One, one)
  const runTwo = makeRunPromise(Two, two)

  expect(await runOne((svc) => svc.get())).toBe(1)
  expect(await runTwo((svc) => svc.get())).toBe(1)
  expect(n).toBe(1)
})

test("makeRunPromise dispose tears down once and unregisters the disposer", async () => {
  let n = 0

  class Once extends ServiceMap.Service<Once, { readonly get: () => Effect.Effect<number> }>()("@test/Once") {}
  const layer = Layer.effect(
    Once,
    Effect.acquireRelease(
      Effect.sync(() =>
        Once.of({
          get: Effect.fn("Once.get")(() => Effect.succeed(1)),
        }),
      ),
      () =>
        Effect.sync(() => {
          n += 1
        }),
    ),
  )

  const run = makeRunPromise(Once, layer)
  expect(await run((svc) => svc.get())).toBe(1)

  await run.dispose()
  expect(n).toBe(1)

  await disposeInstance("test-directory")
  expect(n).toBe(1)
  expect(run((svc) => svc.get())).rejects.toThrow("run promise disposed")
})
