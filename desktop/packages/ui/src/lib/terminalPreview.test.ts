import { afterEach, describe, expect, test, vi } from "vitest"
import { extractTerminalPreviewUrl, isTerminalPreviewUrlAvailable } from "./terminalPreview"

afterEach(() => {
  vi.unstubAllGlobals()
})

describe("terminal preview URL detection", () => {
  test("extracts IPv4 loopback preview URLs outside 127.0.0.1", () => {
    expect(extractTerminalPreviewUrl("Vite ready at http://127.0.0.2:5173/app.")).toBe(
      "http://127.0.0.2:5173/app",
    )
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
