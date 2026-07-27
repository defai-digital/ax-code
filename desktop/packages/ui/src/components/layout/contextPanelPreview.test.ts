import { describe, expect, test } from "vitest"

import {
  getContextPanelPreviewConsoleFilterMatch,
  normalizeContextPanelBrowserUrl,
  type PreviewConsoleEvent,
} from "./contextPanelPreview"

const eventWithLevel = (level: PreviewConsoleEvent["level"]): PreviewConsoleEvent => ({
  id: 1,
  level,
  message: "message",
  ts: 0,
})

describe("getContextPanelPreviewConsoleFilterMatch", () => {
  test("matches every level when the filter is all", () => {
    for (const level of ["log", "info", "warn", "error", "debug", "resource", "runtime"] as const) {
      expect(getContextPanelPreviewConsoleFilterMatch(eventWithLevel(level), "all")).toBe(true)
    }
  })

  test("matches error, runtime, and resource levels for the errors filter", () => {
    expect(getContextPanelPreviewConsoleFilterMatch(eventWithLevel("error"), "errors")).toBe(true)
    expect(getContextPanelPreviewConsoleFilterMatch(eventWithLevel("runtime"), "errors")).toBe(true)
    expect(getContextPanelPreviewConsoleFilterMatch(eventWithLevel("resource"), "errors")).toBe(true)
    expect(getContextPanelPreviewConsoleFilterMatch(eventWithLevel("warn"), "errors")).toBe(false)
    expect(getContextPanelPreviewConsoleFilterMatch(eventWithLevel("log"), "errors")).toBe(false)
  })

  test("matches only warn level for the warnings filter", () => {
    expect(getContextPanelPreviewConsoleFilterMatch(eventWithLevel("warn"), "warnings")).toBe(true)
    expect(getContextPanelPreviewConsoleFilterMatch(eventWithLevel("error"), "warnings")).toBe(false)
    expect(getContextPanelPreviewConsoleFilterMatch(eventWithLevel("info"), "warnings")).toBe(false)
  })

  test("matches log, info, and debug levels for the logs filter", () => {
    expect(getContextPanelPreviewConsoleFilterMatch(eventWithLevel("log"), "logs")).toBe(true)
    expect(getContextPanelPreviewConsoleFilterMatch(eventWithLevel("info"), "logs")).toBe(true)
    expect(getContextPanelPreviewConsoleFilterMatch(eventWithLevel("debug"), "logs")).toBe(true)
    expect(getContextPanelPreviewConsoleFilterMatch(eventWithLevel("warn"), "logs")).toBe(false)
    expect(getContextPanelPreviewConsoleFilterMatch(eventWithLevel("error"), "logs")).toBe(false)
  })
})

describe("normalizeContextPanelBrowserUrl", () => {
  test("returns about:blank for blank input", () => {
    expect(normalizeContextPanelBrowserUrl("")).toBe("about:blank")
    expect(normalizeContextPanelBrowserUrl("   ")).toBe("about:blank")
  })

  test("adds an https scheme when none is present", () => {
    expect(normalizeContextPanelBrowserUrl("example.com")).toBe("https://example.com/")
    expect(normalizeContextPanelBrowserUrl("localhost:3000/app")).toBe("https://localhost:3000/app")
  })

  test("keeps http and https URLs intact", () => {
    expect(normalizeContextPanelBrowserUrl("http://example.com/a?b=1#c")).toBe("http://example.com/a?b=1#c")
    expect(normalizeContextPanelBrowserUrl("https://example.com")).toBe("https://example.com/")
  })

  test("rejects non-http schemes", () => {
    expect(normalizeContextPanelBrowserUrl("ftp://example.com/file")).toBe("about:blank")
    expect(normalizeContextPanelBrowserUrl("file:///etc/passwd")).toBe("about:blank")
  })

  test("returns about:blank for unparseable input", () => {
    expect(normalizeContextPanelBrowserUrl("http://")).toBe("about:blank")
  })
})
