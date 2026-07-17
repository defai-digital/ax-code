import fs from "node:fs"
import path from "node:path"
import { spawn } from "node:child_process"
import { fileURLToPath } from "node:url"
import { registerTuiProcessHandler } from "./util/lifecycle"

export const NATIVE_TUI_BINARY_ENV = "AX_CODE_NATIVE_TUI_BIN"

export type NativeTuiLaunchOptions = {
  cwd: string
  prompt?: string
  session?: string
  continue?: boolean
  fork?: boolean
  model?: string
  agent?: string
}

export function nativeTuiBinaryName(platform: NodeJS.Platform = process.platform) {
  return platform === "win32" ? "ax-code-tui.exe" : "ax-code-tui"
}

/**
 * Discover candidate paths for the Rust TUI sidecar.
 *
 * Packaged layout (esbuild bundle):
 *   <dist>/lib/index-node-tui.js
 *   <dist>/libexec/ax-code-tui
 *
 * Source/dev layout:
 *   walk up from this module until `crates/target/{debug,release}/ax-code-tui`
 *   is found (or use CARGO_TARGET_DIR when set).
 */
export function nativeTuiBinaryCandidates(
  input: {
    env?: Record<string, string | undefined>
    moduleUrl?: string
    platform?: NodeJS.Platform
    pathValue?: string
  } = {},
) {
  const env = input.env ?? process.env
  const platform = input.platform ?? process.platform
  const name = nativeTuiBinaryName(platform)
  const explicit = env[NATIVE_TUI_BINARY_ENV]?.trim()
  if (explicit) return [path.resolve(explicit)]

  const moduleDir = path.dirname(fileURLToPath(input.moduleUrl ?? import.meta.url))
  const candidates: string[] = []

  // Packaged node-bundled distribution: lib/index-node-tui.js sits beside libexec/.
  candidates.push(path.resolve(moduleDir, "..", "libexec", name))
  // If the supervisor is ever shipped as a nested file under lib/, still check.
  candidates.push(path.resolve(moduleDir, "libexec", name))

  if (env.CARGO_TARGET_DIR) {
    const targetRoot = path.resolve(env.CARGO_TARGET_DIR)
    candidates.push(path.join(targetRoot, "release", name), path.join(targetRoot, "debug", name))
  }

  // Walk upward looking for a Rust workspace target dir (source checkouts).
  let dir = moduleDir
  for (let i = 0; i < 12; i++) {
    const cratesTarget = path.join(dir, "crates", "target")
    candidates.push(path.join(cratesTarget, "release", name), path.join(cratesTarget, "debug", name))
    const parent = path.dirname(dir)
    if (parent === dir) break
    dir = parent
  }

  const pathValue = input.pathValue ?? env.PATH ?? ""
  for (const entry of pathValue.split(path.delimiter).filter(Boolean)) {
    candidates.push(path.join(entry, name))
  }

  return [...new Set(candidates)]
}

function isExecutableFile(file: string, platform: NodeJS.Platform = process.platform) {
  try {
    if (!fs.statSync(file).isFile()) return false
    if (platform !== "win32") fs.accessSync(file, fs.constants.X_OK)
    return true
  } catch {
    return false
  }
}

export function resolveNativeTuiBinary(
  input: {
    env?: Record<string, string | undefined>
    moduleUrl?: string
    platform?: NodeJS.Platform
    pathValue?: string
  } = {},
) {
  const platform = input.platform ?? process.platform
  const candidates = nativeTuiBinaryCandidates(input)
  const match = candidates.find((candidate) => isExecutableFile(candidate, platform))
  if (match) return match

  const explicit = (input.env ?? process.env)[NATIVE_TUI_BINARY_ENV]?.trim()
  if (explicit) {
    throw new Error(`${NATIVE_TUI_BINARY_ENV} does not point to an executable file: ${explicit}`)
  }
  throw new Error(
    [
      "The native Rust TUI binary is not installed or built.",
      "Build it with `cargo build --manifest-path crates/Cargo.toml -p ax-code-tui`,",
      `or set ${NATIVE_TUI_BINARY_ENV} to an ax-code-tui executable.`,
      `Checked:\n  - ${candidates.join("\n  - ")}`,
    ].join("\n"),
  )
}

export function buildNativeTuiArgs(input: NativeTuiLaunchOptions & { serverUrl: string }) {
  const args = ["--server-url", input.serverUrl, "--directory", input.cwd]
  if (input.session) args.push("--session", input.session)
  if (input.prompt) args.push("--prompt", input.prompt)
  if (input.continue) args.push("--continue")
  if (input.fork) args.push("--fork")
  if (input.model) args.push("--model", input.model)
  if (input.agent) args.push("--agent", input.agent)
  return args
}

function waitForChild(child: ReturnType<typeof spawn>) {
  return new Promise<{ code: number; signal?: NodeJS.Signals }>((resolve, reject) => {
    let settled = false
    child.once("error", (error) => {
      if (settled) return
      settled = true
      reject(error)
    })
    child.once("exit", (code, signal) => {
      if (settled) return
      settled = true
      resolve({ code: code ?? 1, signal: signal ?? undefined })
    })
  })
}

function parentSignals(platform: NodeJS.Platform = process.platform): NodeJS.Signals[] {
  if (platform === "win32") return ["SIGINT", "SIGTERM"]
  return ["SIGINT", "SIGTERM", "SIGHUP"]
}

/**
 * Run the Rust/Ratatui UI as the foreground terminal owner while the Node
 * process hosts the existing AX Code runtime on an authenticated loopback
 * server. This keeps the UI genuinely native without rewriting providers,
 * tools, sessions, or storage.
 */
export async function runNativeTui(input: NativeTuiLaunchOptions) {
  const binary = resolveNativeTuiBinary()
  const [{ Server }, { ServerRuntimeAuth }] = await Promise.all([
    import("@/server/server"),
    import("@/server/runtime-auth"),
  ])
  const hostname = "127.0.0.1"
  const app = Server.createApp({ port: 0, hostname, runtimeAuth: true })
  const server = await Server.listen({ port: 0, hostname, app })
  const runtimeToken = ServerRuntimeAuth.headers()[ServerRuntimeAuth.HEADER]
  const args = buildNativeTuiArgs({ ...input, serverUrl: `http://${hostname}:${server.port}` })
  const child = spawn(binary, args, {
    cwd: input.cwd,
    stdio: "inherit",
    windowsHide: false,
    env: {
      ...process.env,
      AX_CODE_RUNTIME_TOKEN: runtimeToken,
      AX_CODE_TUI_ENGINE: "native",
      AX_CODE_NATIVE_RENDER: "0",
      AX_CODE_NATIVE_RENDER_SCOPE: "",
    },
  })

  const unregisterSignals = parentSignals().map((signal) =>
    registerTuiProcessHandler(
      signal,
      () => {
        if (!child.killed) child.kill(signal)
      },
      { name: `native-tui-forward-${signal.toLowerCase()}` },
    ),
  )

  try {
    return await waitForChild(child)
  } finally {
    for (const unregister of unregisterSignals) unregister()
    if (!child.killed && child.exitCode === null) child.kill()
    await server.stop(true)
  }
}
