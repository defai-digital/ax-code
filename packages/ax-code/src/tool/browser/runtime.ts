/**
 * Browser runtime adapter (ADR-047).
 *
 * Manages the Playwright browser instance lifecycle. The instance
 * persists for the session lifetime (not individual tool calls)
 * to avoid cold-start overhead. Browser contexts are isolated
 * from each other to prevent cross-target contamination.
 *
 * Playwright is loaded as an optional dependency via createRequire,
 * matching the pattern in src/native/addon.ts. If playwright-core
 * is not installed, all methods throw a diagnostic error.
 */
import { createRequire } from "node:module"
import { Log } from "@/util/log"

const log = Log.create({ service: "visual.browser" })

// ---------------------------------------------------------------------------
// Public types (stable API consumed by browser tools and viewport runner)
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Optional Playwright loading (mirrors native/addon.ts)
// ---------------------------------------------------------------------------

type PlaywrightModule = typeof import("playwright-core")
type PwBrowser = import("playwright-core").Browser
type PwBrowserContext = import("playwright-core").BrowserContext
type PwPage = import("playwright-core").Page

const _require = createRequire(import.meta.url)

let _playwright: PlaywrightModule | undefined
let _loadAttempted = false

function loadPlaywright(): PlaywrightModule | undefined {
  if (_loadAttempted) return _playwright
  _loadAttempted = true
  try {
    _playwright = _require("playwright-core") as PlaywrightModule
  } catch (e: unknown) {
    const code = (e as { code?: string })?.code
    if (code !== "MODULE_NOT_FOUND" && code !== "ERR_MODULE_NOT_FOUND") {
      log.warn("failed to load playwright-core", { error: String(e) })
    }
    _playwright = undefined
  }
  return _playwright
}

/** Reset load cache (test-only). */
export function _resetPlaywrightCache(): void {
  _playwright = undefined
  _loadAttempted = false
}

/** Inject Playwright module (test-only). */
export function _setPlaywrightForTest(playwright: PlaywrightModule | undefined): void {
  _playwright = playwright
  _loadAttempted = true
}

const INSTALL_HINT =
  "Install Playwright (`pnpm add playwright-core`) and ensure the browser binary is downloaded (`npx playwright install chromium`)."

// ---------------------------------------------------------------------------
// Internal types
// ---------------------------------------------------------------------------

type PageEntry = {
  pageID: string
  pwPage: PwPage
  context: PwBrowserContext
  url: string
  title: string
  viewport: { width: number; height: number }
}

/** Ring buffer cap for console and network logs per page. */
const BUFFER_CAP = 500

/** Escape UID values for safe interpolation into CSS attribute selectors. */
function escapeUid(uid: string): string {
  return uid.replace(/\\/g, "\\\\").replace(/"/g, '\\"')
}

// ---------------------------------------------------------------------------
// UID snapshot injection script
// ---------------------------------------------------------------------------

/**
 * Injected into the page to assign data-uid attributes to interactive
 * elements and return a serializable accessibility-like tree.
 */
const SNAPSHOT_SCRIPT = `
(() => {
  const ROLES = new Set([
    "a","button","input","select","textarea","img","h1","h2","h3","h4","h5","h6",
    "nav","main","header","footer","aside","section","article","form","table",
    "ul","ol","li","dialog","details","summary","label","fieldset","legend",
    "blockquote","pre","code","figure","figcaption","caption","thead","tbody","tfoot","tr","th","td"
  ])
  const IMPLICIT = {
    A:"link",BUTTON:"button",IMG:"img",NAV:"navigation",MAIN:"main",
    HEADER:"banner",FOOTER:"contentinfo",ASIDE:"complementary",
    SECTION:"region",ARTICLE:"article",FORM:"form",TABLE:"table",
    UL:"list",OL:"list",LI:"listitem",DIALOG:"dialog",
    H1:"heading",H2:"heading",H3:"heading",H4:"heading",H5:"heading",H6:"heading",
    INPUT:"textbox",SELECT:"combobox",TEXTAREA:"textbox",
    LABEL:"label",FIELDSET:"group",PRE:"code",BLOCKQUOTE:"blockquote",
    FIGURE:"figure",FIGCAPTION:"figcaption",DETAILS:"group",SUMMARY:"button",
    TABLE_THEAD:"rowgroup",TABLE_TBODY:"rowgroup",TABLE_TFOOT:"rowgroup",
    TABLE_TR:"row",TABLE_TH:"columnheader",TABLE_TD:"cell",TABLE_CAPTION:"caption",
  }
  function resolveRole(el) {
    const ar = el.getAttribute("role")
    if (ar) return ar
    const tag = el.tagName
    if (tag === "INPUT") {
      const t = (el.getAttribute("type") || "text").toLowerCase()
      if (t === "checkbox") return "checkbox"
      if (t === "radio") return "radio"
      if (t === "submit" || t === "reset" || t === "button") return "button"
      if (t === "search") return "searchbox"
      if (t === "range") return "slider"
      if (t === "file") return "button"
      return "textbox"
    }
    return IMPLICIT[tag] || (ROLES.has(tag.toLowerCase()) ? tag.toLowerCase() : "")
  }
  let counter = 0
  const results = []
  function walk(el, depth) {
    if (!el || el.nodeType !== 1) return
    const role = resolveRole(el)
    if (role) {
      counter++
      const uid = "uid_" + counter
      el.setAttribute("data-uid", uid)
      const name = el.getAttribute("aria-label") ||
                   (el.textContent || "").trim().slice(0, 200) ||
                   el.getAttribute("placeholder") ||
                   el.getAttribute("alt") || ""
      const value = el.value !== undefined ? String(el.value) : undefined
      results.push({ uid, role, name, value, depth })
    }
    for (let i = 0; i < el.children.length; i++) {
      walk(el.children[i], depth + (role ? 1 : 0))
    }
  }
  walk(document.body, 0)
  return results
})()
`

// ---------------------------------------------------------------------------
// BrowserRuntime
// ---------------------------------------------------------------------------

export class BrowserRuntime {
  private static instance: BrowserRuntime | undefined

  private browser: PwBrowser | undefined
  private pages = new Map<string, PageEntry>()
  private consoleBuffers = new Map<string, BrowserConsoleMessage[]>()
  private networkBuffers = new Map<string, BrowserNetworkRequest[]>()
  private uidRegistry = new Map<string, { pageID: string; uid: string }>()
  private latestPageID: string | undefined
  private pageCounter = 0
  private launchPromise: Promise<PwBrowser> | undefined

  private static disposeRegistered = false

  static get(): BrowserRuntime {
    if (!BrowserRuntime.instance) {
      BrowserRuntime.instance = new BrowserRuntime()
    }
    if (!BrowserRuntime.disposeRegistered) {
      BrowserRuntime.disposeRegistered = true
      const cleanup = () => {
        if (BrowserRuntime.instance) {
          BrowserRuntime.instance.close().catch(() => {})
        }
      }
      // NOTE: "exit" handler removed — async close() cannot complete
      // during the synchronous exit event. SIGINT/SIGTERM work because
      // the process does not exit immediately on those signals.
      process.once("SIGINT", cleanup)
      process.once("SIGTERM", cleanup)
    }
    return BrowserRuntime.instance
  }

  /** Reset singleton (test-only). */
  static _reset(): void {
    BrowserRuntime.instance = undefined
  }

  // ---- helpers ----

  private ensurePlaywright(): PlaywrightModule {
    const pw = loadPlaywright()
    if (!pw) {
      throw new Error(`Browser Agent runtime is not available. ${INSTALL_HINT}`)
    }
    return pw
  }

  private resolvePage(pageID: string): PageEntry {
    const id = pageID === "latest" ? this.latestPageID : pageID
    if (!id) {
      throw new Error("No browser page is open. Use browser_open first.")
    }
    const entry = this.pages.get(id)
    if (!entry) {
      throw new Error(`Browser page "${id}" not found. It may have been closed.`)
    }
    return entry
  }

  private pushConsole(pageID: string, msg: BrowserConsoleMessage): void {
    let buf = this.consoleBuffers.get(pageID)
    if (!buf) {
      buf = []
      this.consoleBuffers.set(pageID, buf)
    }
    buf.push(msg)
    if (buf.length > BUFFER_CAP) buf.shift()
  }

  private pushNetwork(pageID: string, req: BrowserNetworkRequest): void {
    let buf = this.networkBuffers.get(pageID)
    if (!buf) {
      buf = []
      this.networkBuffers.set(pageID, buf)
    }
    buf.push(req)
    if (buf.length > BUFFER_CAP) buf.shift()
  }

  // ---- public API ----

  async open(url: string, viewport: { width: number; height: number }): Promise<BrowserPage> {
    const pw = this.ensurePlaywright()

    if (!this.browser) {
      if (!this.launchPromise) {
        this.launchPromise = pw.chromium.launch({ headless: true })
      }
      try {
        this.browser = await this.launchPromise
      } catch (err) {
        this.launchPromise = undefined // Allow retry on next open()
        throw err
      }
      log.info("browser launched")
    }

    const context = await this.browser.newContext({
      viewport: { width: viewport.width, height: viewport.height },
    })
    const pwPage = await context.newPage()

    this.pageCounter++
    const pageID = `page_${this.pageCounter}`

    // Wire console listener
    pwPage.on("console", (msg) => {
      this.pushConsole(pageID, {
        type: msg.type(),
        text: msg.text(),
        timestamp: Date.now(),
      })
    })

    // Wire network listener
    pwPage.on("response", (response) => {
      const request = response.request()
      this.pushNetwork(pageID, {
        url: request.url(),
        method: request.method(),
        status: response.status(),
        resourceType: request.resourceType(),
        timestamp: Date.now(),
      })
    })

    await pwPage.goto(url, { waitUntil: "domcontentloaded" })
    const title = await pwPage.title()

    const entry: PageEntry = {
      pageID,
      pwPage,
      context,
      url,
      title,
      viewport,
    }
    this.pages.set(pageID, entry)
    this.latestPageID = pageID

    log.info("page opened", { pageID, url, viewport })

    return { pageID, url, title, viewport }
  }

  async snapshot(pageID: string, verbose: boolean): Promise<BrowserSnapshot> {
    const entry = this.resolvePage(pageID)

    // Clear stale UIDs for this page before re-populating
    for (const [uid, ref] of this.uidRegistry) {
      if (ref.pageID === entry.pageID) this.uidRegistry.delete(uid)
    }

    // Inject UID assignment script and get element data
    const elements = (await entry.pwPage.evaluate(SNAPSHOT_SCRIPT)) as {
      uid: string
      role: string
      name: string
      value?: string
      depth: number
    }[]

    // Register UIDs
    for (const el of elements) {
      this.uidRegistry.set(el.uid, { pageID: entry.pageID, uid: el.uid })
    }

    // Build text representation
    const lines: string[] = []
    for (const el of elements) {
      const indent = "  ".repeat(el.depth)
      const parts = [`${indent}- ${el.role}`]
      if (el.name) parts.push(`"${el.name}"`)
      if (el.value !== undefined && el.value !== "") parts.push(`value: "${el.value}"`)
      parts.push(`[${el.uid}]`)
      lines.push(parts.join(" "))
    }

    const text = lines.length > 0 ? lines.join("\n") : "(empty page — no interactive elements found)"

    return {
      pageID: entry.pageID,
      elements: elements.map(({ uid, role, name, value }) => ({ uid, role, name, value })),
      text,
    }
  }

  async action(pageID: string, actionType: string, params: Record<string, unknown>): Promise<string> {
    const entry = this.resolvePage(pageID)
    const pwPage = entry.pwPage

    const uid = params.uid as string | undefined
    const resolveLocator = () => {
      if (!uid) throw new Error(`Action "${actionType}" requires a uid parameter.`)
      return pwPage.locator(`[data-uid="${escapeUid(uid)}"]`)
    }

    switch (actionType) {
      case "click": {
        const loc = resolveLocator()
        if (params.dblClick) {
          await loc.dblclick()
        } else {
          await loc.click()
        }
        return `Clicked element ${uid}`
      }
      case "fill": {
        const loc = resolveLocator()
        await loc.fill(String(params.value ?? ""))
        return `Filled element ${uid} with "${params.value}"`
      }
      case "press": {
        const key = params.key as string
        if (!key) throw new Error('Action "press" requires a key parameter.')
        if (uid) {
          const loc = resolveLocator()
          await loc.press(key)
        } else {
          await pwPage.keyboard.press(key)
        }
        return `Pressed ${key}`
      }
      case "hover": {
        const loc = resolveLocator()
        await loc.hover()
        return `Hovered over element ${uid}`
      }
      case "scroll": {
        const direction = (params.direction as string) || "down"
        const amount = (params.amount as number) || 300
        const deltaY = direction === "up" ? -amount : direction === "down" ? amount : 0
        const deltaX = direction === "left" ? -amount : direction === "right" ? amount : 0
        if (uid) {
          const loc = resolveLocator()
          await loc.evaluate((el, delta) => el.scrollBy(delta.x, delta.y), { x: deltaX, y: deltaY })
        } else {
          await pwPage.evaluate((delta) => window.scrollBy(delta.x, delta.y), { x: deltaX, y: deltaY })
        }
        return `Scrolled ${direction} by ${amount}px`
      }
      case "select": {
        const loc = resolveLocator()
        await loc.selectOption(String(params.value ?? ""))
        return `Selected "${params.value}" in element ${uid}`
      }
      case "navigate": {
        const navType = params.type as string | undefined
        if (navType === "back") {
          await pwPage.goBack()
          for (const [uid, ref] of this.uidRegistry) {
            if (ref.pageID === entry.pageID) this.uidRegistry.delete(uid)
          }
          return "Navigated back"
        }
        if (navType === "forward") {
          await pwPage.goForward()
          for (const [uid, ref] of this.uidRegistry) {
            if (ref.pageID === entry.pageID) this.uidRegistry.delete(uid)
          }
          return "Navigated forward"
        }
        if (navType === "reload") {
          await pwPage.reload()
          for (const [uid, ref] of this.uidRegistry) {
            if (ref.pageID === entry.pageID) this.uidRegistry.delete(uid)
          }
          return "Page reloaded"
        }
        const navUrl = params.url as string
        if (!navUrl) throw new Error('Action "navigate" requires a url or type parameter.')
        await pwPage.goto(navUrl, { waitUntil: "domcontentloaded" })
        entry.url = navUrl
        entry.title = await pwPage.title()
        for (const [uid, ref] of this.uidRegistry) {
          if (ref.pageID === entry.pageID) this.uidRegistry.delete(uid)
        }
        return `Navigated to ${navUrl}`
      }
      case "waitFor": {
        const text = params.text as string | undefined
        const timeout = (params.timeout as number) || 30_000
        if (text) {
          await pwPage.waitForSelector(`text=${text}`, { timeout })
          return `Waited for text "${text}"`
        }
        await pwPage.waitForLoadState("networkidle", { timeout })
        return "Waited for network idle"
      }
      case "drag": {
        const fromUid = params.fromUid as string | undefined
        const toUid = params.toUid as string | undefined
        if (!fromUid || !toUid) {
          throw new Error('Action "drag" requires fromUid and toUid parameters.')
        }
        const from = pwPage.locator(`[data-uid="${escapeUid(fromUid)}"]`)
        const to = pwPage.locator(`[data-uid="${escapeUid(toUid)}"]`)
        await from.dragTo(to)
        return `Dragged ${fromUid} to ${toUid}`
      }
      case "uploadFile": {
        const loc = resolveLocator()
        const filePaths = params.filePaths as string[] | undefined
        if (!filePaths || filePaths.length === 0) {
          throw new Error('Action "uploadFile" requires filePaths parameter.')
        }
        await loc.setInputFiles(filePaths)
        return `Uploaded ${filePaths.length} file(s) to element ${uid}`
      }
      default:
        throw new Error(`Unknown browser action: "${actionType}"`)
    }
  }

  async screenshot(
    pageID: string,
    options: { fullPage?: boolean; format?: "png" | "jpeg"; quality?: number; uid?: string },
  ): Promise<BrowserScreenshot> {
    const entry = this.resolvePage(pageID)

    let buffer: Buffer
    if (options.uid) {
      const loc = entry.pwPage.locator(`[data-uid="${escapeUid(options.uid)}"]`)
      // Fast-fail: avoid 30s timeout for stale UIDs
      const count = await loc.count()
      if (count === 0) {
        throw new Error(
          `Element with uid "${options.uid}" not found on page. Take a new browser_snapshot to get current element UIDs.`,
        )
      }
      const box = await loc.boundingBox()
      buffer = await loc.screenshot({
        type: options.format === "jpeg" ? "jpeg" : "png",
        quality: options.format === "jpeg" ? (options.quality ?? 80) : undefined,
      })
      const dims = box ?? { width: entry.viewport.width, height: entry.viewport.height }
      return {
        pageID: entry.pageID,
        data: buffer,
        format: options.format === "jpeg" ? "jpeg" : "png",
        width: dims.width,
        height: dims.height,
      }
    } else {
      buffer = await entry.pwPage.screenshot({
        fullPage: options.fullPage ?? false,
        type: options.format === "jpeg" ? "jpeg" : "png",
        quality: options.format === "jpeg" ? (options.quality ?? 80) : undefined,
      })
    }

    const vp = entry.pwPage.viewportSize() ?? { width: entry.viewport.width, height: entry.viewport.height }

    return {
      pageID: entry.pageID,
      data: buffer,
      format: options.format === "jpeg" ? "jpeg" : "png",
      width: vp.width,
      height: vp.height,
    }
  }

  async console(
    pageID: string,
    options: { types?: string[]; pageIdx?: number; pageSize?: number },
  ): Promise<BrowserConsoleMessage[]> {
    const entry = this.resolvePage(pageID)
    let messages = this.consoleBuffers.get(entry.pageID) ?? []

    if (options.types && options.types.length > 0) {
      const typeSet = new Set(options.types)
      messages = messages.filter((m) => typeSet.has(m.type))
    }

    const pageIdx = options.pageIdx ?? 0
    const pageSize = options.pageSize ?? 50
    const start = pageIdx * pageSize
    return messages.slice(start, start + pageSize)
  }

  async network(
    pageID: string,
    options: { resourceTypes?: string[]; pageIdx?: number; pageSize?: number },
  ): Promise<BrowserNetworkRequest[]> {
    const entry = this.resolvePage(pageID)
    let requests = this.networkBuffers.get(entry.pageID) ?? []

    if (options.resourceTypes && options.resourceTypes.length > 0) {
      const typeSet = new Set(options.resourceTypes)
      requests = requests.filter((r) => typeSet.has(r.resourceType))
    }

    const pageIdx = options.pageIdx ?? 0
    const pageSize = options.pageSize ?? 50
    const start = pageIdx * pageSize
    return requests.slice(start, start + pageSize)
  }

  async evaluate(pageID: string, fn: string, args?: { uid: string }[]): Promise<unknown> {
    const entry = this.resolvePage(pageID)

    if (args && args.length > 0) {
      // Resolve UIDs to element handles
      const locators = args.map((a) => entry.pwPage.locator(`[data-uid="${escapeUid(a.uid)}"]`))
      // Parse function for element evaluation — Playwright serializes to browser context
      // eslint-disable-next-line @typescript-eslint/no-implied-eval
      const parsedFn = new Function(`return (${fn})`)()
      if (locators.length === 1) {
        return locators[0]!.evaluate(parsedFn as (el: Element) => unknown)
      }
      // Multiple args: evaluate on page, passing element handles
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return entry.pwPage.evaluate(
        (([f, ...els]: any[]) => (f as (...args: unknown[]) => unknown)(...els)) as () => unknown,
        [parsedFn, ...locators] as any,
      )
    }

    // No-args: pass string directly to page.evaluate (runs in browser sandbox, not Node.js)
    return entry.pwPage.evaluate(fn)
  }

  async close(): Promise<void> {
    for (const entry of this.pages.values()) {
      try {
        await entry.context.close()
      } catch {
        // Context may already be closed
      }
    }
    this.pages.clear()
    this.consoleBuffers.clear()
    this.networkBuffers.clear()
    this.uidRegistry.clear()
    this.latestPageID = undefined
    this.pageCounter = 0

    if (this.browser) {
      try {
        await this.browser.close()
      } catch {
        // Browser may already be closed
      }
      this.browser = undefined
      this.launchPromise = undefined
      log.info("browser closed")
    }
  }

  /**
   * Close a single page and its browser context, releasing resources.
   * Safe to call with an unknown pageID (no-op).
   */
  async closePage(pageID: string): Promise<void> {
    const entry = this.pages.get(pageID)
    if (!entry) return

    // Clear UIDs belonging to this page
    for (const [uid, ref] of this.uidRegistry) {
      if (ref.pageID === entry.pageID) this.uidRegistry.delete(uid)
    }

    this.pages.delete(entry.pageID)
    this.consoleBuffers.delete(entry.pageID)
    this.networkBuffers.delete(entry.pageID)

    try {
      await entry.context.close()
    } catch {
      // Context may already be closed
    }

    // Update latestPageID if needed
    if (this.latestPageID === entry.pageID) {
      const remaining = [...this.pages.keys()]
      this.latestPageID = remaining.length > 0 ? remaining[remaining.length - 1]! : undefined
    }

    log.info("page closed", { pageID: entry.pageID })
  }
}
