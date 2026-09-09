import { expect, test, vi } from "vitest"
import { prepareTestNative, transientNativeDownload } from "../../script/test-native"
import { tmpdir } from "../fixture/fixture"

test("prepares once before admitting offline test workers", async () => {
  await using tmp = await tmpdir()
  const prepare = vi.fn().mockResolvedValue({ libraryPath: "library", licensePath: "license" })
  expect(await prepareTestNative({ cacheDir: tmp.path, target: "linux-x64", prepare })).toBe(tmp.path)
  expect(prepare.mock.calls).toEqual([
    ["linux-x64", { cacheDir: tmp.path }],
    ["linux-x64", { cacheDir: tmp.path, offline: true }],
  ])
})

test("retries a transient dependency failure before starting offline tests", async () => {
  await using tmp = await tmpdir()
  const prepare = vi
    .fn()
    .mockRejectedValueOnce(new Error("Cannot download ax-tui native artifact (500): https://example.test/LICENSE"))
    .mockResolvedValue({ libraryPath: "library", licensePath: "license" })
  const delay = vi.fn().mockResolvedValue(undefined)
  await prepareTestNative({ cacheDir: tmp.path, target: "linux-x64", prepare, delay })
  expect(prepare).toHaveBeenCalledTimes(3)
  expect(delay).toHaveBeenCalledExactlyOnceWith(500)
})

test("bounds retries and propagates an unavailable dependency", async () => {
  await using tmp = await tmpdir()
  const error = new Error("Cannot download ax-tui native artifact (503): https://example.test/LICENSE")
  const prepare = vi.fn().mockRejectedValue(error)
  const delay = vi.fn().mockResolvedValue(undefined)
  await expect(prepareTestNative({ cacheDir: tmp.path, target: "linux-x64", prepare, delay })).rejects.toBe(error)
  expect(prepare).toHaveBeenCalledTimes(3)
  expect(delay.mock.calls).toEqual([[500], [1000]])
})

test.each([
  "ax-tui native artifact SHA-256 mismatch: library",
  "Invalid ax-tui native manifest entry: linux-x64",
  "Cannot download ax-tui native artifact (404): https://example.test/LICENSE",
])("does not retry or admit %s", async (message) => {
  await using tmp = await tmpdir()
  const prepare = vi.fn().mockRejectedValue(new Error(message))
  const delay = vi.fn()
  await expect(prepareTestNative({ cacheDir: tmp.path, target: "linux-x64", prepare, delay })).rejects.toThrow(message)
  expect(prepare).toHaveBeenCalledTimes(1)
  expect(delay).not.toHaveBeenCalled()
})

test("keeps failed offline verification fatal", async () => {
  await using tmp = await tmpdir()
  const prepare = vi
    .fn()
    .mockResolvedValueOnce({ libraryPath: "library", licensePath: "license" })
    .mockRejectedValueOnce(new Error("ax-tui native library is unavailable offline"))
  await expect(prepareTestNative({ cacheDir: tmp.path, target: "linux-x64", prepare })).rejects.toThrow(
    "unavailable offline",
  )
  expect(prepare).toHaveBeenCalledTimes(2)
})

test("recognizes transient transport failures without retrying arbitrary errors", () => {
  expect(transientNativeDownload(new DOMException("deadline", "TimeoutError"))).toBe(true)
  expect(transientNativeDownload(new TypeError("fetch failed"))).toBe(true)
  expect(transientNativeDownload(new Error("fetch failed"))).toBe(false)
  expect(transientNativeDownload(new Error("SHA-256 mismatch"))).toBe(false)
})
