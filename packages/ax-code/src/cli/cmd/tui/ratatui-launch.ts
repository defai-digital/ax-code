/**
 * Launch the Ratatui sidecar TUI against an authenticated loopback server.
 * ADR-054 Phase 2 dogfood path — OpenTUI remains default when not selected.
 */

import { spawn } from "node:child_process"
import { accessSync, constants as fsConstants } from "node:fs"
import path from "node:path"
import { randomBytes } from "node:crypto"
import { fileURLToPath } from "node:url"
import { UI } from "@/cli/ui"
import { Log } from "@/util/log"
import { DiagnosticLog } from "@/debug/diagnostic-log"
import { ServerRuntimeAuth } from "@/server/runtime-auth"
import { ratatuiBinaryCandidates } from "./ratatui-engine"

const log = Log.create({ service: "tui.ratatui" })

export type RatatuiLaunchInput = {
  /** Absolute base URL from Server.listen (e.g. http://127.0.0.1:4096/). */
  url: string
  directory: string
  sessionID?: string
  prompt?: string
  /** Basic-auth password already applied to the server env; generated if absent. */
  password: string
  username?: string
  env?: NodeJS.ProcessEnv
  /** Repo root for resolving crates/target binaries. */
  workspaceRoot?: string
  /** When true, pass --smoke for non-interactive CI. */
  smoke?: boolean
  spawnImpl?: typeof spawn
  /** Override binary resolution (tests). */
  resolveBinary?: (env: NodeJS.ProcessEnv, workspaceRoot?: string) => string | undefined
}

function isExecutable(file: string): boolean {
  try {
    accessSync(file, fsConstants.X_OK)
    return true
  } catch {
    try {
      accessSync(file, fsConstants.F_OK)
      return true
    } catch {
      return false
    }
  }
}

export function resolveRatatuiBinary(
  env: NodeJS.ProcessEnv = process.env,
  workspaceRoot?: string,
): string | undefined {
  const root =
    workspaceRoot ??
    env.AX_CODE_WORKSPACE_ROOT ??
    // packages/ax-code/src/cli/cmd/tui → repo root is 6 levels up from this file when running from source
    path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../../../../")

  for (const candidate of ratatuiBinaryCandidates(env)) {
    if (path.isAbsolute(candidate) || candidate.includes("/") || candidate.includes("\\")) {
      const abs = path.isAbsolute(candidate) ? candidate : path.resolve(root, candidate)
      if (isExecutable(abs)) return abs
      continue
    }
    // bare name — rely on PATH at spawn time
    return candidate
  }
  return undefined
}

/** Generate a one-shot dogfood password when the server has none configured. */
export function ensureDogfoodPassword(env: NodeJS.ProcessEnv = process.env): string {
  const existing = env.AX_CODE_SERVER_PASSWORD?.trim() || env.AX_CODE_TUI_PASSWORD?.trim()
  if (existing) return existing
  return randomBytes(24).toString("base64url")
}

export async function launchRatatuiTui(input: RatatuiLaunchInput): Promise<number> {
  const env = input.env ?? process.env
  const resolve = input.resolveBinary ?? resolveRatatuiBinary
  const binary = resolve(env, input.workspaceRoot)
  if (!binary) {
    UI.error(
      [
        "Ratatui TUI binary not found (AX_CODE_TUI_ENGINE=ratatui).",
        "Build with: cargo build -p ax-code-tui --manifest-path crates/Cargo.toml",
        "Or set AX_CODE_TUI_BIN to the ax-code-tui path.",
      ].join("\n"),
    )
    return 1
  }

  const username = input.username ?? env.AX_CODE_SERVER_USERNAME ?? "ax-code"
  const childEnv: NodeJS.ProcessEnv = {
    ...env,
    AX_CODE_TUI_URL: input.url.replace(/\/$/, ""),
    AX_CODE_TUI_DIRECTORY: input.directory,
    AX_CODE_TUI_PASSWORD: input.password,
    AX_CODE_TUI_USERNAME: username,
    AX_CODE_SERVER_PASSWORD: input.password,
    AX_CODE_SERVER_USERNAME: username,
  }
  // Prefer header form so the binary does not depend on server password env alone.
  childEnv.AX_CODE_TUI_AUTH_HEADER =
    "Basic " + Buffer.from(`${username}:${input.password}`, "utf8").toString("base64")
  if (input.sessionID) childEnv.AX_CODE_TUI_SESSION_ID = input.sessionID
  if (input.prompt) childEnv.AX_CODE_TUI_PROMPT = input.prompt
  // Sidecar also needs the process-local runtime token when runtimeAuth is on.
  const runtimeHeaders = ServerRuntimeAuth.headers()
  for (const [k, v] of Object.entries(runtimeHeaders)) {
    childEnv[`AX_CODE_RUNTIME_HEADER_${k}`] = v
  }

  const args: string[] = []
  if (input.smoke || env.AX_CODE_TUI_SMOKE === "1") {
    args.push("--smoke")
    childEnv.AX_CODE_TUI_SMOKE = "1"
  }

  DiagnosticLog.recordProcess("tui.ratatuiLaunch", {
    binary,
    url: childEnv.AX_CODE_TUI_URL,
    directory: input.directory,
    smoke: args.includes("--smoke"),
  })
  log.info("launching ratatui tui", { binary, url: childEnv.AX_CODE_TUI_URL })

  const spawnFn = input.spawnImpl ?? spawn
  const exitCode = await new Promise<number>((resolvePromise, reject) => {
    const child = spawnFn(binary, args, {
      env: childEnv,
      stdio: "inherit",
      cwd: input.directory,
    })
    child.on("error", (error) => {
      DiagnosticLog.recordProcess("tui.ratatuiSpawnError", { error, binary })
      reject(error)
    })
    child.on("exit", (code, signal) => {
      if (signal) {
        resolvePromise(1)
        return
      }
      resolvePromise(code ?? 1)
    })
  })

  DiagnosticLog.recordProcess("tui.ratatuiExit", { code: exitCode })
  return exitCode
}
