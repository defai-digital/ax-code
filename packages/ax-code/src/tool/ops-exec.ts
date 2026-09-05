import { spawn } from "node:child_process"
import { Config } from "@/config/config"
import { Env } from "@/util/env"
import { Shell } from "@/shell/shell"
import { Instance } from "@/project/instance"
import { parseShellArgs } from "@/util/shell-args"
import { findWrappedCommand, classifyDestructiveCommand, gitSubcommand } from "./bash-destructive"
import { NamedError } from "@ax-code/util/error"
import z from "zod"

// Hard cap on captured output, matching the bash tool's memory guard: commands
// that produce gigabytes of output must not grow an unbounded string in RAM.
const OUTPUT_HARD_CAP = 10 * 1024 * 1024

export const OpsReadOnlyCommandError = NamedError.create(
  "OpsReadOnlyCommandError",
  z.object({ command: z.string(), message: z.string() }),
)

const LOCAL_READ_ONLY = new Set([
  "cat",
  "diff",
  "echo",
  "exit",
  "false",
  "grep",
  "head",
  "jq",
  "ls",
  "printf",
  "pwd",
  "rg",
  "stat",
  "tail",
  "test",
  "true",
  "wc",
])

function hasShellControl(input: string): boolean {
  let quote: "'" | '"' | undefined
  let escaped = false
  for (const char of input) {
    if (escaped) {
      escaped = false
      continue
    }
    if (char === "\\" && quote !== "'") {
      escaped = true
      continue
    }
    if (quote) {
      if (char === quote) quote = undefined
      continue
    }
    if (char === "'" || char === '"') {
      quote = char
      continue
    }
    if (char === ";" || char === "|" || char === "&" || char === ">" || char === "<" || char === "`" || char === "\n") {
      return true
    }
  }
  return /\$\(/.test(input)
}

/** Fail closed for commands executed by read-only ops phases. */
export function assertOpsReadOnlyCommand(command: string): void {
  const parts = parseShellArgs(command)
  const outer = parts[0]?.replace(/^.*[\\/]/, "").toLowerCase()
  const resolved = findWrappedCommand(parts)
  const name = resolved?.name
  const args = resolved?.args ?? []
  const deny = (message: string): never => {
    throw new OpsReadOnlyCommandError({ command, message: `Read-only command rejected: ${message}` })
  }
  if (typeof name !== "string") {
    throw new OpsReadOnlyCommandError({ command, message: "Read-only command is empty or unsupported" })
  }
  if (hasShellControl(command)) deny("Read-only ops commands cannot contain shell control operators")
  if (outer && new Set(["bash", "doas", "eval", "sh", "sudo", "xargs", "zsh"]).has(outer)) {
    deny(`Command wrapper ${outer} is not allowed in read-only ops phases`)
  }
  const destructive = classifyDestructiveCommand(parts)
  if (destructive) deny(destructive)
  if (LOCAL_READ_ONLY.has(name)) return
  if (name === "git") {
    const subcommand = gitSubcommand(args)?.subcommand
    if (subcommand && new Set(["diff", "log", "rev-parse", "show", "status"]).has(subcommand)) return
  }
  if (name === "terraform") {
    const subcommand = args.find((arg) => !arg.startsWith("-"))?.toLowerCase()
    if (subcommand && new Set(["output", "providers", "show", "validate", "version"]).has(subcommand)) return
  }
  if (name === "kubectl") {
    const verb = args.find((arg) => !arg.startsWith("-"))?.toLowerCase()
    if (verb && new Set(["api-resources", "describe", "diff", "explain", "get", "version"]).has(verb)) return
  }
  if (name === "aws") {
    const positionals = args.filter((arg) => !arg.startsWith("-"))
    const operation = positionals[1]?.toLowerCase()
    if (operation && /^(describe|get|head|list)/.test(operation)) return
  }
  if (name === "gcloud" || name === "az" || name === "doctl") {
    const positionals = args.filter((arg) => !arg.startsWith("-"))
    if (
      positionals.some((arg) =>
        /^(add|apply|attach|create|delete|deploy|destroy|detach|disable|enable|insert|patch|remove|replace|reset|resize|restart|rollback|set|start|stop|update|write)$/i.test(
          arg,
        ),
      )
    ) {
      deny(`${name} command contains a mutating action`)
    }
    if (positionals.some((arg) => /^(describe|get|list|show)$/.test(arg.toLowerCase()))) return
  }
  if (name === "ssh") {
    const remote = args.at(-1)?.trim().toLowerCase()
    if (remote && /^(show|display|get|list)\b/.test(remote)) return
  }
  deny(`Command ${name} is not in the Cloud Operations read-only allowlist`)
}

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
    aborted: boolean
    truncated: boolean
  }

  export async function run(input: {
    command: string
    cwd?: string
    timeoutSeconds: number
    abort?: AbortSignal
  }): Promise<Result> {
    input.abort?.throwIfAborted()
    const config = await Config.get()
    input.abort?.throwIfAborted()
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
          aborted,
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
      // Close the check/listener race: an abort between the pre-spawn check
      // and listener registration must still terminate the new process.
      if (input.abort?.aborted) onAbort()

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

  export function assertReadOnly(command: string): void {
    assertOpsReadOnlyCommand(command)
  }
}
