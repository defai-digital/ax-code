import { spawn } from "node:child_process"
import { Config } from "@/config/config"
import { Env } from "@/util/env"
import { Shell } from "@/shell/shell"
import { Instance } from "@/project/instance"

// Hard cap on captured output, matching the bash tool's memory guard: commands
// that produce gigabytes of output must not grow an unbounded string in RAM.
const OUTPUT_HARD_CAP = 10 * 1024 * 1024

/**
 * Minimal foreground command runner for the Cloud Operations tools
 * (ops_apply / ops_verify). The full bash tool is not cleanly exportable — it
 * is one large Tool.define closure carrying permission, sandbox, background
 * shell, and escalation concerns ops tools must not re-invoke — so this
 * helper re-implements only the pieces the sanctioned mutation/verify path
 * needs: shell selection, secret-stripped env, detached process group for
 * timeout kills, and a bounded output capture.
 */
export namespace OpsExec {
  export type Result = {
    exitCode: number | null
    stdout: string
    stderr: string
    timedOut: boolean
    truncated: boolean
  }

  export async function run(input: {
    command: string
    cwd?: string
    timeoutSeconds: number
    abort?: AbortSignal
  }): Promise<Result> {
    const config = await Config.get()
    const shell = Shell.acceptable(config.shell)
    const cwd = input.cwd ?? Instance.directory
    const env = Env.sanitize({ ...process.env })

    return new Promise<Result>((resolve, reject) => {
      const proc = spawn(input.command, {
        shell,
        cwd,
        env,
        stdio: ["ignore", "pipe", "pipe"],
        detached: process.platform !== "win32",
        windowsHide: process.platform === "win32",
      })

      let stdoutBytes = 0
      let stderrBytes = 0
      const stdoutChunks: Buffer[] = []
      const stderrChunks: Buffer[] = []
      let truncated = false
      let timedOut = false
      let aborted = false
      let settled = false
      let exitCodeOverride: number | null = null

      const capture = (chunk: Buffer, chunks: Buffer[], priorBytes: number): number => {
        if (priorBytes >= OUTPUT_HARD_CAP) {
          truncated = true
          return priorBytes
        }
        const remaining = OUTPUT_HARD_CAP - priorBytes
        if (chunk.byteLength > remaining) {
          chunks.push(chunk.subarray(0, remaining))
          truncated = true
          return priorBytes + remaining
        }
        chunks.push(chunk)
        return priorBytes + chunk.byteLength
      }

      const decoder = new TextDecoder()
      const finish = () => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        input.abort?.removeEventListener("abort", onAbort)
        resolve({
          exitCode: exitCodeOverride,
          stdout: decoder.decode(Buffer.concat(stdoutChunks)),
          stderr: decoder.decode(Buffer.concat(stderrChunks)),
          timedOut,
          truncated,
        })
      }

      const onAbort = () => {
        aborted = true
        void Shell.killTree(proc, { exited: () => settled })
      }

      const timer = setTimeout(() => {
        timedOut = true
        void Shell.killTree(proc, { exited: () => settled })
      }, input.timeoutSeconds * 1000)

      input.abort?.addEventListener("abort", onAbort, { once: true })

      proc.stdout?.on("data", (chunk: Buffer) => {
        stdoutBytes = capture(chunk, stdoutChunks, stdoutBytes)
      })
      proc.stderr?.on("data", (chunk: Buffer) => {
        stderrBytes = capture(chunk, stderrChunks, stderrBytes)
      })
      proc.once("error", (error) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        input.abort?.removeEventListener("abort", onAbort)
        reject(error)
      })
      proc.once("close", () => {
        // Surface an abort as a non-zero, non-timeout result; the caller
        // treats any non-zero exit as failure and journals it.
        exitCodeOverride = aborted && proc.exitCode === null ? 143 : proc.exitCode
        finish()
      })
    })
  }
}
