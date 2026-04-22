import { describe, expect, test } from "bun:test"
import {
  createSessionEntrySyncRetryState,
  nextSessionEntrySyncRetry,
} from "../../../src/cli/cmd/tui/routes/session/entry-sync"

describe("tui session entry sync retry policy", () => {
  test("starts with a short retry delay for fresh sessions", () => {
    const state = createSessionEntrySyncRetryState(1_000)
    const next = nextSessionEntrySyncRetry(state, 1_000)

    expect(next).toEqual({
      delayMs: 75,
      state: {
        startedAtMs: 1_000,
        nextDelayMs: 150,
      },
    })
  })

  test("backs off while preserving the original deadline window", () => {
    const first = nextSessionEntrySyncRetry(createSessionEntrySyncRetryState(2_000), 2_000)
    const second = nextSessionEntrySyncRetry(first!.state, 2_075)
    const third = nextSessionEntrySyncRetry(second!.state, 2_225)
    const fourth = nextSessionEntrySyncRetry(third!.state, 2_525)

    expect([first?.delayMs, second?.delayMs, third?.delayMs, fourth?.delayMs]).toEqual([75, 150, 300, 400])
  })

  test("caps the final retry delay to the remaining deadline budget", () => {
    const state = {
      startedAtMs: 5_000,
      nextDelayMs: 400,
    }

    const next = nextSessionEntrySyncRetry(state, 6_850)

    expect(next).toEqual({
      delayMs: 150,
      state: {
        startedAtMs: 5_000,
        nextDelayMs: 400,
      },
    })
  })

  test("stops retrying once the deadline budget is exhausted", () => {
    const state = {
      startedAtMs: 10_000,
      nextDelayMs: 400,
    }

    expect(nextSessionEntrySyncRetry(state, 12_000)).toBeUndefined()
    expect(nextSessionEntrySyncRetry(state, 12_100)).toBeUndefined()
  })
})
