import { describe, expect, test, vi } from "vitest"
import fs from "fs"
import path from "path"
import os from "os"
import { parseViewport, resolveViewports, captureViewportMatrix, formatViewportMatrix } from "../../src/visual/viewport"
import { BrowserRuntime } from "../../src/tool/browser/runtime"

describe("visual.viewport", () => {
  test("parseViewport resolves named presets", () => {
    expect(parseViewport("desktop")).toEqual({ label: "desktop", width: 1440, height: 900 })
    expect(parseViewport("tablet")).toEqual({ label: "tablet", width: 768, height: 1024 })
    expect(parseViewport("mobile")).toEqual({ label: "mobile", width: 390, height: 844 })
  })

  test("parseViewport resolves named presets case-insensitively", () => {
    expect(parseViewport("Desktop")).toEqual({ label: "desktop", width: 1440, height: 900 })
    expect(parseViewport("MOBILE")).toEqual({ label: "mobile", width: 390, height: 844 })
  })

  test("parseViewport resolves explicit dimensions", () => {
    expect(parseViewport("1920x1080")).toEqual({ label: "1920x1080", width: 1920, height: 1080 })
    expect(parseViewport("320x240")).toEqual({ label: "320x240", width: 320, height: 240 })
  })

  test("parseViewport rejects out-of-range dimensions", () => {
    expect(parseViewport("100x100")).toBeUndefined()
    expect(parseViewport("5000x5000")).toBeUndefined()
    expect(parseViewport("0x0")).toBeUndefined()
  })

  test("parseViewport returns undefined for invalid input", () => {
    expect(parseViewport("")).toBeUndefined()
    expect(parseViewport("invalid")).toBeUndefined()
    expect(parseViewport("abcxdef")).toBeUndefined()
    expect(parseViewport("1440")).toBeUndefined()
  })

  test("resolveViewports returns default viewports when no input", () => {
    const result = resolveViewports()
    expect(result.length).toBe(3)
    expect(result.map((v) => v.label)).toEqual(["desktop", "tablet", "mobile"])
  })

  test('resolveViewports handles "all" keyword', () => {
    const result = resolveViewports("all")
    expect(result.length).toBe(3)
    expect(result.map((v) => v.label)).toEqual(["desktop", "tablet", "mobile"])
  })

  test("resolveViewports parses comma-separated string", () => {
    const result = resolveViewports("desktop,mobile")
    expect(result.length).toBe(2)
    expect(result[0]?.label).toBe("desktop")
    expect(result[1]?.label).toBe("mobile")
  })

  test("resolveViewports parses array input", () => {
    const result = resolveViewports(["tablet", "1920x1080"])
    expect(result.length).toBe(2)
    expect(result[0]?.label).toBe("tablet")
    expect(result[1]?.label).toBe("1920x1080")
  })

  test("resolveViewports filters invalid entries", () => {
    const result = resolveViewports("desktop,invalid,mobile")
    expect(result.length).toBe(2)
    expect(result.map((v) => v.label)).toEqual(["desktop", "mobile"])
  })

  test("resolveViewports trims whitespace in comma-separated input", () => {
    const result = resolveViewports("desktop , mobile , tablet")
    expect(result.length).toBe(3)
  })

  // -- formatViewportMatrix tests --

  test("formatViewportMatrix shows all-success summary", () => {
    const result = formatViewportMatrix({
      url: "http://localhost:3000",
      runID: "run_1",
      captures: [
        { viewport: { label: "desktop", width: 1440, height: 900 } },
        { viewport: { label: "mobile", width: 375, height: 812 } },
      ],
      totalViewports: 2,
      successCount: 2,
      failureCount: 0,
    })
    expect(result).toContain("Captured: 2/2")
    expect(result).not.toContain("Failed:")
    expect(result).toContain("[OK]")
  })

  test("formatViewportMatrix shows failures", () => {
    const result = formatViewportMatrix({
      url: "http://localhost:3000",
      runID: "run_1",
      captures: [
        { viewport: { label: "desktop", width: 1440, height: 900 } },
        { viewport: { label: "mobile", width: 375, height: 812 }, error: "timeout" },
      ],
      totalViewports: 2,
      successCount: 1,
      failureCount: 1,
    })
    expect(result).toContain("Captured: 1/2")
    expect(result).toContain("Failed: 1")
    expect(result).toContain("[FAIL]")
    expect(result).toContain("timeout")
  })

  // -- captureViewportMatrix tests --

  test("captureViewportMatrix captures all viewports and closes pages", async () => {
    const closePage = vi.fn(async () => {})
    const open = vi.fn(async (_url: string, vp: { width: number; height: number }) => ({
      pageID: `page_${vp.width}`,
      url: _url,
      title: "Test",
      viewport: vp,
    }))
    const screenshot = vi.fn(async () => ({
      pageID: "page_1440",
      data: Buffer.from("png-data"),
      format: "png" as const,
      width: 1440,
      height: 900,
    }))

    vi.spyOn(BrowserRuntime, "get").mockReturnValue({
      open,
      screenshot,
      closePage,
    } as unknown as BrowserRuntime)

    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "vp-test-"))
    try {
      const result = await captureViewportMatrix(
        tmpDir,
        "run_test",
        "http://localhost:3000",
        [{ label: "desktop", width: 1440, height: 900 }],
      )

      expect(result.successCount).toBe(1)
      expect(result.failureCount).toBe(0)
      expect(open).toHaveBeenCalledOnce()
      expect(closePage).toHaveBeenCalledOnce()
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true })
    }
  })
})
