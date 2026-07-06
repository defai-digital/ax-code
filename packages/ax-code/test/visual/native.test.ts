import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import fs from "fs"
import path from "path"
import os from "os"

const pngData = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64",
)

const runMock = vi.fn(async (cmd: string[]) => {
  const outputPath = cmd.at(-1)
  if (outputPath?.endsWith(".png")) {
    await fs.promises.writeFile(outputPath, pngData)
  }
  return { code: 0, stdout: Buffer.alloc(0), stderr: Buffer.alloc(0) }
})

const textMock = vi.fn(async () => ({
  code: 0,
  stdout: Buffer.from("Terminal\nzsh\n10\n20\n300\n200\n"),
  stderr: Buffer.alloc(0),
  text: "Terminal\nzsh\n10\n20\n300\n200\n",
}))

vi.mock("../../src/util/process", () => ({
  Process: {
    run: runMock,
    text: textMock,
  },
}))

function setPlatform(platform: NodeJS.Platform) {
  Object.defineProperty(process, "platform", {
    value: platform,
    configurable: true,
  })
}

describe("visual.native", () => {
  const platformDescriptor = Object.getOwnPropertyDescriptor(process, "platform")
  let tmpDir: string

  beforeEach(async () => {
    vi.resetModules()
    runMock.mockClear()
    textMock.mockClear()
    tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "visual-native-test-"))
  })

  afterEach(async () => {
    if (platformDescriptor) Object.defineProperty(process, "platform", platformDescriptor)
    await fs.promises.rm(tmpDir, { recursive: true, force: true }).catch(() => {})
  })

  test("captures a macOS screen through screencapture", async () => {
    setPlatform("darwin")
    const { captureNativeSnapshot } = await import("../../src/visual/native")

    const result = await captureNativeSnapshot({ type: "screen", display: 1 })

    expect(result.data).toEqual(pngData)
    expect(result.label).toBe("Native screen 1")
    expect(result.target).toEqual({ type: "screen", display: 1 })
    expect(runMock).toHaveBeenCalledWith(expect.arrayContaining(["screencapture", "-x", "-D", "1"]), {
      timeout: 20_000,
    })
  })

  test("captures a macOS terminal by resolving the frontmost terminal window bounds", async () => {
    setPlatform("darwin")
    const { captureNativeSnapshot } = await import("../../src/visual/native")

    const result = await captureNativeSnapshot({ type: "terminal" })

    expect(textMock).toHaveBeenCalledWith(expect.arrayContaining(["osascript"]), { timeout: 10_000 })
    expect(runMock).toHaveBeenCalledWith(expect.arrayContaining(["screencapture", "-x", "-R", "10,20,300,200"]), {
      timeout: 20_000,
    })
    expect(result.label).toBe("Terminal window: Terminal - zsh")
    expect(result.target).toEqual({ type: "terminal", appName: "Terminal", windowTitle: "zsh" })
    expect(result.width).toBe(300)
    expect(result.height).toBe(200)
  })

  test("rejects implicit terminal capture when the frontmost app is not a terminal", async () => {
    setPlatform("darwin")
    textMock.mockResolvedValueOnce({
      code: 0,
      stdout: Buffer.from("Safari\nExample\n10\n20\n300\n200\n"),
      stderr: Buffer.alloc(0),
      text: "Safari\nExample\n10\n20\n300\n200\n",
    })
    const { captureNativeSnapshot } = await import("../../src/visual/native")

    await expect(captureNativeSnapshot({ type: "terminal" })).rejects.toThrow(/not a recognized terminal/)
  })

  test("stores native terminal snapshots as computer visual runs", async () => {
    setPlatform("darwin")
    const { captureSnapshot } = await import("../../src/visual/snapshot")

    const result = await captureSnapshot(tmpDir, "session-native", { type: "terminal" })

    expect(result.run.mode).toBe("computer")
    expect(result.run.target).toEqual({ type: "terminal", appName: "Terminal", windowTitle: "zsh" })
    expect(result.run.artifacts[0]?.kind).toBe("screenshot")
    expect(result.screenshotData).toEqual(pngData)
  })
})
