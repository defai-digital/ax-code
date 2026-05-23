import * as vscode from "vscode"
import { spawn, type ChildProcess } from "node:child_process"
import * as fs from "node:fs"
import * as path from "node:path"
import { enrichPath, getConfig } from "./config"

interface AxCodePath {
  useBun: boolean
  command: string
  cwd: string
  entry: string
}

/**
 * Owns the lifecycle of a spawned `ax-code serve` process.
 *
 * Callers use `ensureStarted()` to lazily boot the server (with up to 3 retries
 * on port collisions) and `url` once it has resolved. `dispose()` kills the
 * child process and is safe to call multiple times.
 */
export class AxCodeServer {
  private process: ChildProcess | null = null
  private startPromise: Promise<void> | null = null
  private currentUrl: string | null = null
  private onExitCallback: (() => void) | null = null

  constructor(private readonly context: vscode.ExtensionContext) {}

  get url(): string | null {
    return this.currentUrl
  }

  /**
   * Subscribe to the next process exit. Used by SessionClient to tear down its
   * SSE reader when the server dies unexpectedly. The callback fires at most
   * once per server start.
   */
  setOnExit(cb: (() => void) | null) {
    this.onExitCallback = cb
  }

  async ensureStarted(): Promise<void> {
    if (this.currentUrl) {
      return
    }
    if (this.startPromise) {
      return this.startPromise
    }
    this.startPromise = this.startWithRetry().finally(() => {
      this.startPromise = null
    })
    return this.startPromise
  }

  dispose() {
    if (this.process) {
      this.process.kill()
      this.process = null
      this.currentUrl = null
    }
  }

  private async startWithRetry(): Promise<void> {
    let lastError: unknown
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        await this.startInner()
        return
      } catch (err: any) {
        lastError = err
        const msg = String(err?.message ?? "")
        const isPortBusy = /EADDRINUSE|address already in use|port.*in use|listen.*EACCES/i.test(msg)
        if (!isPortBusy) {
          throw err
        }
      }
    }
    throw lastError instanceof Error ? lastError : new Error("Failed to start ax-code after 3 attempts")
  }

  private async startInner(): Promise<void> {
    const port = Math.floor(Math.random() * (49150 - 16384 + 1)) + 16384
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? process.cwd()

    const axCodePath = this.findAxCodePath()
    const useShell = process.platform === "win32" && !axCodePath.useBun
    const { serverTimeoutMs } = getConfig()

    return new Promise((resolve, reject) => {
      const env = {
        ...process.env,
        PATH: enrichPath(process.env.PATH ?? ""),
        AX_CODE_CALLER: "vscode",
        AX_CODE_ORIGINAL_CWD: workspaceFolder,
      }

      const proc = axCodePath.useBun
        ? spawn(
            "bun",
            [
              `--cwd=${axCodePath.cwd}`,
              "run",
              "--conditions=browser",
              axCodePath.entry,
              "serve",
              `--hostname=127.0.0.1`,
              `--port=${port}`,
            ],
            { cwd: workspaceFolder, env, shell: false },
          )
        : spawn(axCodePath.command, ["serve", `--hostname=127.0.0.1`, `--port=${port}`], {
            cwd: workspaceFolder,
            env,
            shell: useShell,
          })

      this.process = proc

      let settled = false
      const settleReject = (err: Error) => {
        if (settled) {
          return
        }
        settled = true
        clearTimeout(timeout)
        try {
          proc.kill()
        } catch {}
        if (this.process === proc) {
          this.process = null
          this.currentUrl = null
        }
        reject(err)
      }
      const settleResolve = (url: string) => {
        if (settled) {
          return
        }
        settled = true
        clearTimeout(timeout)
        this.currentUrl = url
        resolve()
      }

      const timeout = setTimeout(() => {
        settleReject(
          new Error(
            `ax-code serve did not report listening within ${Math.round(serverTimeoutMs / 1000)}s. First launch compiles TypeScript — retry or increase axCode.serverTimeoutMs.`,
          ),
        )
      }, serverTimeoutMs)

      // Only accumulate output until we've matched "listening" (or settled
      // with an error). After that, discard to avoid an unbounded leak over
      // the server's lifetime.
      let output = ""
      const appendUntilSettled = (chunk: Buffer) => {
        if (settled) {
          return
        }
        output += chunk.toString()
        if (output.length > 8192) {
          output = output.slice(-8192)
        }
        const match = output.match(/listening on\s+(https?:\/\/[^\s]+)/)
        if (match) {
          settleResolve(match[1])
        }
      }
      proc.stdout?.on("data", appendUntilSettled)
      proc.stderr?.on("data", appendUntilSettled)

      proc.on("error", (error) => {
        settleReject(new Error(`Failed to start ax-code: ${error.message}`))
      })

      proc.on("exit", (code) => {
        if (!settled) {
          const tail = output.slice(-800).trim()
          const detail = tail ? `\n${tail}` : ""
          settleReject(new Error(`ax-code exited with code ${code}${detail}`))
          return
        }
        if (this.process === proc) {
          this.process = null
          this.currentUrl = null
        }
        this.onExitCallback?.()
      })
    })
  }

  private findAxCodePath(): AxCodePath {
    // Highest priority: explicit user config.
    const override = getConfig().binaryPath
    if (override && fs.existsSync(override)) {
      return { useBun: false, command: override, cwd: "", entry: "" }
    }

    // Dev mode: extension is inside the monorepo next to packages/ax-code.
    // Require both the ax-code entry AND a repo-root signal (pnpm-workspace.yaml)
    // so an installed VSIX at ~/.vscode/extensions/... with unrelated sibling dirs
    // isn't misdetected as a monorepo checkout.
    const extensionDir = this.context.extensionPath
    const monorepoRoot = path.resolve(extensionDir, "..", "..")
    const axCodeEntry = path.join(monorepoRoot, "packages", "ax-code", "src", "index.ts")
    const axCodeCwd = path.join(monorepoRoot, "packages", "ax-code")
    const workspaceMarker = path.join(monorepoRoot, "pnpm-workspace.yaml")
    if (fs.existsSync(axCodeEntry) && fs.existsSync(workspaceMarker)) {
      return { useBun: true, command: "bun", cwd: axCodeCwd, entry: axCodeEntry }
    }

    // Fall back to globally-installed ax-code command.
    return { useBun: false, command: "ax-code", cwd: "", entry: "" }
  }
}
