/**
 * Browser runtime adapter (ADR-047).
 *
 * Manages the Playwright browser instance lifecycle. The instance
 * persists for the session lifetime (not individual tool calls)
 * to avoid cold-start overhead. Browser contexts are isolated
 * from each other to prevent cross-target contamination.
 *
 * This is a stub until Playwright is added as a dependency.
 * The actual Playwright integration will replace the stub methods
 * with real browser automation calls.
 */
import { Log } from "@/util/log"

const log = Log.create({ service: "visual.browser" })

export type BrowserPage = {
  pageID: string
  url: string
  title: string
  viewport: { width: number; height: number }
}

export type BrowserSnapshot = {
  pageID: string
  elements: { uid: string; role: string; name: string; value?: string }[]
  text: string
}

export type BrowserScreenshot = {
  pageID: string
  data: Buffer
  format: "png" | "jpeg"
  width: number
  height: number
}

export type BrowserConsoleMessage = {
  type: string
  text: string
  timestamp: number
}

export type BrowserNetworkRequest = {
  url: string
  method: string
  status: number
  resourceType: string
  timestamp: number
}

/**
 * Runtime adapter for browser automation.
 * This stub throws until Playwright is integrated.
 */
export class BrowserRuntime {
  private static instance: BrowserRuntime | undefined

  static get(): BrowserRuntime {
    if (!BrowserRuntime.instance) {
      BrowserRuntime.instance = new BrowserRuntime()
    }
    return BrowserRuntime.instance
  }

  async open(url: string, viewport: { width: number; height: number }): Promise<BrowserPage> {
    log.warn("browser runtime not available", { url })
    throw new Error(
      "Browser Agent runtime is not available. Install Playwright (`pnpm add playwright`) and ensure the browser binary is downloaded (`npx playwright install chromium`).",
    )
  }

  async snapshot(pageID: string, verbose: boolean): Promise<BrowserSnapshot> {
    throw new Error("Browser Agent runtime is not available.")
  }

  async action(pageID: string, action: string, params: Record<string, unknown>): Promise<string> {
    throw new Error("Browser Agent runtime is not available.")
  }

  async screenshot(
    pageID: string,
    options: { fullPage?: boolean; format?: "png" | "jpeg"; quality?: number; uid?: string },
  ): Promise<BrowserScreenshot> {
    throw new Error("Browser Agent runtime is not available.")
  }

  async console(
    pageID: string,
    options: { types?: string[]; pageIdx?: number; pageSize?: number },
  ): Promise<BrowserConsoleMessage[]> {
    throw new Error("Browser Agent runtime is not available.")
  }

  async network(
    pageID: string,
    options: { resourceTypes?: string[]; pageIdx?: number; pageSize?: number },
  ): Promise<BrowserNetworkRequest[]> {
    throw new Error("Browser Agent runtime is not available.")
  }

  async evaluate(pageID: string, fn: string, args?: { uid: string }[]): Promise<unknown> {
    throw new Error("Browser Agent runtime is not available.")
  }

  async close(): Promise<void> {
    // No-op for stub
  }
}
