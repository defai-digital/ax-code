import { spawn } from "child_process"
import fs from "fs"
import path from "path"
import open from "open"

export const DEFAULT_WEBUI_PORT = 3100

type DesktopInvocation = {
  command: string
  args: string[]
  displayName: string
}

export type WebUiLaunchOptions = {
  port?: number
  uiPassword?: string
  openBrowser?: boolean
  cwd?: string
}

export type WebUiLaunchResult = {
  started: boolean
  port: number
  url: string
  opened: boolean
  message: string
}

type DesktopStatusInstance = {
  runtime?: string
  port?: number
}

type DesktopStatus = {
  state?: string
  instances?: DesktopStatusInstance[]
}

type DesktopServeResult = {
  port?: number
  url?: string
}

function findDesktopCliFromCheckout(startDir: string) {
  let current = path.resolve(startDir)
  while (true) {
    const candidate = path.join(current, "desktop", "packages", "web", "bin", "cli.js")
    if (fs.existsSync(candidate)) return candidate

    const parent = path.dirname(current)
    if (parent === current) return undefined
    current = parent
  }
}

function resolveDesktopInvocation(cwd: string): DesktopInvocation {
  const configured = process.env.AX_CODE_DESKTOP_BINARY?.trim()
  if (configured) {
    return { command: configured, args: [], displayName: configured }
  }

  const checkoutCli = findDesktopCliFromCheckout(cwd)
  if (checkoutCli) {
    return { command: process.execPath, args: [checkoutCli], displayName: "local ax-code-desktop" }
  }

  return { command: "ax-code-desktop", args: [], displayName: "ax-code-desktop" }
}

function desktopCommandError(invocation: DesktopInvocation, error: unknown) {
  if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
    return new Error(
      `Could not find ${invocation.displayName}. Install AX Code Desktop, install the ax-code-desktop web runtime, or set AX_CODE_DESKTOP_BINARY to its executable path.`,
    )
  }
  return error instanceof Error ? error : new Error(String(error))
}

async function runDesktopJson<T>(invocation: DesktopInvocation, args: string[], cwd: string): Promise<T> {
  const result = await new Promise<{ code: number | null; stdout: string; stderr: string }>((resolve, reject) => {
    const child = spawn(invocation.command, [...invocation.args, ...args], {
      cwd,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    })
    let stdout = ""
    let stderr = ""
    child.stdout.setEncoding("utf8")
    child.stderr.setEncoding("utf8")
    child.stdout.on("data", (chunk) => {
      stdout += chunk
    })
    child.stderr.on("data", (chunk) => {
      stderr += chunk
    })
    child.on("error", (error) => reject(desktopCommandError(invocation, error)))
    child.on("close", (code) => resolve({ code, stdout, stderr }))
  })

  if (result.code !== 0) {
    throw new Error(
      result.stderr.trim() || result.stdout.trim() || `${invocation.displayName} exited with code ${result.code}`,
    )
  }

  try {
    return JSON.parse(result.stdout.trim()) as T
  } catch (error) {
    throw new Error(
      `Could not parse ${invocation.displayName} JSON output: ${error instanceof Error ? error.message : String(error)}`,
    )
  }
}

function webUiUrl(port: number) {
  return `http://127.0.0.1:${port}/`
}

function firstRunningPort(status: DesktopStatus): number | undefined {
  const instances = Array.isArray(status.instances) ? status.instances : []
  for (const instance of instances) {
    if (Number.isFinite(instance.port) && instance.port! > 0) return Math.trunc(instance.port!)
  }
  return undefined
}

export async function launchWebUi(options: WebUiLaunchOptions = {}): Promise<WebUiLaunchResult> {
  const cwd = options.cwd ?? process.cwd()
  const invocation = resolveDesktopInvocation(cwd)
  const openBrowser = options.openBrowser !== false

  let port: number | undefined
  let started = false
  const status = await runDesktopJson<DesktopStatus>(invocation, ["status", "--json", "--plain"], cwd)
  port = firstRunningPort(status)

  if (!port) {
    const args = ["serve", "--json", "--plain"]
    if (Number.isFinite(options.port) && options.port! > 0) args.push("--port", String(Math.trunc(options.port!)))
    if (options.uiPassword?.trim()) args.push("--ui-password", options.uiPassword.trim())
    const serve = await runDesktopJson<DesktopServeResult>(invocation, args, cwd)
    port = Number.isFinite(serve.port) && serve.port! > 0 ? Math.trunc(serve.port!) : undefined
    if (!port) throw new Error(`${invocation.displayName} did not report a web UI port`)
    started = true
  }

  const url = webUiUrl(port)
  let opened = false
  if (openBrowser) {
    await open(url)
      .then(() => {
        opened = true
      })
      .catch(() => {
        opened = false
      })
  }

  const action = started ? "Started" : opened ? "Opened" : "AX Code Web UI is available at"
  return {
    started,
    port,
    url,
    opened,
    message: action.endsWith("at") ? `${action} ${url}` : `${action} AX Code Web UI at ${url}`,
  }
}

export async function runWebUiDesktopCommand(action: "status" | "stop" | "logs", cwd = process.cwd()) {
  const invocation = resolveDesktopInvocation(cwd)
  const args = action === "logs" ? ["logs"] : [action]

  await new Promise<void>((resolve, reject) => {
    const child = spawn(invocation.command, [...invocation.args, ...args], {
      cwd,
      env: process.env,
      stdio: "inherit",
      windowsHide: true,
    })
    child.on("error", (error) => reject(desktopCommandError(invocation, error)))
    child.on("close", (code) => {
      if (code === 0) resolve()
      else reject(new Error(`${invocation.displayName} ${action} exited with code ${code}`))
    })
  })
}
