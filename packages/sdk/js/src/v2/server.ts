import { spawn } from "node:child_process"
import { randomBytes } from "node:crypto"
import { type Config } from "./gen/types.gen.js"

type Proc = ReturnType<typeof spawn> & {
  on(event: "exit", listener: (code: number | null) => void): void
  on(event: "error", listener: (error: Error) => void): void
}

export type ServerOptions = {
  hostname?: string
  port?: number
  /**
   * HTTP server helpers default to loopback-only. Set this only when the caller owns
   * transport security and authentication for a network-visible server.
   */
  allowNetworkBind?: boolean
  signal?: AbortSignal
  timeout?: number
  config?: Config
  auth?: {
    username?: string
    password?: string
  }
}

export type TuiOptions = {
  project?: string
  model?: string
  session?: string
  agent?: string
  signal?: AbortSignal
  config?: Config
}

export async function createAxCodeServer(options?: ServerOptions) {
  options = Object.assign(
    {
      hostname: "127.0.0.1",
      port: 4096,
      timeout: 5000,
    },
    options ?? {},
  )
  const hostname = options.hostname ?? "127.0.0.1"
  assertSdkHttpLoopbackBind(hostname, options.allowNetworkBind, "createAxCodeServer")

  const args = [`serve`, `--hostname=${hostname}`, `--port=${options.port}`]
  if (options.config?.logLevel) args.push(`--log-level=${options.config.logLevel}`)
  const username = options.auth?.username ?? "ax-code"
  const password = options.auth?.password ?? randomBytes(24).toString("base64url")
  const headers = {
    Authorization: "Basic " + Buffer.from(`${username}:${password}`).toString("base64"),
  }

  const proc = spawn(`ax-code`, args, {
    signal: options.signal,
    env: {
      ...process.env,
      AX_CODE_SERVER_USERNAME: username,
      AX_CODE_SERVER_PASSWORD: password,
      AX_CODE_CONFIG_CONTENT: JSON.stringify(options.config ?? {}),
    },
  }) as Proc

  const url = await new Promise<string>((resolve, reject) => {
    const id = setTimeout(() => {
      fail(new Error(`Timeout waiting for server to start after ${options.timeout}ms`))
    }, options.timeout)
    let output = ""
    let settled = false
    const onStdout = (chunk: any) => {
      output += chunk.toString()
      const lines = output.split("\n")
      for (const line of lines) {
        if (line.startsWith("ax-code server listening")) {
          const match = line.match(/on\s+(https?:\/\/[^\s]+)/)
          if (!match) {
            fail(new Error(`Failed to parse server url from output: ${line}`))
            return
          }
          succeed(match[1]!)
          return
        }
      }
    }
    const onStderr = (chunk: any) => {
      output += chunk.toString()
    }
    const cleanup = () => {
      proc.stdout?.removeListener("data", onStdout)
      proc.stderr?.removeListener("data", onStderr)
      if (options.signal) options.signal.removeEventListener("abort", onAbort)
    }
    const fail = (error: Error, kill = true) => {
      if (settled) return
      settled = true
      clearTimeout(id)
      cleanup()
      if (kill) {
        try {
          proc.kill()
        } catch {}
      }
      reject(error)
    }
    const succeed = (url: string) => {
      if (settled) return
      settled = true
      clearTimeout(id)
      cleanup()
      resolve(url)
    }
    const onAbort = () => {
      fail(new Error("Aborted"))
    }
    proc.stdout?.on("data", onStdout)
    proc.stderr?.on("data", onStderr)
    proc.on("exit", (code) => {
      let msg = `Server exited with code ${code}`
      if (output.trim()) {
        msg += `\nServer output: ${output}`
      }
      fail(new Error(msg), false)
    })
    proc.on("error", (error) => {
      fail(error, false)
    })
    if (options.signal) {
      options.signal.addEventListener("abort", onAbort, { once: true })
    }
  })

  return {
    url,
    headers,
    close() {
      try {
        proc.kill()
      } catch {}
    },
  }
}

export const createOpencodeServer = createAxCodeServer

export function createAxCodeTui(options?: TuiOptions) {
  const args = []

  if (options?.project) {
    args.push(`--project=${options.project}`)
  }
  if (options?.model) {
    args.push(`--model=${options.model}`)
  }
  if (options?.session) {
    args.push(`--session=${options.session}`)
  }
  if (options?.agent) {
    args.push(`--agent=${options.agent}`)
  }

  const proc = spawn(`ax-code`, args, {
    signal: options?.signal,
    stdio: "inherit",
    env: {
      ...process.env,
      AX_CODE_CONFIG_CONTENT: JSON.stringify(options?.config ?? {}),
    },
  }) as Proc

  return {
    close() {
      proc.kill()
    },
  }
}

export const createOpencodeTui = createAxCodeTui

function assertSdkHttpLoopbackBind(hostname: string, allowNetworkBind: boolean | undefined, helper: string) {
  if (allowNetworkBind || isLoopbackHostname(hostname)) return
  throw new Error(
    `${helper} only binds the HTTP API to loopback hostnames by default. ` +
      `Refusing hostname ${hostname}. ` +
      "Use @ax-code/sdk/grpc for desktop native transports, or pass allowNetworkBind: true only for an explicitly secured server.",
  )
}

function isLoopbackHostname(hostname: string) {
  const normalized = hostname.toLowerCase().replace(/^\[|\]$/g, "")
  return normalized === "localhost" || normalized === "::1" || isIpv4Loopback(normalized)
}

function isIpv4Loopback(hostname: string) {
  const parts = hostname.split(".")
  if (parts.length !== 4) return false
  const numbers = parts.map((part) => Number(part))
  return numbers.every((part) => Number.isInteger(part) && part >= 0 && part <= 255) && numbers[0] === 127
}
