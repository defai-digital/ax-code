import { afterEach, describe, expect, test } from "bun:test"
import { Bus } from "../../src/bus"
import { Instance } from "../../src/project/instance"
import { SessionID } from "../../src/session/schema"
import { SessionStatus } from "../../src/session/status"
import { tmpdir } from "../fixture/fixture"

describe("SessionStatus", () => {
  afterEach(async () => {
    await Instance.disposeAll()
  })

  test("stores session status per instance directory", async () => {
    await using first = await tmpdir()
    await using second = await tmpdir()
    const firstSession = SessionID.descending()
    const secondSession = SessionID.descending()

    await Instance.provide({
      directory: first.path,
      fn: async () => {
        await SessionStatus.set(firstSession, { type: "busy", step: 1, startedAt: 1 })
        expect(await SessionStatus.get(firstSession)).toEqual({ type: "busy", step: 1, startedAt: 1 })
      },
    })

    await Instance.provide({
      directory: second.path,
      fn: async () => {
        expect(await SessionStatus.get(firstSession)).toEqual({ type: "idle" })
        await SessionStatus.set(secondSession, {
          type: "retry",
          attempt: 2,
          message: "retrying",
          next: 42,
        })
        expect(await SessionStatus.list()).toEqual(
          new Map([
            [
              secondSession,
              {
                type: "retry",
                attempt: 2,
                message: "retrying",
                next: 42,
              },
            ],
          ]),
        )
      },
    })

    await Instance.provide({
      directory: first.path,
      fn: async () => {
        expect(await SessionStatus.list()).toEqual(
          new Map([
            [
              firstSession,
              {
                type: "busy",
                step: 1,
                startedAt: 1,
              },
            ],
          ]),
        )
      },
    })
  })

  test("publishes status and idle events", async () => {
    await using tmp = await tmpdir()
    const sessionID = SessionID.descending()

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const events: string[] = []
        const offStatus = Bus.subscribe(SessionStatus.Event.Status, (evt) => {
          events.push(`${evt.type}:${evt.properties.status.type}`)
        })
        const offIdle = Bus.subscribe(SessionStatus.Event.Idle, () => {
          events.push(SessionStatus.Event.Idle.type)
        })

        try {
          await SessionStatus.set(sessionID, { type: "busy", startedAt: 123 })
          await SessionStatus.set(sessionID, { type: "idle" })
        } finally {
          offStatus()
          offIdle()
        }

        expect(events).toEqual([
          `${SessionStatus.Event.Status.type}:busy`,
          `${SessionStatus.Event.Status.type}:idle`,
          SessionStatus.Event.Idle.type,
        ])
      },
    })
  })
})
