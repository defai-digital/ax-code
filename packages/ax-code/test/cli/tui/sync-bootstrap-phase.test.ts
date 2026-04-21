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
      settleBootstrapPhase([() => Promise.reject(new Error("first")), () => Promise.resolve("ok"), () => Promise.reject("second")], {
        onRejected(error) {
          logged.push(error)
        },
      }),
    ).resolves.toEqual({
      rejected: ["Error: first", "second"],
    })

    expect(logged).toEqual(["Error: first", "second"])
  })

  test("captures synchronous task throws as rejected phase results", async () => {
    const logged: string[] = []

    await expect(
      settleBootstrapPhase([() => {
        throw new Error("sync first")
      }], {
        onRejected(error) {
          logged.push(error)
        },
      }),
    ).resolves.toEqual({
      rejected: ["Error: sync first"],
    })

    expect(logged).toEqual(["Error: sync first"])
  })
})
