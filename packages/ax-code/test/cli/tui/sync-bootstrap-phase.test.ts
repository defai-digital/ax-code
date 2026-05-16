import { describe, expect, test } from "bun:test"
import { settleBootstrapPhase } from "../../../src/cli/cmd/tui/context/sync-bootstrap-phase"

describe("tui sync bootstrap phase", () => {
  test("returns no rejections when every task succeeds", async () => {
    await expect(settleBootstrapPhase([() => Promise.resolve("ok"), () => Promise.resolve(1)])).resolves.toEqual({
      rejected: [],
    })
  })

  test("collects rejected reasons in order and forwards them to the logger hook", async () => {
    const logged: string[] = []

    await expect(
      settleBootstrapPhase(
        [() => Promise.reject(new Error("first")), () => Promise.resolve("ok"), () => Promise.reject("second")],
        {
          onRejected(error) {
            logged.push(error)
          },
        },
      ),
    ).resolves.toEqual({
      rejected: ["Error: first", "second"],
    })

    expect(logged).toEqual(["Error: first", "second"])
  })

  test("captures synchronous task throws as rejected phase results", async () => {
    const logged: string[] = []

    await expect(
      settleBootstrapPhase(
        [
          () => {
            throw new Error("sync first")
          },
        ],
        {
          onRejected(error) {
            logged.push(error)
          },
        },
      ),
    ).resolves.toEqual({
      rejected: ["Error: sync first"],
    })

    expect(logged).toEqual(["Error: sync first"])
  })

  test("limits non-critical bootstrap task concurrency when requested", async () => {
    const events: string[] = []
    let active = 0
    let maxActive = 0

    const task = (name: string) => async () => {
      active++
      maxActive = Math.max(maxActive, active)
      events.push(`${name}:start`)
      await Promise.resolve()
      events.push(`${name}:finish`)
      active--
    }

    await expect(
      settleBootstrapPhase([task("first"), task("second"), task("third")], {
        concurrency: 1,
      }),
    ).resolves.toEqual({ rejected: [] })

    expect(maxActive).toBe(1)
    expect(events).toEqual([
      "first:start",
      "first:finish",
      "second:start",
      "second:finish",
      "third:start",
      "third:finish",
    ])
  })
})
