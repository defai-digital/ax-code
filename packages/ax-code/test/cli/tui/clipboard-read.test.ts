import { afterEach, beforeEach, expect, test, vi } from "vitest"

const mocks = vi.hoisted(() => ({ run: vi.fn(), text: vi.fn(), read: vi.fn(), readBytes: vi.fn(), platform: "linux" }))
vi.mock("os", async (original) => ({
  ...(await original<typeof import("os")>()),
  platform: () => mocks.platform,
  release: () => "generic",
}))
vi.mock("@/util/process", () => ({ Process: { run: mocks.run, text: mocks.text } }))
vi.mock("clipboardy", () => ({ default: { read: mocks.read } }))
vi.mock("@/util/filesystem", () => ({ Filesystem: { readBytes: mocks.readBytes } }))
import { Clipboard } from "@tui/util/clipboard"

const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1])
const result = (code: number, stdout: Buffer) => ({ code, stdout, stderr: Buffer.alloc(0) })

beforeEach(() => {
  vi.resetAllMocks()
  mocks.platform = "linux"
  vi.stubEnv("WSL_DISTRO_NAME", "")
  vi.stubEnv("WSLENV", "")
  mocks.read.mockResolvedValue("clipboard text")
  mocks.run.mockResolvedValue(result(1, Buffer.alloc(0)))
})

afterEach(() => vi.unstubAllEnvs())

test("falls back from failed image reads even when they emitted a PNG prefix", async () => {
  mocks.run.mockResolvedValueOnce(result(1, png))
  expect(await Clipboard.read()).toEqual({ data: "clipboard text", mime: "text/plain" })
  expect(mocks.run).toHaveBeenCalledTimes(2)
})

test("rejects non-PNG helper output and tries the next image backend", async () => {
  mocks.run.mockResolvedValueOnce(result(0, Buffer.from("not an image")))
  mocks.run.mockResolvedValueOnce(result(0, png))
  expect(await Clipboard.read()).toEqual({ data: png.toString("base64"), mime: "image/png" })
})

test("bounds each image helper so an unresponsive clipboard owner cannot hang paste", async () => {
  await Clipboard.read()
  for (const [, options] of mocks.run.mock.calls) expect(options.timeout).toBe(5000)
})

test("ignores partial macOS files after a failed image conversion", async () => {
  mocks.platform = "darwin"
  mocks.readBytes.mockResolvedValue(png)
  expect(await Clipboard.read()).toEqual({ data: "clipboard text", mime: "text/plain" })
  expect(mocks.readBytes).not.toHaveBeenCalled()
})

test("ignores PNG-looking output from failed Windows image conversion", async () => {
  mocks.platform = "win32"
  mocks.text.mockResolvedValue({ ...result(1, png), text: png.toString("base64") })
  expect(await Clipboard.read()).toEqual({ data: "clipboard text", mime: "text/plain" })
  expect(mocks.text.mock.calls[0][1].timeout).toBe(5000)
})
