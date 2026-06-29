import { afterEach, describe, expect, test, vi } from "vitest"
import {
  buildTerminalPreviewScanState,
  extractTerminalPreviewUrl,
  isTerminalPreviewUrlAvailable,
} from "./terminalPreview"

afterEach(() => {
  vi.unstubAllGlobals()
})

describe("terminal preview URL detection", () => {
  test("scans a ready URL even when the terminal chunk has no trailing newline", () => {
    const state = buildTerminalPreviewScanState("", "Vite ready at http://localhost:5173/")

    expect(state).toEqual({
      scanText: "Vite ready at http://localhost:5173/",
      nextTail: "Vite ready at http://localhost:5173/",
    })
    expect(extractTerminalPreviewUrl(state.scanText)).toBe("http://localhost:5173/")
  })

  test("keeps enough tail to detect a preview URL split across terminal chunks", () => {
    const first = buildTerminalPreviewScanState("", "Vite ready at http://local")
    const second = buildTerminalPreviewScanState(first.nextTail, "host:5173/")

    expect(extractTerminalPreviewUrl(first.scanText)).toBeNull()
    expect(extractTerminalPreviewUrl(second.scanText)).toBe("http://localhost:5173/")
  })

  test("extracts IPv4 loopback preview URLs outside 127.0.0.1", () => {
    expect(extractTerminalPreviewUrl("Vite ready at http://127.0.0.2:5173/app.")).toBe("http://127.0.0.2:5173/app")
  })

  test("probes IPv4 loopback URLs outside 127.0.0.1", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 }))
    vi.stubGlobal("fetch", fetchMock)

    await expect(isTerminalPreviewUrlAvailable("http://127.0.0.2:5173/")).resolves.toBe(true)
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/system/probe-url",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ url: "http://127.0.0.2:5173/" }),
      }),
    )
  })
})
