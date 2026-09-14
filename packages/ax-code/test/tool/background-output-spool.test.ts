import { afterEach, describe, expect, test, vi } from "vitest"
import fs from "node:fs"
import path from "node:path"
import { BackgroundOutputSpool } from "../../src/tool/background-output-spool"

afterEach(() => {
  vi.restoreAllMocks()
  BackgroundOutputSpool.reset()
})

describe("background output spool", () => {
  test("private output is read incrementally and removed after consumption", () => {
    const spool = new BackgroundOutputSpool()
    spool.append("first 🦊\n")
    const directory = BackgroundOutputSpool.statsForTests().directory!
    const file = path.join(directory, fs.readdirSync(directory)[0])
    expect(fs.readFileSync(file, "utf8")).toBe("first 🦊\n")
    if (process.platform !== "win32") {
      expect(fs.statSync(directory).mode & 0o777).toBe(0o700)
      expect(fs.statSync(file).mode & 0o777).toBe(0o600)
    }
    expect(spool.read()).toEqual({ output: "first 🦊\n", dropped: false })
    expect(fs.existsSync(directory)).toBe(false)
    spool.append("second é\n")
    expect(spool.read()).toEqual({ output: "second é\n", dropped: false })
    expect(spool.read()).toEqual({ output: "", dropped: false })
  })

  test("ring wrap drops only whole UTF-8 characters and preserves remaining order", () => {
    const spool = new BackgroundOutputSpool()
    const prefix = "🦊".repeat(BackgroundOutputSpool.capacity / 4)
    spool.append(prefix)
    spool.append("Xé")
    const result = spool.read()
    expect(result.output).toBe(prefix.slice(2) + "Xé")
    expect(Buffer.byteLength(result.output)).toBeLessThanOrEqual(BackgroundOutputSpool.capacity)
    expect(result.output).not.toContain("�")
    expect(result.dropped).toBe(true)
    spool.append("after\n")
    expect(spool.read()).toEqual({ output: "after\n", dropped: false })
    expect(spool.integrity).toBe("dropped")
  })

  test("oversized Unicode chunk is bounded without splitting surrogate pairs", () => {
    const spool = new BackgroundOutputSpool()
    const text = "a".repeat(10) + "🦊" + "x".repeat(BackgroundOutputSpool.capacity - 1)
    spool.append(text)
    expect(spool.read()).toEqual({ output: "x".repeat(BackgroundOutputSpool.capacity - 1), dropped: true })
    spool.append("é".repeat(BackgroundOutputSpool.capacity))
    expect(spool.read()).toEqual({ output: "é".repeat(BackgroundOutputSpool.capacity / 2), dropped: true })
  })

  test.each(["openSync", "writeSync", "readSync"] as const)("%s failure is explicit without RAM fallback", (method) => {
    const spool = new BackgroundOutputSpool()
    if (method === "readSync") spool.append("proof\n")
    const mock = vi.spyOn(fs, method).mockImplementation(() => {
      throw new Error("simulated storage failure")
    })
    if (method !== "readSync") spool.append("proof\n")
    const result = spool.read()
    mock.mockRestore()
    expect(result).toEqual({ output: "", dropped: true })
    expect(spool.integrity).toBe("storage_error")
    spool.append("unbounded fallback is forbidden".repeat(100_000))
    expect(spool.unreadBytes).toBe(0)
    expect(BackgroundOutputSpool.statsForTests().reservedBytes).toBe(0)
  })

  test("failed unlink keeps its disk reservation until cleanup can succeed", () => {
    const spool = new BackgroundOutputSpool()
    spool.append("proof")
    const directory = BackgroundOutputSpool.statsForTests().directory!
    const mock = vi.spyOn(fs, "unlinkSync").mockImplementation(() => {
      throw new Error("simulated busy file")
    })
    spool.dispose()
    expect(spool.integrity).toBe("storage_error")
    expect(BackgroundOutputSpool.statsForTests().reservedBytes).toBe(BackgroundOutputSpool.capacity)
    mock.mockRestore()
    BackgroundOutputSpool.reset()
    expect(BackgroundOutputSpool.statsForTests().reservedBytes).toBe(0)
    expect(fs.existsSync(directory)).toBe(false)
  })

  test("expired empty output remains explicitly incomplete", () => {
    const spool = new BackgroundOutputSpool()
    spool.expire()
    expect(spool.read()).toEqual({ output: "", dropped: true })
    expect(spool.integrity).toBe("expired")
  })
})
