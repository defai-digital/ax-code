import { describe, expect, test } from "vitest"

import { waitForAxCodeConnection } from "./axCodeConnection"

describe("waitForAxCodeConnection", () => {
  test("polls until ax-code reports healthy", async () => {
    let currentTime = 0
    const messages: string[] = []
    const sleeps: number[] = []
    const healthResults = [false, false, true]

    await waitForAxCodeConnection(450, {
      checkHealth: async () => healthResults.shift() ?? true,
      updateMessage: (message) => messages.push(message),
      sleepMs: async (ms) => {
        sleeps.push(ms)
        currentTime += ms
      },
      now: () => currentTime,
    })

    expect(messages).toEqual([
      "Waiting for AX Code… (attempt 1)",
      "Waiting for AX Code… (attempt 2)",
      "Waiting for AX Code… (attempt 3)",
    ])
    expect(sleeps).toEqual([450, 300, 300])
  })

  test("throws the last health check error after the wait budget expires", async () => {
    let currentTime = 0
    const error = new Error("not ready")

    let thrown: unknown
    try {
      await waitForAxCodeConnection(undefined, {
        checkHealth: async () => {
          throw error
        },
        updateMessage: () => undefined,
        sleepMs: async (ms) => {
          currentTime += ms
        },
        now: () => currentTime,
        maxWaitMs: 500,
      })
    } catch (caught) {
      thrown = caught
    }

    expect(thrown).toBe(error)
  })
})
