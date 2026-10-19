import { afterEach, describe, expect, test } from "vitest"
import z from "zod"
import { Bus } from "../../src/bus"
import { BusEvent } from "../../src/bus/bus-event"
import { Instance } from "../../src/project/instance"
import { tmpdir } from "../fixture/fixture"

const TestEvent = BusEvent.define(
  "test.bus.event",
  z.object({
    value: z.number(),
  }),
)

describe("Bus", () => {
  afterEach(async () => {
    await Instance.disposeAll()
  })

  test("once fires a single time for publishes queued in the same tick", async () => {
    await using tmp = await tmpdir()

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const seen: number[] = []
        Bus.once(TestEvent, (event) => {
          seen.push(event.properties.value)
          return "done"
        })
        await Promise.all([Bus.publish(TestEvent, { value: 1 }), Bus.publish(TestEvent, { value: 2 })])
        expect(seen).toEqual([1])
      },
    })
  })

  test("unsubscribing one registration keeps another registration of the same callback", async () => {
    await using tmp = await tmpdir()

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        let calls = 0
        const callback = () => {
          calls++
        }
        const first = Bus.subscribe(TestEvent, callback)
        Bus.subscribe(TestEvent, callback)
        first()
        first()
        await Bus.publish(TestEvent, { value: 1 })
        expect(calls).toBe(1)
      },
    })
  })

  test("publish waits for async subscribers", async () => {
    await using tmp = await tmpdir()

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        let release!: () => void
        const blocked = new Promise<void>((resolve) => {
          release = resolve
        })
        let started = false
        let completed = false

        const off = Bus.subscribe(TestEvent, async () => {
          started = true
          await blocked
          completed = true
        })

        try {
          const publishing = Bus.publish(TestEvent, { value: 1 })
          await Promise.resolve()

          expect(started).toBe(true)
          expect(completed).toBe(false)

          release()
          await publishing

          expect(completed).toBe(true)
        } finally {
          off()
        }
      },
    })
  })

  test("publishDetached does not wait for async subscribers", async () => {
    await using tmp = await tmpdir()

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        let release!: () => void
        const blocked = new Promise<void>((resolve) => {
          release = resolve
        })
        let started = false
        let completed = false
        let returned = false
        let finish!: () => void
        const done = new Promise<void>((resolve) => {
          finish = resolve
        })

        const off = Bus.subscribe(TestEvent, async () => {
          started = true
          await blocked
          completed = true
          finish()
        })

        try {
          Bus.publishDetached(TestEvent, { value: 1 })
          returned = true

          await Promise.resolve()
          expect(returned).toBe(true)
          expect(started).toBe(true)
          expect(completed).toBe(false)

          release()
          await done

          expect(completed).toBe(true)
        } finally {
          off()
        }
      },
    })
  })

  test("publishDetached preserves sequential delivery order for synchronous subscribers", async () => {
    await using tmp = await tmpdir()

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const events: number[] = []
        const off = Bus.subscribe(TestEvent, (event) => {
          events.push(event.properties.value)
        })

        try {
          Bus.publishDetached(TestEvent, { value: 1 })
          Bus.publishDetached(TestEvent, { value: 2 })

          await Promise.resolve()
          expect(events).toEqual([1, 2])
        } finally {
          off()
        }
      },
    })
  })

  test("a typed InstanceDisposed subscriber fires on instance teardown", async () => {
    await using tmp = await tmpdir()

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const expected = Instance.directory
        const directories: string[] = []
        const off = Bus.subscribe(Bus.InstanceDisposed, (event) => {
          directories.push(event.properties.directory)
        })
        try {
          await Instance.dispose()
        } finally {
          off()
        }
        expect(directories).toEqual([expected])
      },
    })
  })
})
