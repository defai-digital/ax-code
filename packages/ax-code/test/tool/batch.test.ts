import { describe, expect, test } from "bun:test"
import { withToolTimeout } from "../../src/tool/batch"

describe("tool.batch", () => {
  test("aborts the underlying tool signal when the timeout expires", async () => {
    let sawAbort = false

    await expect(
      withToolTimeout({
        tool: "slow",
        parent: new AbortController().signal,
        timeoutMs: 10,
        run(signal) {
          return new Promise((_, reject) => {
            signal.addEventListener(
              "abort",
              () => {
                sawAbort = true
                reject(signal.reason)
              },
              { once: true },
            )
          })
        },
      }),
    ).rejects.toThrow("Tool 'slow' timed out after 10ms")

    expect(sawAbort).toBe(true)
  })

  test("propagates parent aborts to the underlying tool signal", async () => {
    const parent = new AbortController()

    const pending = withToolTimeout({
      tool: "child",
      parent: parent.signal,
      timeoutMs: 1000,
      run(signal) {
        return new Promise((_, reject) => {
          signal.addEventListener(
            "abort",
            () => reject(signal.reason),
            { once: true },
          )
        })
      },
    })

    parent.abort(new Error("cancelled"))

    await expect(pending).rejects.toThrow("cancelled")
  })
})
