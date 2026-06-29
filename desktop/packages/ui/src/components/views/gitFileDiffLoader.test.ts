import { afterEach, describe, expect, test, vi } from "vitest"
import { fetchGitFileDiffWithTimeout, type GitFileDiffFetcher } from "./gitFileDiffLoader"

describe("fetchGitFileDiffWithTimeout", () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  test("clears its timeout after a successful diff fetch", async () => {
    vi.useFakeTimers()
    const fetcher = vi.fn<GitFileDiffFetcher>().mockResolvedValue({
      path: "src/file.ts",
      original: "before",
      modified: "after",
      isBinary: false,
    })

    await expect(fetchGitFileDiffWithTimeout(fetcher, "/repo", { path: "src/file.ts", staged: false }, 15000)).resolves
      .toEqual({
        path: "src/file.ts",
        original: "before",
        modified: "after",
        isBinary: false,
      })

    expect(fetcher).toHaveBeenCalledWith("/repo", { path: "src/file.ts", staged: false })
    expect(vi.getTimerCount()).toBe(0)
  })

  test("clears its timeout after the diff fetch rejects", async () => {
    vi.useFakeTimers()
    const fetcher = vi.fn<GitFileDiffFetcher>().mockRejectedValue(new Error("diff failed"))

    await expect(fetchGitFileDiffWithTimeout(fetcher, "/repo", { path: "src/file.ts", staged: true }, 15000)).rejects
      .toThrow("diff failed")

    expect(vi.getTimerCount()).toBe(0)
  })

  test("settles and clears its timer when the diff fetch times out", async () => {
    vi.useFakeTimers()
    const fetcher = vi.fn<GitFileDiffFetcher>().mockReturnValue(new Promise(() => {}))

    const pending = fetchGitFileDiffWithTimeout(fetcher, "/repo", { path: "src/file.ts", staged: false }, 25)
    const expectation = expect(pending).rejects.toThrow("Timed out after 25ms")
    await vi.advanceTimersByTimeAsync(25)

    await expectation
    expect(vi.getTimerCount()).toBe(0)
  })

  test("ignores a late diff result after the timeout has already fired", async () => {
    vi.useFakeTimers()
    let resolveDiff: (value: { path: string; original: string; modified: string }) => void = () => {}
    const fetcher = vi.fn<GitFileDiffFetcher>().mockReturnValue(
      new Promise((resolve) => {
        resolveDiff = resolve
      }),
    )

    const pending = fetchGitFileDiffWithTimeout(fetcher, "/repo", { path: "src/file.ts", staged: false }, 25)
    const expectation = expect(pending).rejects.toThrow("Timed out after 25ms")
    await vi.advanceTimersByTimeAsync(25)
    resolveDiff({ path: "src/file.ts", original: "late", modified: "late" })

    await expectation
    expect(vi.getTimerCount()).toBe(0)
  })
})
