import { Log } from "@/util/log"
import { Process } from "@/util/process"
import { toErrorMessage } from "@/util/error-message"
import { text } from "node:stream/consumers"

let shellEnvReady: Promise<void> | undefined

/**
 * Await this before accessing environment variables that may come from the
 * user's shell profile (e.g., API keys set in .zshrc/.bashrc). The shell env
 * is loaded in the background during init() so it doesn't block startup.
 */
export function ensureShellEnv() {
  return shellEnvReady ?? Promise.resolve()
}

export function startShellEnvLoad(env: Record<string, string | undefined>) {
  shellEnvReady = loadShellEnv(env)
  return shellEnvReady
}

async function stopShellEnvProcess(proc: Process.Child | undefined) {
  if (!proc) return
  await Process.stop(proc).catch((err) => {
    Log.Default.debug("shell env process cleanup failed", { error: toErrorMessage(err) })
  })
}

async function loadShellEnv(env: Record<string, string | undefined>) {
  if (process.platform === "win32") return
  const shell = env.SHELL || (process.platform === "darwin" ? "/bin/zsh" : "/bin/bash")
  const shellTimeoutMs = 3000
  let proc: Process.Child | undefined
  try {
    proc = Process.spawn([shell, "-l", "-c", "env -0"], {
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
      env: { ...env, TERM: "dumb", NO_COLOR: "1" },
      timeout: shellTimeoutMs,
    })
    let result: [number, string, string] | undefined
    try {
      const [code, stdout, stderr] = await Promise.all([
        proc.exited,
        proc.stdout ? text(proc.stdout) : Promise.resolve(""),
        proc.stderr ? text(proc.stderr) : Promise.resolve(""),
      ])
      if (code === 124) {
        throw new Error(`Shell env load timed out after ${shellTimeoutMs / 1000}s: ${stderr}`)
      }
      result = [code, stdout, stderr]
    } catch (err) {
      Log.Default.debug("shell env load failed", { error: toErrorMessage(err) })
      await stopShellEnvProcess(proc)
      result = undefined
    }
    if (!result) return
    const [code, stdout] = result
    if (code !== 0 || !stdout) return

    for (const entry of stdout.split("\0")) {
      const eq = entry.indexOf("=")
      if (eq <= 0) continue
      const key = entry.slice(0, eq)
      if (key in env) continue // don't overwrite existing vars
      env[key] = entry.slice(eq + 1)
    }
  } catch (err) {
    await stopShellEnvProcess(proc)
    Log.Default.debug("shell env load setup failed", { error: toErrorMessage(err) })
    // Shell env loading is best-effort; don't fail startup.
  }
}
