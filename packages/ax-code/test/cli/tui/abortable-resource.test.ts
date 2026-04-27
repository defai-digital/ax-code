import { describe, expect, test } from "bun:test"
import { createRoot } from "solid-js"
import { createAbortableResourceFetcher } from "../../../src/cli/cmd/tui/util/abortable-resource"

describe("createAbortableResourceFetcher", () => {
  test("aborts the previous request and preserves the last value", async () => {
    await new Promise<void>((resolve, reject) =>
      createRoot((dispose) => {
        const aborted: string[] = []
        const fetcher = createAbortableResourceFetcher<string, string>(async (source, signal) => {
          signal.addEventListener("abort", () => aborted.push(source), { once: true })
          return await new Promise<string>((innerResolve, innerReject) => {
            const timeout = setTimeout(() => innerResolve(source), source === "first" ? 50 : 0)
            signal.addEventListener(
              "abort",
              () => {
                clearTimeout(timeout)
                innerReject(new DOMException("Aborted", "AbortError"))
              },
              { once: true },
            )
          })
        })

        Promise.all([
          Promise.resolve(fetcher("first", { value: "stable", refetching: false })),
          Promise.resolve(fetcher("second", { value: "stable", refetching: false })),
        ])
          .then(([first, second]) => {
            expect(first).toBe("stable")
            expect(second).toBe("second")
            expect(aborted).toEqual(["first"])
            dispose()
            resolve()
          })
          .catch((error) => {
            dispose()
            reject(error)
          })
      }),
    )
  })

  test("aborts the active request on cleanup", async () => {
    await new Promise<void>((resolve, reject) =>
      createRoot((dispose) => {
        let aborted = false
        const fetcher = createAbortableResourceFetcher<string, string>(async (_source, signal) => {
          signal.addEventListener(
            "abort",
            () => {
              aborted = true
            },
            { once: true },
          )
          return await new Promise<string>((_innerResolve, innerReject) => {
            signal.addEventListener("abort", () => innerReject(new DOMException("Aborted", "AbortError")), {
              once: true,
            })
          })
        })

        const pending = Promise.resolve(fetcher("pending", { value: "stable", refetching: false }))
        dispose()
        pending
          .then((value: string | undefined) => {
            expect(value).toBe("stable")
            expect(aborted).toBe(true)
            resolve()
          })
          .catch(reject)
      }),
    )
  })
})
