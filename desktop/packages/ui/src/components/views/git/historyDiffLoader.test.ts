import { afterEach, describe, expect, test, vi } from "vitest"

const getCommitFileDiffMock = vi.fn()

const importHistoryDiffLoader = async () => {
  vi.resetModules()
  vi.doMock("@/lib/gitApi", () => ({
    getCommitFileDiff: getCommitFileDiffMock,
  }))

  return import("./historyDiffLoader")
}

describe("fetchHistoryCommitFileDiff", () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.doUnmock("@/lib/gitApi")
    vi.resetModules()
    getCommitFileDiffMock.mockReset()
  })

  test("clears its timeout after a successful diff fetch", async () => {
    vi.useFakeTimers()
    getCommitFileDiffMock.mockResolvedValue({
      original: "before",
      modified: "after",
      isBinary: false,
    })

    const { fetchHistoryCommitFileDiff } = await importHistoryDiffLoader()

    await expect(fetchHistoryCommitFileDiff("/repo", "abc123", "src/file.ts", 15000)).resolves.toEqual({
      original: "before",
      modified: "after",
      isBinary: false,
    })

    expect(getCommitFileDiffMock).toHaveBeenCalledWith("/repo", "abc123", "src/file.ts", false)
    expect(vi.getTimerCount()).toBe(0)
  })

  test("settles and clears its timer when a diff request times out", async () => {
    vi.useFakeTimers()
    getCommitFileDiffMock.mockReturnValue(new Promise(() => {}))

    const { fetchHistoryCommitFileDiff } = await importHistoryDiffLoader()

    const pending = fetchHistoryCommitFileDiff("/repo", "abc123", "src/file.ts", 25)
    const expectation = expect(pending).rejects.toThrow("Timed out after 25ms")
    await vi.advanceTimersByTimeAsync(25)

    await expectation
    expect(vi.getTimerCount()).toBe(0)
  })

  test("ignores a late diff result after the timeout has already fired", async () => {
    vi.useFakeTimers()
    let resolveDiff: (value: { original: string; modified: string }) => void = () => {}
    getCommitFileDiffMock.mockReturnValue(
      new Promise((resolve) => {
        resolveDiff = resolve
      }),
    )

    const { fetchHistoryCommitFileDiff } = await importHistoryDiffLoader()

    const pending = fetchHistoryCommitFileDiff("/repo", "abc123", "src/file.ts", 25)
    const expectation = expect(pending).rejects.toThrow("Timed out after 25ms")
    await vi.advanceTimersByTimeAsync(25)
    resolveDiff({ original: "late", modified: "late" })

    await expectation
    expect(vi.getTimerCount()).toBe(0)
  })
})
