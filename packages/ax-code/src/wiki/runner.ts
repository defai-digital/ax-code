/**
 * Spawn the external OpenWiki CLI for generate/update (ADR-050).
 */

import { spawn } from "child_process"
import { detectWiki, resolveWikiCommand } from "./detect"

export type WikiRunAction = "generate" | "update"

export type WikiRunResult = {
  ok: boolean
  action: WikiRunAction
  command: string
  args: string[]
  exitCode: number | null
  stdout: string
  stderr: string
  durationMs: number
  installHint?: string
  error?: string
}

export type WikiRunProgress = {
  stream: "stdout" | "stderr"
  chunk: string
  elapsedMs: number
}

export const OPENWIKI_INSTALL_HINT =
  "Install OpenWiki: npm install -g openwiki  (then configure ~/.openwiki/.env with a model provider). Docs: https://github.com/langchain-ai/openwiki"

/**
 * Build argv for OpenWiki code-mode update.
 * OpenWiki treats `code --update --print` as create-if-missing + non-interactive.
 */
export function buildOpenWikiArgs(action: WikiRunAction, extraArgs: string[] = []): string[] {
  // generate and update both use code --update --print:
  // OpenWiki creates the wiki when absent; --print avoids interactive chat.
  void action
  return ["code", "--update", "--print", ...extraArgs]
}

export function formatElapsed(ms: number): string {
  const totalSec = Math.max(0, Math.floor(ms / 1000))
  const min = Math.floor(totalSec / 60)
  const sec = totalSec % 60
  if (min === 0) return `${sec}s`
  return `${min}m ${sec.toString().padStart(2, "0")}s`
}

/**
 * Heartbeat helper for long OpenWiki runs. Calls onTick when quiet for intervalMs.
 * Returns a disposer that clears the timer.
 */
export function startQuietHeartbeat(input: {
  intervalMs?: number
  getLastActivityMs: () => number
  getStartedMs: () => number
  onTick: (elapsedMs: number, quietMs: number) => void
}): () => void {
  const intervalMs = input.intervalMs ?? 15_000
  const timer = setInterval(() => {
    const now = Date.now()
    const quietMs = now - input.getLastActivityMs()
    if (quietMs >= intervalMs) {
      input.onTick(now - input.getStartedMs(), quietMs)
    }
  }, Math.min(intervalMs, 5_000))
  timer.unref?.()
  return () => clearInterval(timer)
}

export async function runOpenWiki(input: {
  root: string
  action: WikiRunAction
  command?: string
  extraArgs?: string[]
  env?: Record<string, string>
  timeoutMs?: number
  /** Optional pre-resolved binary path */
  binaryPath?: string
  /** Live stream callback (chunk may be partial lines). */
  onProgress?: (event: WikiRunProgress) => void
}): Promise<WikiRunResult> {
  const command = resolveWikiCommand(input.command)
  const args = buildOpenWikiArgs(input.action, input.extraArgs ?? [])
  const timeoutMs = input.timeoutMs ?? 30 * 60 * 1000
  const started = Date.now()

  let binaryPath = input.binaryPath
  if (!binaryPath) {
    const det = await detectWiki({ root: input.root, command })
    binaryPath = det.binary.path
    if (!det.binary.found) {
      return {
        ok: false,
        action: input.action,
        command,
        args,
        exitCode: null,
        stdout: "",
        stderr: "",
        durationMs: Date.now() - started,
        installHint: OPENWIKI_INSTALL_HINT,
        error: `OpenWiki CLI not found (looked for "${command}" on PATH).`,
      }
    }
  }

  return await new Promise<WikiRunResult>((resolve) => {
    const child = spawn(binaryPath!, args, {
      cwd: input.root,
      env: { ...process.env, ...input.env },
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    })

    let stdout = ""
    let stderr = ""
    let settled = false

    const finish = (result: WikiRunResult) => {
      if (settled) return
      settled = true
      resolve(result)
    }

    const timer = setTimeout(() => {
      child.kill("SIGTERM")
      finish({
        ok: false,
        action: input.action,
        command: binaryPath!,
        args,
        exitCode: null,
        stdout,
        stderr: stderr + `\n[ax-code] timed out after ${timeoutMs}ms`,
        durationMs: Date.now() - started,
        error: `OpenWiki timed out after ${timeoutMs}ms`,
      })
    }, timeoutMs)

    const emit = (stream: "stdout" | "stderr", chunk: string) => {
      if (stream === "stdout") stdout += chunk
      else stderr += chunk
      input.onProgress?.({ stream, chunk, elapsedMs: Date.now() - started })
    }

    child.stdout?.on("data", (chunk: Buffer | string) => {
      emit("stdout", String(chunk))
    })
    child.stderr?.on("data", (chunk: Buffer | string) => {
      emit("stderr", String(chunk))
    })

    child.on("error", (err: NodeJS.ErrnoException) => {
      clearTimeout(timer)
      const missing = err.code === "ENOENT"
      finish({
        ok: false,
        action: input.action,
        command: binaryPath!,
        args,
        exitCode: null,
        stdout,
        stderr,
        durationMs: Date.now() - started,
        installHint: missing ? OPENWIKI_INSTALL_HINT : undefined,
        error: err.message,
      })
    })

    child.on("close", (code) => {
      clearTimeout(timer)
      finish({
        ok: code === 0,
        action: input.action,
        command: binaryPath!,
        args,
        exitCode: code,
        stdout,
        stderr,
        durationMs: Date.now() - started,
        error: code === 0 ? undefined : `OpenWiki exited with code ${code}`,
      })
    })
  })
}
