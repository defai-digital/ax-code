import { Log } from "@/util/log"
import { Process } from "@/util/process"
import { toErrorMessage } from "@/util/error-message"
import { text } from "node:stream/consumers"

let shellEnvReady: Promise<void> | undefined

type ShellEnvProcess = Pick<Process.Child, "exited" | "stdout" | "stderr" | "unref">

export async function waitForShellEnvCapture(
  proc: ShellEnvProcess,
  timeoutMs: number,
  onTimeout: () => void,
): Promise<[number, string, string] | undefined> {
  return new Promise((resolve) => {
    let settled = false
    const finish = (value: [number, string, string] | undefined) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve(value)
    }
    const timer = setTimeout(() => {
      // A shell profile can leave its process uninterruptible even after the
      // child-process timeout fires. Detach its handles so it cannot hold the
      // CLI or provider initialization hostage.
      proc.stdout?.destroy()
      proc.stderr?.destroy()
      proc.unref?.()
      onTimeout()
      finish(undefined)
    }, timeoutMs)

    Promise.all([
      proc.exited,
      proc.stdout ? text(proc.stdout) : Promise.resolve(""),
      proc.stderr ? text(proc.stderr) : Promise.resolve(""),
    ]).then(
      ([code, stdout, stderr]) => finish([code, stdout, stderr]),
      () => finish(undefined),
    )
  })
}

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
    const result = await waitForShellEnvCapture(proc, shellTimeoutMs, () => {
      Log.Default.debug("shell env load timed out; continuing without shell environment")
      void stopShellEnvProcess(proc)
    })
    if (!result) return
    const [code, stdout] = result
    if (code !== 0 || !stdout) {
      if (code === 124) {
        Log.Default.debug("shell env load failed", {
          error: `Shell env load timed out after ${shellTimeoutMs / 1000}s`,
        })
      }
      return
    }

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
