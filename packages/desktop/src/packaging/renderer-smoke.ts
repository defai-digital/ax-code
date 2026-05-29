import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { createRequire } from "node:module"
import path from "node:path"
import { parseArgs } from "node:util"

export type RendererSmokeViewport = {
  width: number
  height: number
}

export type RendererSmokeViewportResult = RendererSmokeViewport & {
  checks: {
    nonblankText: number
    appShell: boolean
    queueItems: number
    sessionButtons: number
    ariaLive: boolean
    reconnectBanner: boolean
    tabCount: number
    tabPanel: boolean
    focusVisibleRule: boolean
    keyboardFlow: {
      visitedCount: number
      uniqueFocusCount: number
      firstLabel: string
      requiredLabels: Record<string, boolean>
      visitedLabels: string[]
    }
    accessibilityIssues: string[]
    requiredText: Record<string, boolean>
    actionButtons: Record<string, boolean>
    documentWidth: number
    viewportWidth: number
    overflowElements: Array<{
      tag: string
      className: string
      label: string
      width: number
      right: number
      scrollWidth: number
      clientWidth: number
    }>
  }
}

export type RendererSmokeResult = {
  appDist: string
  rendererUrl: "app://ax-code/index.html"
  viewports: RendererSmokeViewportResult[]
  checks: {
    electronBrowser: true
    nonblank: true
    commandCenter: true
    actions: true
    accessibility: true
    desktopViewports: true
  }
}

const DEFAULT_VIEWPORTS: RendererSmokeViewport[] = [
  { width: 1280, height: 800 },
  { width: 1440, height: 900 },
]

export async function runRendererSmoke(
  input: {
    appDist?: string
    viewports?: RendererSmokeViewport[]
    timeoutMs?: number
  } = {},
): Promise<RendererSmokeResult> {
  const root = path.resolve(import.meta.dirname, "../..")
  const appDist = input.appDist ?? path.join(root, "dist/app")
  if (!existsSync(path.join(appDist, "index.html"))) {
    throw new Error(`Renderer dist is missing: ${path.join(appDist, "index.html")}`)
  }

  const electronBinary = resolveElectronBinary()
  const tempDir = mkdtempSync(path.join(tmpdir(), "ax-code-renderer-smoke-"))
  const mainPath = path.join(tempDir, "electron-renderer-smoke.cjs")
  writeFileSync(mainPath, ELECTRON_RENDERER_SMOKE_MAIN)

  try {
    const child = Bun.spawn(
      [
        electronBinary,
        mainPath,
        JSON.stringify({
          appDist,
          viewports: input.viewports ?? DEFAULT_VIEWPORTS,
        }),
      ],
      {
        stdout: "pipe",
        stderr: "pipe",
        env: {
          ...process.env,
          ELECTRON_ENABLE_LOGGING: "1",
        },
      },
    )
    const stdoutPromise = child.stdout ? new Response(child.stdout).text() : Promise.resolve("")
    const stderrPromise = child.stderr ? new Response(child.stderr).text() : Promise.resolve("")
    const code = await waitForExit(child, input.timeoutMs ?? 15_000)
    const [stdout, stderr] = await Promise.all([stdoutPromise, stderrPromise])
    if (code !== 0) {
      throw new Error(`Electron renderer smoke failed with exit code ${code}\n${stderr || stdout}`)
    }
    const result = parseSmokeResult(stdout)
    try {
      assertRendererSmokeResult(result)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      throw new Error(`${message}\n${JSON.stringify(result, null, 2)}`)
    }
    return result
  } finally {
    rmSync(tempDir, { recursive: true, force: true })
  }
}

function resolveElectronBinary() {
  const require = createRequire(import.meta.url)
  const electron = require("electron") as unknown
  if (typeof electron !== "string") throw new Error("Electron executable path is invalid")
  return electron
}

type SmokeChildProcess = {
  exited: Promise<number>
  kill(signal?: NodeJS.Signals): void
}

async function waitForExit(child: SmokeChildProcess, timeoutMs: number) {
  let timeout: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      child.exited,
      new Promise<number>((resolve) => {
        timeout = setTimeout(() => {
          child.kill("SIGTERM")
          resolve(124)
        }, timeoutMs)
      }),
    ])
  } finally {
    if (timeout) clearTimeout(timeout)
  }
}

function parseSmokeResult(stdout: string): RendererSmokeResult {
  const markerLine = stdout
    .split("\n")
    .map((line) => line.trim())
    .find((line) => line.startsWith("AX_CODE_RENDERER_SMOKE_RESULT="))
  if (!markerLine) throw new Error(`Renderer smoke did not print a result marker\n${stdout}`)
  return JSON.parse(markerLine.slice("AX_CODE_RENDERER_SMOKE_RESULT=".length)) as RendererSmokeResult
}

export function assertRendererSmokeResult(result: RendererSmokeResult) {
  if (result.rendererUrl !== "app://ax-code/index.html") throw new Error("Renderer smoke did not use app protocol")
  if (result.viewports.length === 0) throw new Error("Renderer smoke did not test any viewports")
  for (const viewport of result.viewports) {
    const missingTexts = Object.entries(viewport.checks.requiredText)
      .filter(([, present]) => !present)
      .map(([label]) => label)
    const missingActions = Object.entries(viewport.checks.actionButtons)
      .filter(([, present]) => !present)
      .map(([label]) => label)
    if (viewport.checks.nonblankText < 100)
      throw new Error(`Renderer was blank at ${viewport.width}x${viewport.height}`)
    if (!viewport.checks.appShell) throw new Error(`Renderer app shell missing at ${viewport.width}x${viewport.height}`)
    if (viewport.checks.queueItems < 1) throw new Error(`Queue items missing at ${viewport.width}x${viewport.height}`)
    if (viewport.checks.sessionButtons < 1)
      throw new Error(`Session buttons missing at ${viewport.width}x${viewport.height}`)
    if (!viewport.checks.reconnectBanner)
      throw new Error(`Reconnect/event stream banner missing at ${viewport.width}x${viewport.height}`)
    if (missingTexts.length > 0)
      throw new Error(`Renderer missing text at ${viewport.width}x${viewport.height}: ${missingTexts.join(", ")}`)
    if (missingActions.length > 0)
      throw new Error(`Renderer missing actions at ${viewport.width}x${viewport.height}: ${missingActions.join(", ")}`)
    if (!viewport.checks.ariaLive || viewport.checks.tabCount < 3 || !viewport.checks.tabPanel) {
      throw new Error(`Renderer accessibility landmarks missing at ${viewport.width}x${viewport.height}`)
    }
    const missingKeyboardLabels = Object.entries(viewport.checks.keyboardFlow.requiredLabels)
      .filter(([, present]) => !present)
      .map(([label]) => label)
    if (
      viewport.checks.keyboardFlow.firstLabel !== "Skip to work surface" ||
      viewport.checks.keyboardFlow.uniqueFocusCount < 12 ||
      missingKeyboardLabels.length > 0
    ) {
      throw new Error(
        `Renderer keyboard flow failed at ${viewport.width}x${viewport.height}: first=${viewport.checks.keyboardFlow.firstLabel}; missing=${missingKeyboardLabels.join(", ")}; visited=${viewport.checks.keyboardFlow.visitedLabels.join(" > ")}`,
      )
    }
    if (viewport.checks.accessibilityIssues.length > 0) {
      throw new Error(
        `Renderer accessibility issues at ${viewport.width}x${viewport.height}: ${viewport.checks.accessibilityIssues.join("; ")}`,
      )
    }
    if (viewport.checks.overflowElements.length > 0) {
      const overflow = viewport.checks.overflowElements
        .map(
          (element) =>
            `${element.tag}.${element.className || "-"} width=${element.width} right=${element.right} client=${element.clientWidth} scroll=${element.scrollWidth} ${element.label}`,
        )
        .join("; ")
      throw new Error(
        `Renderer has clipped or overflowing content at ${viewport.width}x${viewport.height}: ${overflow}`,
      )
    }
    if (viewport.checks.documentWidth > viewport.checks.viewportWidth + 24) {
      const overflow = viewport.checks.overflowElements
        .map(
          (element) =>
            `${element.tag}.${element.className || "-"} width=${element.width} right=${element.right} client=${element.clientWidth} scroll=${element.scrollWidth} ${element.label}`,
        )
        .join("; ")
      throw new Error(
        `Renderer overflows viewport ${viewport.width}x${viewport.height}: ${viewport.checks.documentWidth}px${
          overflow ? ` (${overflow})` : ""
        }`,
      )
    }
  }
}

const RENDERER_BROWSER_CHECK_SCRIPT = String.raw`
(() => {
  const text = document.body.textContent || ""
  const buttonTexts = Array.from(document.querySelectorAll("button")).map((button) => button.textContent.trim())
  const accessibilityIssues = []
  const elementLabel = (element) => {
    const ariaLabel = element.getAttribute("aria-label")
    if (ariaLabel && ariaLabel.trim()) return ariaLabel.trim()
    const labelledBy = element.getAttribute("aria-labelledby")
    if (labelledBy) {
      const label = labelledBy
        .split(/\s+/)
        .map((id) => document.getElementById(id)?.textContent || "")
        .join(" ")
        .trim()
      if (label) return label
    }
    const id = element.getAttribute("id")
    if (id) {
      const label = document.querySelector('label[for="' + CSS.escape(id) + '"]')
      if (label?.textContent?.trim()) return label.textContent.trim()
    }
    const wrappingLabel = element.closest("label")
    if (wrappingLabel?.textContent?.trim()) return wrappingLabel.textContent.trim()
    const title = element.getAttribute("title")
    if (title && title.trim()) return title.trim()
    return (element.textContent || "").trim()
  }
  const visibleRect = (element) => {
    const rect = element.getBoundingClientRect()
    if (rect.width <= 0 || rect.height <= 0) return undefined
    if (window.getComputedStyle(element).visibility === "hidden") return undefined
    return rect
  }
  const focusVisibleRule = Array.from(document.styleSheets).some((sheet) => {
    try {
      return Array.from(sheet.cssRules).some((rule) => {
        const text = rule.cssText || ""
        return text.includes(":focus-visible") && text.includes("outline")
      })
    } catch {
      return false
    }
  })
  if (!focusVisibleRule) accessibilityIssues.push("focus-visible outline rule is missing")

  for (const control of document.querySelectorAll("button, [role='button'], [role='tab']")) {
    const rect = visibleRect(control)
    if (!rect) continue
    const label = elementLabel(control)
    if (!label) accessibilityIssues.push(control.tagName.toLowerCase() + " is missing an accessible name")
    if (rect.width < 24 || rect.height < 24)
      accessibilityIssues.push((label || control.tagName.toLowerCase()) + " target is smaller than 24px")
  }

  for (const field of document.querySelectorAll("input, select, textarea")) {
    const rect = visibleRect(field)
    if (!rect) continue
    const label = elementLabel(field)
    if (!label) accessibilityIssues.push(field.tagName.toLowerCase() + " field is missing an accessible name")
    if (rect.width < 24 || rect.height < 24)
      accessibilityIssues.push((label || field.tagName.toLowerCase()) + " field target is smaller than 24px")
  }

  for (const tabList of document.querySelectorAll("[role='tablist']")) {
    const tabs = Array.from(tabList.querySelectorAll("[role='tab']"))
    if (tabs.length === 0) accessibilityIssues.push("tablist has no tabs")
    const directInteractive = Array.from(tabList.querySelectorAll("button, [role='tab']"))
    for (const child of directInteractive) {
      if (child.getAttribute("role") !== "tab") accessibilityIssues.push("tablist control is missing role=tab")
    }
  }

  for (const tab of document.querySelectorAll("[role='tab']")) {
    const label = elementLabel(tab) || "tab"
    if (!tab.closest("[role='tablist']")) accessibilityIssues.push(label + " tab is outside a tablist")
    if (!tab.hasAttribute("aria-selected")) accessibilityIssues.push(label + " tab is missing aria-selected")
    if (!tab.getAttribute("id")) accessibilityIssues.push(label + " tab is missing an id")
    const controls = tab.getAttribute("aria-controls")
    if (controls && !document.getElementById(controls)) accessibilityIssues.push(label + " tab controls a missing panel")
  }

  for (const panel of document.querySelectorAll("[role='tabpanel']")) {
    const labelledBy = panel.getAttribute("aria-labelledby")
    if (!labelledBy || !document.getElementById(labelledBy)) accessibilityIssues.push("tabpanel is missing aria-labelledby")
  }

  const requiredText = Object.fromEntries(
    [
      "Task queue",
      "Event stream",
      "Approvals",
      "Review",
      "Diagnostics",
      "Worktrees",
      "Automations",
      "Project defaults",
      "Backend reload required",
      "Runtime probes",
      "Code index",
      "Branch rank",
    ].map((label) => [label, text.includes(label)]),
  )
  const actionButtons = Object.fromEntries(
    [
      "Run",
      "Queue",
      "Abort",
      "Send now",
      "Pause",
      "Edit",
      "Remove",
      "Always",
      "Submit answer",
      "Open update",
      "Refresh probes",
    ].map((label) => [label, buttonTexts.includes(label)]),
  )
  const overflowElements = Array.from(document.querySelectorAll("body *"))
    .map((element) => {
      const rect = element.getBoundingClientRect()
      const className = typeof element.className === "string" ? element.className : ""
      const label =
        element.getAttribute("aria-label") ||
        element.getAttribute("data-testid") ||
        (element.textContent || "").trim().replace(/\s+/g, " ").slice(0, 80)
      return {
        tag: element.tagName.toLowerCase(),
        className,
        label,
        width: Math.round(rect.width),
        right: Math.round(rect.right),
        clientWidth: element.clientWidth,
        scrollWidth: element.scrollWidth,
      }
    })
    .filter(
      (element) =>
        element.right > window.innerWidth ||
        element.scrollWidth > window.innerWidth ||
        element.scrollWidth > element.clientWidth + 24,
    )
    .sort(
      (a, b) =>
        Math.max(b.right - window.innerWidth, b.scrollWidth - b.clientWidth, b.scrollWidth - window.innerWidth) -
        Math.max(a.right - window.innerWidth, a.scrollWidth - a.clientWidth, a.scrollWidth - window.innerWidth),
    )
    .slice(0, 6)
  return {
    nonblankText: text.trim().length,
    appShell: Boolean(document.querySelector("[data-testid='ax-code-app']")),
    queueItems: document.querySelectorAll(".queue-item").length,
    sessionButtons: document.querySelectorAll(".session-button").length,
    ariaLive: Boolean(document.querySelector("[role='status'][aria-live='polite']")),
    reconnectBanner: Boolean(document.querySelector(".reconnect-banner[aria-label='Event stream status']")),
    tabCount: document.querySelectorAll("[role='tab']").length,
    tabPanel: Boolean(document.querySelector("[role='tabpanel']")),
    focusVisibleRule,
    accessibilityIssues,
    requiredText,
    actionButtons,
    documentWidth: document.documentElement.scrollWidth,
    viewportWidth: window.innerWidth,
    overflowElements,
  }
})()
`

const KEYBOARD_ACTIVE_ELEMENT_SCRIPT = String.raw`
(() => {
  const element = document.activeElement
  if (!element || element === document.body) return ""
  const labelFromElement = (target) => {
    const ariaLabel = target.getAttribute("aria-label")
    if (ariaLabel && ariaLabel.trim()) return ariaLabel.trim()
    const labelledBy = target.getAttribute("aria-labelledby")
    if (labelledBy) {
      const label = labelledBy
        .split(/\s+/)
        .map((id) => document.getElementById(id)?.textContent || "")
        .join(" ")
        .trim()
      if (label) return label
    }
    const id = target.getAttribute("id")
    if (id) {
      const label = document.querySelector('label[for="' + CSS.escape(id) + '"]')
      if (label?.textContent?.trim()) return label.textContent.trim()
    }
    const title = target.getAttribute("title")
    if (title && title.trim()) return title.trim()
    return (target.textContent || target.getAttribute("value") || target.getAttribute("placeholder") || target.tagName)
      .trim()
      .replace(/\s+/g, " ")
  }
  return labelFromElement(element)
})()
`

const ELECTRON_RENDERER_SMOKE_MAIN = String.raw`
const fs = require("node:fs/promises")
const path = require("node:path")
const { app, BrowserWindow, protocol } = require("electron")

const input = JSON.parse(process.argv[2] || "{}")
const appDist = path.resolve(input.appDist)
const viewports = Array.isArray(input.viewports) ? input.viewports : []
const rendererBrowserCheckScript = ${JSON.stringify(RENDERER_BROWSER_CHECK_SCRIPT)}
const keyboardActiveElementScript = ${JSON.stringify(KEYBOARD_ACTIVE_ELEMENT_SCRIPT)}

protocol.registerSchemesAsPrivileged([
  {
    scheme: "app",
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
    },
  },
])

function rendererFile(requestUrl) {
  const url = new URL(requestUrl)
  if (url.hostname !== "ax-code") return undefined
  const pathname = safeDecodePathname(url.pathname)
  if (!pathname) return undefined
  const relative = pathname === "/" ? "index.html" : pathname.slice(1)
  const resolved = path.resolve(appDist, relative)
  const root = appDist + path.sep
  if (resolved !== appDist && !resolved.startsWith(root)) return undefined
  return resolved
}

function safeDecodePathname(pathname) {
  try {
    return decodeURIComponent(pathname)
  } catch {
    return undefined
  }
}

function contentType(filePath) {
  const ext = path.extname(filePath)
  if (ext === ".html") return "text/html; charset=utf-8"
  if (ext === ".js") return "text/javascript; charset=utf-8"
  if (ext === ".css") return "text/css; charset=utf-8"
  if (ext === ".json") return "application/json; charset=utf-8"
  if (ext === ".svg") return "image/svg+xml"
  if (ext === ".png") return "image/png"
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg"
  return "application/octet-stream"
}

async function main() {
  await app.whenReady()
  protocol.handle("app", async (request) => {
    const filePath = rendererFile(request.url)
    if (!filePath) return new Response("Not found", { status: 404 })
    try {
      return new Response(await fs.readFile(filePath), {
        headers: { "content-type": contentType(filePath) },
      })
    } catch {
      return new Response("Not found", { status: 404 })
    }
  })

  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    show: false,
    backgroundColor: "#f6f7f4",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
    },
  })
  await win.loadURL("app://ax-code/index.html")

  const results = []
  for (const viewport of viewports) {
    win.setSize(viewport.width, viewport.height)
    await new Promise((resolve) => setTimeout(resolve, 80))
    const checks = await win.webContents.executeJavaScript(rendererBrowserCheckScript)
    checks.keyboardFlow = await runKeyboardFlow(win)
    results.push({ width: viewport.width, height: viewport.height, checks })
  }

  console.log("AX_CODE_RENDERER_SMOKE_RESULT=" + JSON.stringify({
    appDist,
    rendererUrl: "app://ax-code/index.html",
    viewports: results,
    checks: {
      electronBrowser: true,
      nonblank: true,
      commandCenter: true,
      actions: true,
      accessibility: true,
      desktopViewports: true,
    },
  }))
  app.quit()
}

async function runKeyboardFlow(win) {
  await win.webContents.executeJavaScript('document.querySelector(".skip-link")?.focus()')
  const visitedLabels = []
  for (let index = 0; index < 120; index++) {
    const label = await win.webContents.executeJavaScript(keyboardActiveElementScript)
    if (label) visitedLabels.push(label)
    win.webContents.sendInputEvent({ type: "keyDown", keyCode: "Tab" })
    win.webContents.sendInputEvent({ type: "keyUp", keyCode: "Tab" })
    await new Promise((resolve) => setTimeout(resolve, 8))
  }
  const unique = Array.from(new Set(visitedLabels))
  const required = [
    "Skip to work surface",
    "ax-code",
    "Send now",
    "Pause",
    "Terminal",
    "Browser",
    "File",
    "Run",
    "Queue",
    "Project default model",
  ]
  return {
    visitedCount: visitedLabels.length,
    uniqueFocusCount: unique.length,
    firstLabel: visitedLabels[0] || "",
    requiredLabels: Object.fromEntries(required.map((label) => [label, visitedLabels.some((visited) => visited.includes(label))])),
    visitedLabels: unique.slice(0, 32),
  }
}

main().catch((error) => {
  console.error(error && error.stack ? error.stack : error)
  app.exit(1)
})
`

if (import.meta.main) {
  const { values } = parseArgs({
    args: process.argv.slice(2),
    options: {
      "app-dist": { type: "string" },
      "timeout-ms": { type: "string" },
      output: { type: "string" },
    },
    strict: true,
    allowPositionals: false,
  })
  const result = await runRendererSmoke({
    appDist: values["app-dist"],
    timeoutMs: values["timeout-ms"] ? Number(values["timeout-ms"]) : undefined,
  })
  const json = JSON.stringify(result, null, 2)
  if (values.output) {
    mkdirSync(path.dirname(values.output), { recursive: true })
    writeFileSync(values.output, `${json}\n`)
  }
  console.log(json)
}
