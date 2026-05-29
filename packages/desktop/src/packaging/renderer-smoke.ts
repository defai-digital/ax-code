import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
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
    tabCount: number
    tabPanel: boolean
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
    assertRendererSmokeResult(result)
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

function assertRendererSmokeResult(result: RendererSmokeResult) {
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
    if (missingTexts.length > 0)
      throw new Error(`Renderer missing text at ${viewport.width}x${viewport.height}: ${missingTexts.join(", ")}`)
    if (missingActions.length > 0)
      throw new Error(`Renderer missing actions at ${viewport.width}x${viewport.height}: ${missingActions.join(", ")}`)
    if (!viewport.checks.ariaLive || viewport.checks.tabCount < 3 || !viewport.checks.tabPanel) {
      throw new Error(`Renderer accessibility landmarks missing at ${viewport.width}x${viewport.height}`)
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
  const requiredText = Object.fromEntries(
    ["Task queue", "Approvals", "Review", "Diagnostics", "Worktrees", "Automations"].map((label) => [
      label,
      text.includes(label),
    ]),
  )
  const actionButtons = Object.fromEntries(
    ["Run", "Queue", "Abort", "Send now", "Pause"].map((label) => [label, buttonTexts.includes(label)]),
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
    tabCount: document.querySelectorAll("[role='tab']").length,
    tabPanel: Boolean(document.querySelector("[role='tabpanel']")),
    requiredText,
    actionButtons,
    documentWidth: document.documentElement.scrollWidth,
    viewportWidth: window.innerWidth,
    overflowElements,
  }
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
  const pathname = decodeURIComponent(url.pathname)
  const relative = pathname === "/" ? "index.html" : pathname.slice(1)
  const resolved = path.resolve(appDist, relative)
  const root = appDist + path.sep
  if (resolved !== appDist && !resolved.startsWith(root)) return undefined
  return resolved
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
    },
    strict: true,
    allowPositionals: false,
  })
  const result = await runRendererSmoke({
    appDist: values["app-dist"],
    timeoutMs: values["timeout-ms"] ? Number(values["timeout-ms"]) : undefined,
  })
  console.log(JSON.stringify(result, null, 2))
}
