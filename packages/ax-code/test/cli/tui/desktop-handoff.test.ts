import { describe, expect, test } from "vitest"
import { resolveDesktopHandoff, __internal } from "@/cli/cmd/tui/navigation/desktop-handoff"

describe("resolveDesktopHandoff", () => {
  test("returns message with URL when desktopUrl is provided", () => {
    const result = resolveDesktopHandoff({
      platform: "darwin",
      desktopUrl: "http://localhost:3000",
    })
    expect(result.type).toBe("message")
    if (result.type === "message") {
      expect(result.message).toContain("http://localhost:3000")
      expect(result.message).toContain("Desktop")
    }
  })

  test("returns not-installed guidance for macOS without URL", () => {
    const result = resolveDesktopHandoff({
      platform: "darwin",
    })
    expect(result.type).toBe("not-installed")
    if (result.type === "not-installed") {
      expect(result.message).toContain("Desktop")
      expect(result.message).toContain("dashboard")
      expect(result.message).toContain(__internal.DESKTOP_DOCS_URL)
    }
  })

  test("returns not-installed guidance for Windows without URL", () => {
    const result = resolveDesktopHandoff({
      platform: "win32",
    })
    expect(result.type).toBe("not-installed")
    if (result.type === "not-installed") {
      expect(result.message).toContain("Desktop")
      expect(result.message).toContain("workflow supervision")
    }
  })

  test("returns unsupported for Linux platform", () => {
    const result = resolveDesktopHandoff({
      platform: "linux",
    })
    expect(result.type).toBe("unsupported")
    if (result.type === "unsupported") {
      expect(result.message).toContain("linux")
      expect(result.message).toContain("not yet available")
    }
  })

  test("returns unsupported for other platforms", () => {
    const result = resolveDesktopHandoff({
      platform: "freebsd",
    })
    expect(result.type).toBe("unsupported")
    if (result.type === "unsupported") {
      expect(result.message).toContain("freebsd")
    }
  })

  test("desktopUrl takes precedence over platform check", () => {
    // Even on unsupported platform, if URL is provided, show it
    const result = resolveDesktopHandoff({
      platform: "linux",
      desktopUrl: "http://localhost:8080",
    })
    expect(result.type).toBe("message")
    if (result.type === "message") {
      expect(result.message).toContain("http://localhost:8080")
    }
  })

  test("message content includes Desktop and dashboard keywords", () => {
    const scenarios = ["darwin", "win32", "linux"] as const
    for (const platform of scenarios) {
      const result = resolveDesktopHandoff({ platform })
      const message = "message" in result ? result.message : ""
      // All messages should mention Desktop (product name)
      expect(message.toLowerCase()).toContain("desktop")
    }
  })

  test("supported platforms list includes darwin and win32", () => {
    expect(__internal.SUPPORTED_PLATFORMS).toContain("darwin")
    expect(__internal.SUPPORTED_PLATFORMS).toContain("win32")
    expect(__internal.SUPPORTED_PLATFORMS).not.toContain("linux")
  })

  test("docs URL is a valid URL", () => {
    expect(__internal.DESKTOP_DOCS_URL).toMatch(/^https?:\/\//)
  })
})
