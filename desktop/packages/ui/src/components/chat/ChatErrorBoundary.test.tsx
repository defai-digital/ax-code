import React, { act } from "react"
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import { createRoot, type Root } from "react-dom/client"
import { I18nProvider } from "@/lib/i18n"
import { ChatErrorBoundary } from "./ChatErrorBoundary"

const ThrowingChild = () => {
  throw new Error("session render failed")
}

describe("ChatErrorBoundary", () => {
  let container: HTMLDivElement
  let root: Root
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    container = document.createElement("div")
    document.body.appendChild(container)
    root = createRoot(container)
    consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {})
  })

  afterEach(() => {
    act(() => {
      root.unmount()
    })
    container.remove()
    consoleErrorSpy.mockRestore()
  })

  const renderBoundary = (sessionId: string, shouldThrow: boolean) => {
    act(() => {
      root.render(
        <I18nProvider>
          <ChatErrorBoundary sessionId={sessionId}>
            {shouldThrow ? <ThrowingChild /> : <div>Session content {sessionId}</div>}
          </ChatErrorBoundary>
        </I18nProvider>,
      )
    })
  }

  test("resets a crashed chat view when the session changes", () => {
    renderBoundary("ses_failed", true)

    expect(container.textContent).toContain("ses_failed")
    expect(container.textContent).not.toContain("Session content ses_next")

    renderBoundary("ses_next", false)

    expect(container.textContent).toContain("Session content ses_next")
    expect(container.textContent).not.toContain("ses_failed")
  })
})
