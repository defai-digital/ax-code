import { afterEach, describe, expect, test, vi } from "vitest"
import {
  extractLoopbackUrls,
  getExternalFaviconUrl,
  getSafeExternalUrl,
  isLoopbackHttpUrl,
  isSafeExternalUrl,
  normalizeLoopbackPreviewUrl,
  openExternalUrl,
} from "./url"

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  delete (window as unknown as { __TAURI__?: unknown }).__TAURI__
})

describe("loopback URL helpers", () => {
  test("treats the full IPv4 127/8 range as loopback", () => {
    expect(isLoopbackHttpUrl("http://127.0.0.2:5173/")).toBe(true)
    expect(isLoopbackHttpUrl("http://127.10.20.30:3000/path")).toBe(true)
    expect(isLoopbackHttpUrl("http://[::]:5173/")).toBe(true)
    expect(isLoopbackHttpUrl("https://example.com")).toBe(false)
  })

  test("extracts IPv4 loopback preview URLs from free text", () => {
    expect(extractLoopbackUrls("Server ready at http://127.0.0.2:5173/app.")).toEqual(["http://127.0.0.2:5173/app"])
  })

  test("normalizes unspecified loopback preview URLs for browser access", () => {
    expect(normalizeLoopbackPreviewUrl("http://0.0.0.0:5173/app?x=1#top")).toBe("http://127.0.0.1:5173/app?x=1#top")
    expect(normalizeLoopbackPreviewUrl("http://[::]:5173/app")).toBe("http://127.0.0.1:5173/app")
    expect(normalizeLoopbackPreviewUrl("http://[::1]:5173/app")).toBe("http://127.0.0.1:5173/app")
    expect(normalizeLoopbackPreviewUrl("https://example.com")).toBeNull()
  })

  test("extracts and normalizes unspecified loopback preview URLs from free text", () => {
    expect(extractLoopbackUrls("Server ready at http://0.0.0.0:5173/app.")).toEqual(["http://127.0.0.1:5173/app"])
    expect(extractLoopbackUrls("Server ready at http://[::]:5173/app.")).toEqual(["http://127.0.0.1:5173/app"])
  })
})

describe("safe external URL helpers", () => {
  test("normalizes safe external URLs and rejects unsafe targets", () => {
    expect(getSafeExternalUrl(" https://example.com/docs?q=1 ")).toBe("https://example.com/docs?q=1")
    expect(getSafeExternalUrl("mailto:support@example.com")).toBe("mailto:support@example.com")
    expect(getSafeExternalUrl("tel:+15551234567")).toBe("tel:+15551234567")
    expect(getSafeExternalUrl("javascript:alert(1)")).toBeNull()
    expect(getSafeExternalUrl("https://user:pass@example.com/docs")).toBeNull()
    expect(getSafeExternalUrl("https://example.com\n.evil.test/docs")).toBeNull()
    expect(getSafeExternalUrl("https://example.com\t.evil.test/docs")).toBeNull()
  })

  test("allows browser and OS-safe external protocols", () => {
    expect(isSafeExternalUrl("https://example.com")).toBe(true)
    expect(isSafeExternalUrl("mailto:support@example.com")).toBe(true)
    expect(isSafeExternalUrl("tel:+15551234567")).toBe(true)
    expect(isSafeExternalUrl("file:///Users/test/secret.txt")).toBe(false)
    expect(isSafeExternalUrl("javascript:alert(1)")).toBe(false)
    expect(isSafeExternalUrl("https://user:pass@example.com/docs")).toBe(false)
  })

  test("does not build favicons for credential-bearing URLs", () => {
    expect(getExternalFaviconUrl("https://example.com/docs")).toBe("https://icons.duckduckgo.com/ip3/example.com.ico")
    expect(getExternalFaviconUrl("https://user:pass@example.com/docs")).toBeNull()
  })

  test("opens mailto and tel URLs through the desktop bridge", async () => {
    const calls: Array<{ command: string; args?: Record<string, unknown> }> = []
    ;(window as unknown as { __TAURI__?: unknown }).__TAURI__ = {
      core: {
        invoke: async (command: string, args?: Record<string, unknown>) => {
          calls.push({ command, args })
          return null
        },
      },
    }
    vi.spyOn(window, "open").mockImplementation(() => null)

    await expect(openExternalUrl("mailto:support@example.com")).resolves.toBe(true)
    await expect(openExternalUrl("tel:+15551234567")).resolves.toBe(true)

    expect(calls).toEqual([
      { command: "desktop_open_external_url", args: { url: "mailto:support@example.com" } },
      { command: "desktop_open_external_url", args: { url: "tel:+15551234567" } },
    ])
  })

  test("falls back to window.open for safe protocols when the desktop bridge fails", async () => {
    ;(window as unknown as { __TAURI__?: unknown }).__TAURI__ = {
      core: {
        invoke: async () => {
          throw new Error("bridge unavailable")
        },
      },
    }
    const open = vi.spyOn(window, "open").mockImplementation(() => null)

    await expect(openExternalUrl("mailto:support@example.com")).resolves.toBe(true)
    expect(open).toHaveBeenCalledWith("mailto:support@example.com", "_blank", "noopener,noreferrer")
  })

  test("rejects unsafe external protocols before opening", async () => {
    const invoke = vi.fn()
    ;(window as unknown as { __TAURI__?: unknown }).__TAURI__ = {
      core: {
        invoke,
      },
    }
    const open = vi.spyOn(window, "open").mockImplementation(() => null)

    await expect(openExternalUrl("file:///Users/test/secret.txt")).resolves.toBe(false)
    await expect(openExternalUrl("https://user:pass@example.com/docs")).resolves.toBe(false)
    expect(invoke).not.toHaveBeenCalled()
    expect(open).not.toHaveBeenCalled()
  })
})
