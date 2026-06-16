import { spawn } from "node:child_process"
import { randomBytes } from "node:crypto"
import { type Config } from "./gen/types.gen.js"
import {
  type Proc,
  resolveServerDefaults,
  buildServerArgs,
  buildAuthHeaders,
  waitForServerReady,
  closeProcGracefully,
} from "./internal/server-shared.js"

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
  const resolved = resolveServerDefaults(options)
  const args = buildServerArgs(resolved.hostname, resolved.port, options?.config?.logLevel)
  const username = resolved.auth?.username ?? "ax-code"
  const password = resolved.auth?.password ?? randomBytes(24).toString("base64url")
  const headers = buildAuthHeaders(username, password)

  const proc = spawn(`ax-code`, args, {
    signal: resolved.signal,
    env: {
      ...process.env,
      AX_CODE_SERVER_USERNAME: username,
      AX_CODE_SERVER_PASSWORD: password,
      AX_CODE_CONFIG_CONTENT: JSON.stringify(resolved.config ?? {}),
    },
  }) as Proc

  const url = await waitForServerReady(proc, { timeout: resolved.timeout, signal: resolved.signal })

  return {
    url,
    headers,
    async close() {
      await closeProcGracefully(proc)
    },
  }
}

export const createOpencodeServer = createAxCodeServer

export function createAxCodeTui(options?: TuiOptions) {
  const args: string[] = []

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
    async close() {
      await closeProcGracefully(proc)
    },
  }
}

export const createOpencodeTui = createAxCodeTui
