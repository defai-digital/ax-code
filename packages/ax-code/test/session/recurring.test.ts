import { afterEach, describe, expect, test, vi } from "vitest"
import { Instance } from "../../src/project/instance"
import { Log } from "../../src/util/log"
import { SessionPrompt } from "../../src/session/prompt"
import { SessionRecurring } from "../../src/session/recurring"
import type { SessionID } from "../../src/session/schema"
import { tmpdir } from "../fixture/fixture"

Log.init({ print: false })

const sid = (value: string) => value as SessionID

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe("SessionRecurring", () => {
  test("start, status, replace, and stop lifecycle", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const sessionID = sid("ses_recurring_lifecycle")
        expect(SessionRecurring.get(sessionID)).toBeUndefined()
        expect(SessionRecurring.format(undefined)).toContain("No loop is running")

        const first = SessionRecurring.start({ sessionID, intervalMs: 60_000, prompt: "check ci" })
        expect(first.replaced).toBe(false)
        expect(SessionRecurring.get(sessionID)).toMatchObject({ prompt: "check ci", runs: 0, skips: 0 })

        const second = SessionRecurring.start({ sessionID, intervalMs: 120_000, prompt: "drain queue" })
        expect(second.replaced).toBe(true)
        expect(SessionRecurring.get(sessionID)).toMatchObject({ prompt: "drain queue", intervalMs: 120_000 })

        const status = SessionRecurring.format(SessionRecurring.get(sessionID))
        expect(status).toContain("every 2m")
        expect(status).toContain("do not survive a restart")

        const stopped = SessionRecurring.stop(sessionID)
        expect(stopped).toMatchObject({ prompt: "drain queue" })
        expect(SessionRecurring.get(sessionID)).toBeUndefined()
        expect(SessionRecurring.stop(sessionID)).toBeUndefined()
      },
    })
  })

  test("tick submits when idle and counts busy-skips without queueing", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const sessionID = sid("ses_recurring_tick")
        SessionRecurring.start({ sessionID, intervalMs: 60_000, prompt: "poll the endpoint" })

        const submitted: string[] = []
        const submit = async (input: { sessionID: SessionID; text: string }) => {
          submitted.push(input.text)
        }

        const busy = await SessionRecurring.tick(sessionID, {
          assertNotBusy: () => {
            throw new Error("busy")
          },
          submit,
        })
        expect(busy).toBe("skip")
        expect(submitted).toEqual([])
        expect(SessionRecurring.get(sessionID)).toMatchObject({ runs: 0, skips: 1 })

        const idle = await SessionRecurring.tick(sessionID, { assertNotBusy: () => {}, submit })
        expect(idle).toBe("run")
        expect(submitted).toEqual(["poll the endpoint"])
        expect(SessionRecurring.get(sessionID)).toMatchObject({ runs: 1, skips: 1 })

        SessionRecurring.stop(sessionID)
        expect(await SessionRecurring.tick(sessionID, { assertNotBusy: () => {}, submit })).toBe("stopped")
      },
    })
  })

  test("a submit failure is contained and the loop keeps running", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const sessionID = sid("ses_recurring_failure")
        SessionRecurring.start({ sessionID, intervalMs: 60_000, prompt: "flaky" })
        const result = await SessionRecurring.tick(sessionID, {
          assertNotBusy: () => {},
          submit: async () => {
            throw new Error("provider down")
          },
        })
        expect(result).toBe("run")
        expect(SessionRecurring.get(sessionID)).toMatchObject({ runs: 1 })
        SessionRecurring.stop(sessionID)
      },
    })
  })

  test("auto-stops with a notice after MAX_RUNS", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const sessionID = sid("ses_recurring_cap")
        SessionRecurring.start({ sessionID, intervalMs: 60_000, prompt: "burn" })
        const notices: string[] = []
        const deps = {
          assertNotBusy: () => {},
          submit: async () => {},
          publishError: (input: { sessionID: SessionID; message: string }) => {
            notices.push(input.message)
          },
        }
        for (let i = 0; i < SessionRecurring.MAX_RUNS; i++) {
          await SessionRecurring.tick(sessionID, deps)
        }
        expect(notices.length).toBe(1)
        expect(notices[0]).toContain(`${SessionRecurring.MAX_RUNS} runs`)
        expect(SessionRecurring.get(sessionID)).toBeUndefined()
      },
    })
  })

  test("the timer drives ticks on the configured cadence", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        vi.useFakeTimers()
        const sessionID = sid("ses_recurring_timer")
        const assertSpy = vi.spyOn(SessionPrompt, "assertNotBusy").mockReturnValue(undefined)
        const promptSpy = vi.spyOn(SessionPrompt, "prompt").mockResolvedValue(undefined as never)

        SessionRecurring.start({ sessionID, intervalMs: 60_000, prompt: "heartbeat" })
        await vi.advanceTimersByTimeAsync(180_000)

        expect(assertSpy).toHaveBeenCalledTimes(3)
        expect(promptSpy).toHaveBeenCalledTimes(3)
        expect(promptSpy).toHaveBeenCalledWith(
          expect.objectContaining({
            sessionID,
            agentRouting: "preserve",
            parts: [{ type: "text", text: "heartbeat" }],
          }),
        )
        SessionRecurring.stop(sessionID)
        await vi.advanceTimersByTimeAsync(120_000)
        expect(promptSpy).toHaveBeenCalledTimes(3)
      },
    })
  })
})
