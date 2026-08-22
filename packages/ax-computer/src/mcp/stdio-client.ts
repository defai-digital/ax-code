import { spawn, type ChildProcess } from "node:child_process"
import type { ActionResult, ComputerAction } from "../action"
import type { PixelImage } from "../types"

export type McpClientErrorCode = "spawn_failed" | "exited" | "timeout" | "protocol"

export class McpClientError extends Error {
  readonly code: McpClientErrorCode

  constructor(code: McpClientErrorCode, message: string, options?: { cause?: unknown }) {
    super(message, options)
    this.name = "McpClientError"
    this.code = code
  }
}

export interface McpToolDefinition {
  name: string
  description?: string
  inputSchema?: unknown
}

export interface McpContentBlock {
  type: string
  text?: string
  data?: string
  mimeType?: string
}

export interface McpCallToolResult {
  content?: McpContentBlock[]
  structuredContent?: unknown
  isError?: boolean
}

/** minimal surface the providers need; StdioMcpClient implements it */
export interface McpClient {
  listTools(): Promise<McpToolDefinition[]>
  callTool(tool: string, args: Record<string, unknown>): Promise<McpCallToolResult>
  close(): Promise<void>
}

export interface StdioMcpClientOptions {
  command: string
  args?: string[]
  env?: Record<string, string | undefined>
  /** per-request timeout, default 60s */
  requestTimeoutMs?: number
}

const PROTOCOL_VERSION = "2024-11-05"
const DEFAULT_REQUEST_TIMEOUT_MS = 60_000
const STDERR_TAIL_LIMIT = 8 * 1024

interface PendingRequest {
  resolve: (result: unknown) => void
  reject: (error: Error) => void
  timer: NodeJS.Timeout
}

/**
 * Minimal MCP client over stdio: newline-delimited JSON-RPC 2.0, one message
 * per line in each direction (both supported backends use this framing).
 * Covers only what ax-computer needs — initialize handshake, tools/list,
 * tools/call. Server notifications and requests are ignored.
 */
export class StdioMcpClient implements McpClient {
  private readonly child: ChildProcess
  private readonly requestTimeoutMs: number
  private nextId = 1
  private readonly pending = new Map<number, PendingRequest>()
  private stdoutBuffer = ""
  private stderrTail = ""
  private exitError: McpClientError | undefined
  private readonly exited: Promise<void>
  /** serializes writes so we respect stream backpressure */
  private writePromise: Promise<void> = Promise.resolve()
  private writeError: Error | undefined

  /** spawn the server and run the initialize/initialized handshake */
  static async start(options: StdioMcpClientOptions): Promise<StdioMcpClient> {
    const client = new StdioMcpClient(options)
    try {
      await client.request("initialize", {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: {},
        clientInfo: { name: "ax-computer", version: "0.0.0" },
      })
    } catch (error) {
      await client.close()
      throw error
    }
    client.notify("notifications/initialized")
    return client
  }

  constructor(private readonly options: StdioMcpClientOptions) {
    this.requestTimeoutMs = options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS
    this.child = spawn(options.command, options.args ?? [], {
      stdio: ["pipe", "pipe", "pipe"],
      env: options.env ?? process.env,
    })
    this.exited = new Promise<void>((resolve) => {
      this.child.once("error", (error) => {
        this.exitError = new McpClientError(
          "spawn_failed",
          `failed to spawn MCP server "${options.command}": ${error.message}.${this.stderrSnippet()}`,
          { cause: error },
        )
        this.rejectAll(this.exitError)
        resolve()
      })
      this.child.once("exit", (code, signal) => {
        // a failed spawn can be followed by an exit event; keep the first error
        this.exitError ??= new McpClientError(
          "exited",
          `MCP server "${options.command}" exited (code ${code ?? "null"}, signal ${signal ?? "null"}).${this.stderrSnippet()}`,
        )
        this.rejectAll(this.exitError)
        resolve()
      })
    })
    const stdout = this.child.stdout
    const stderr = this.child.stderr
    const stdin = this.child.stdin
    if (!stdout || !stderr || !stdin) {
      throw new McpClientError("spawn_failed", `MCP server "${options.command}" did not expose piped stdio`)
    }
    // Surface stdin errors instead of swallowing them; the exit path also
    // rejects pending requests, but an EPIPE on a live stream should fail fast.
    stdin.on("error", (error) => {
      this.writeError = error instanceof Error ? error : new Error(String(error))
      this.rejectAll(new McpClientError("protocol", `MCP server stdin error: ${this.writeError.message}`))
    })
    stdout.setEncoding("utf8")
    stdout.on("data", (chunk: string) => this.onStdout(chunk))
    stderr.setEncoding("utf8")
    stderr.on("data", (chunk: string) => {
      this.stderrTail = (this.stderrTail + chunk).slice(-STDERR_TAIL_LIMIT)
    })
  }

  async listTools(): Promise<McpToolDefinition[]> {
    const result = await this.request("tools/list", {})
    const tools = (result as { tools?: unknown } | undefined)?.tools
    return Array.isArray(tools) ? (tools as McpToolDefinition[]) : []
  }

  async callTool(tool: string, args: Record<string, unknown>): Promise<McpCallToolResult> {
    const result = await this.request("tools/call", { name: tool, arguments: args })
    return (result ?? {}) as McpCallToolResult
  }

  async close(): Promise<void> {
    if (this.exitError) {
      await this.exited
      return
    }
    this.child.kill()
    const force = setTimeout(() => this.child.kill("SIGKILL"), 5_000)
    try {
      await this.exited
    } finally {
      clearTimeout(force)
    }
  }

  private request(method: string, params: Record<string, unknown>): Promise<unknown> {
    if (this.exitError) return Promise.reject(this.exitError)
    const id = this.nextId++
    return new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new McpClientError("timeout", `MCP request "${method}" timed out after ${this.requestTimeoutMs}ms`))
      }, this.requestTimeoutMs)
      this.pending.set(id, { resolve, reject, timer })
      this.write({ jsonrpc: "2.0", id, method, params }).catch((error) => {
        this.pending.delete(id)
        clearTimeout(timer)
        reject(error instanceof Error ? error : new McpClientError("protocol", String(error)))
      })
    })
  }

  private notify(method: string): void {
    if (this.exitError) return
    void this.write({ jsonrpc: "2.0", method }).catch(() => {
      // best effort; a dead child surfaces through the exit path
    })
  }

  private write(message: Record<string, unknown>): Promise<void> {
    if (this.exitError) return Promise.reject(this.exitError)
    if (this.writeError) return Promise.reject(this.writeError)

    this.writePromise = this.writePromise.then(async () => {
      if (this.exitError) throw this.exitError
      const stdin = this.child.stdin
      if (!stdin || stdin.destroyed) {
        throw new McpClientError("protocol", "MCP server stdin is closed")
      }
      const line = JSON.stringify(message) + "\n"
      const ready = stdin.write(line)
      if (!ready) {
        await new Promise<void>((resolve, reject) => {
          const onDrain = () => cleanupAndResolve()
          const onError = (err: Error) => cleanupAndReject(err)
          const cleanupAndResolve = () => {
            stdin.off("drain", onDrain)
            stdin.off("error", onError)
            resolve()
          }
          const cleanupAndReject = (err: Error) => {
            stdin.off("drain", onDrain)
            stdin.off("error", onError)
            reject(err)
          }
          stdin.once("drain", onDrain)
          stdin.once("error", onError)
        })
      }
    })

    return this.writePromise
  }

  private onStdout(chunk: string): void {
    this.stdoutBuffer += chunk
    for (;;) {
      const newline = this.stdoutBuffer.indexOf("\n")
      if (newline < 0) return
      const line = this.stdoutBuffer.slice(0, newline).trim()
      this.stdoutBuffer = this.stdoutBuffer.slice(newline + 1)
      if (line) this.onMessage(line)
    }
  }

  private onMessage(line: string): void {
    let message: Record<string, unknown>
    try {
      message = JSON.parse(line) as Record<string, unknown>
    } catch {
      // some servers print human logs to stdout; only JSON lines are messages
      return
    }
    const id = message.id
    if (typeof id !== "number") return
    const entry = this.pending.get(id)
    if (!entry) return
    this.pending.delete(id)
    clearTimeout(entry.timer)
    const rpcError = message.error as { code?: unknown; message?: unknown } | undefined
    if (rpcError) {
      entry.reject(new McpClientError("protocol", `MCP error ${rpcError.code ?? "?"}: ${rpcError.message ?? line}`))
    } else {
      entry.resolve(message.result)
    }
  }

  private rejectAll(error: McpClientError): void {
    for (const entry of this.pending.values()) {
      clearTimeout(entry.timer)
      entry.reject(error)
    }
    this.pending.clear()
  }

  private stderrSnippet(): string {
    const tail = this.stderrTail.trim()
    return tail ? ` stderr: ${tail.slice(-500)}` : ""
  }
}

// ---- provider-side result mapping helpers ----

/** concatenated text of all text content blocks */
export function mcpText(result: McpCallToolResult): string {
  return (result.content ?? [])
    .filter((block) => block.type === "text" && typeof block.text === "string")
    .map((block) => block.text)
    .join("\n")
}

/** width/height from the PNG IHDR header (big-endian u32 at bytes 16/20) */
function pngSize(base64: string): { width: number; height: number } | undefined {
  const bytes = Buffer.from(base64, "base64")
  if (bytes.length < 24 || bytes.readUInt32BE(0) !== 0x89504e47) return undefined
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) }
}

/** first image content block as a PixelImage, with dimensions decoded from the PNG header */
export function mcpImage(result: McpCallToolResult): PixelImage | undefined {
  const block = (result.content ?? []).find((block) => block.type === "image" && typeof block.data === "string")
  if (!block?.data) return undefined
  const mimeType = block.mimeType ?? "image/png"
  const size = mimeType === "image/png" ? pngSize(block.data) : undefined
  return { data: block.data, mimeType, ...size }
}

/**
 * Backend refusal code for a failed tool call. Cua surfaces codes such as
 * `background_unavailable` in structuredContent; fall back to the error text
 * so the refusal is never empty.
 */
export function mcpRefusal(result: McpCallToolResult): string {
  const structured = result.structuredContent
  if (typeof structured === "object" && structured !== null) {
    const code = (structured as Record<string, unknown>).code
    if (typeof code === "string") return code
  }
  return mcpText(result)
}

/** map an MCP tool result to the canonical ActionResult */
export function toActionResult(provider: string, action: ComputerAction, result: McpCallToolResult): ActionResult {
  if (result.isError) {
    return { ok: false, provider, action: action.type, refusal: mcpRefusal(result) }
  }
  return { ok: true, provider, action: action.type, detail: mcpText(result) || undefined }
}
