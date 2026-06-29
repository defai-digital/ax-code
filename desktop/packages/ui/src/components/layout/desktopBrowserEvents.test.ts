import { describe, expect, test } from "vitest"

import { handleDesktopBrowserNewWindowEvent, readDesktopBrowserNewWindowNavigation } from "./desktopBrowserEvents"

const webviewNewWindowEvent = (input: { url?: string; disposition?: string }): Event => {
  const event = new Event("new-window", { cancelable: true }) as Event & {
    url?: string
    disposition?: string
  }
  event.url = input.url
  event.disposition = input.disposition
  return event
}

describe("readDesktopBrowserNewWindowNavigation", () => {
  test("reads Electron webview new-window fields from the event object", () => {
    expect(
      readDesktopBrowserNewWindowNavigation(
        webviewNewWindowEvent({ url: "https://example.com/docs", disposition: "new-window" }),
      ),
    ).toEqual({ url: "https://example.com/docs" })
  })

  test("keeps compatibility with CustomEvent detail payloads", () => {
    expect(
      readDesktopBrowserNewWindowNavigation(
        new CustomEvent("new-window", {
          detail: { url: "https://example.com/docs", disposition: "foreground-tab" },
        }),
      ),
    ).toEqual({ url: "https://example.com/docs" })
  })

  test("ignores same-window and missing-url navigation events", () => {
    expect(
      readDesktopBrowserNewWindowNavigation(
        webviewNewWindowEvent({ url: "https://example.com/docs", disposition: "current-tab" }),
      ),
    ).toBeNull()
    expect(readDesktopBrowserNewWindowNavigation(webviewNewWindowEvent({ disposition: "new-window" }))).toBeNull()
  })
})

describe("handleDesktopBrowserNewWindowEvent", () => {
  test("prevents the popup and loads supported new-window URLs in the same browser pane", () => {
    const event = webviewNewWindowEvent({ url: "https://example.com/docs", disposition: "new-window" })
    const loadedUrls: string[] = []

    expect(handleDesktopBrowserNewWindowEvent(event, (url) => loadedUrls.push(url))).toBe(true)

    expect(event.defaultPrevented).toBe(true)
    expect(loadedUrls).toEqual(["https://example.com/docs"])
  })

  test("prevents unmanaged popups even when the event cannot be converted to same-pane navigation", () => {
    const event = webviewNewWindowEvent({ disposition: "new-window" })
    const loadedUrls: string[] = []

    expect(handleDesktopBrowserNewWindowEvent(event, (url) => loadedUrls.push(url))).toBe(false)

    expect(event.defaultPrevented).toBe(true)
    expect(loadedUrls).toEqual([])
  })

  test("prevents unmanaged popups for unexpected dispositions", () => {
    const event = webviewNewWindowEvent({ url: "https://example.com/docs", disposition: "save-to-disk" })
    const loadedUrls: string[] = []

    expect(handleDesktopBrowserNewWindowEvent(event, (url) => loadedUrls.push(url))).toBe(false)

    expect(event.defaultPrevented).toBe(true)
    expect(loadedUrls).toEqual([])
  })
})
