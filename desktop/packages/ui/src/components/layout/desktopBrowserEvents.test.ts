import { describe, expect, test } from "vitest"

import { readDesktopBrowserNewWindowNavigation } from "./desktopBrowserEvents"

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
