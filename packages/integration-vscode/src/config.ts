import * as vscode from "vscode"
import * as os from "node:os"
import * as path from "node:path"

export interface AxCodeConfig {
  binaryPath: string
  serverTimeoutMs: number
  requestTimeoutMs: number
  defaultModel: string
}

export function getConfig(): AxCodeConfig {
  const cfg = vscode.workspace.getConfiguration("axCode")
  return {
    binaryPath: cfg.get<string>("binaryPath", "").trim(),
    serverTimeoutMs: cfg.get<number>("serverTimeoutMs", 90000),
    requestTimeoutMs: cfg.get<number>("requestTimeoutMs", 600000),
    defaultModel: cfg.get<string>("defaultModel", "").trim(),
  }
}

export function enrichPath(existing: string): string {
  if (process.platform === "win32") {
    return existing
  }
  const home = os.homedir()
  const extras = [
    path.join(home, ".bun", "bin"),
    path.join(home, ".local", "bin"),
    "/opt/homebrew/bin",
    "/usr/local/bin",
    "/usr/bin",
    "/bin",
  ]
  const parts = existing ? existing.split(":") : []
  for (const p of extras) {
    if (!parts.includes(p)) {
      parts.push(p)
    }
  }
  return parts.join(":")
}
