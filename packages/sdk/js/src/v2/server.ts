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
  resolveSpawnCommand,
} from "../internal/server-shared.js"

export type ServerOptions = {
  hostname?: string
  port?: number
  /**
   * @deprecated Network binds are disabled; retained for source compatibility only.
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

  const env = {
    ...process.env,
    AX_CODE_SERVER_USERNAME: username,
    AX_CODE_SERVER_PASSWORD: password,
    AX_CODE_CONFIG_CONTENT: JSON.stringify(resolved.config ?? {}),
  }

  const proc = spawn(resolveSpawnCommand(`ax-code`, env), args, {
    signal: resolved.signal,
    env,
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

  const env = {
    ...process.env,
    AX_CODE_CONFIG_CONTENT: JSON.stringify(options?.config ?? {}),
  }

  const proc = spawn(resolveSpawnCommand(`ax-code`, env), args, {
    signal: options?.signal,
    stdio: "inherit",
    env,
  }) as Proc

  return {
    async close() {
      await closeProcGracefully(proc)
    },
  }
}

export const createOpencodeTui = createAxCodeTui
