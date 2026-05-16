import { afterEach, describe, expect, test } from "bun:test"
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
})
