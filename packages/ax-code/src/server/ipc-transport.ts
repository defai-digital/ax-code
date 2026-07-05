import { createServer, type Socket } from "node:net"
import { isRecord } from "@/util/record"
import { Log } from "@/util/log"
import type { IpcErrorMessage, IpcMessage, IpcRequestMessage } from "./ipc-protocol"
import { readIpcMessages, writeIpcMessage } from "./ipc-protocol"

const log = Log.create({ service: "ipc-server" })

export type IpcServerHandle = {
  socketPath: string
  stop(closeActiveConnections?: boolean): Promise<void>
}

export type IpcServerOptions = {
  socketPath: string
  fetch: (request: Request) => Response | Promise<Response>
  /**
   * Optional hook invoked when the server begins listening. Use this to print
   * the readiness line for lifecycle managers.
   */
  onListening?: () => void
}

export async function listenIpc(opts: IpcServerOptions): Promise<IpcServerHandle> {
  const { socketPath, fetch, onListening } = opts
  const connections = new Set<Socket>()

  const server = createServer((socket) => {
    connections.add(socket)
    socket.once("close", () => connections.delete(socket))
    const connection = new IpcConnection(fetch, socket)
    connection.handle().catch((error) => {
      log.error("ipc connection error", { error })
    })
  })

  await new Promise<void>((resolve, reject) => {
    server.listen(socketPath, () => {
      server.off("error", onError)
      onListening?.()
      resolve()
    })
    server.once("error", onError)
    function onError(err: Error) {
      reject(err)
    }
  })

  return {
    socketPath,
    stop: async (closeActiveConnections) => {
      if (closeActiveConnections) {
        for (const socket of connections) {
          socket.destroy()
        }
        connections.clear()
      }
      return new Promise((resolve) => server.close(() => resolve()))
    },
  }
}

class IpcConnection {
  private abortController = new AbortController()
  private static readonly EVENT_RETRY_BASE_MS = 250
  private static readonly EVENT_RETRY_MAX_MS = 5_000

  constructor(
    private fetch: IpcServerOptions["fetch"],
    private socket: Socket,
  ) {}

  async handle() {
    // Start forwarding events immediately so subscribers never miss early
    // session/permission/question events.
    this.startEventSubscription()

    try {
      for await (const message of readIpcMessages(this.socket)) {
        const request = parseIpcRequestMessage(message)
        if (!request.ok) {
          log.warn("invalid ipc message ignored", { reason: request.reason })
          if (request.id) await this.writeInvalidRequest(request.id, request.reason)
          continue
        }
        const requestMessage = request.message
        if (requestMessage) {
          this.handleRequest(requestMessage).catch((error) => {
            log.error("ipc request failed", { error, requestId: requestMessage.id })
          })
        }
      }
    } catch (error) {
      log.debug("ipc connection ended", { error })
    } finally {
      this.abortController.abort()
      this.socket.destroy()
    }
  }

  private async writeInvalidRequest(id: string, reason: string) {
    const reply: IpcErrorMessage = {
      type: "error",
      id,
      code: "IPC_INVALID_REQUEST",
      message: reason,
    }
    await writeIpcMessage(this.socket, reply).catch(() => undefined)
  }

  private async handleRequest(message: IpcRequestMessage) {
    try {
      const response = await this.routeRequest(message)
      const body = await parseResponseBody(response)
      const reply: IpcMessage = {
        type: "response",
        id: message.id,
        status: response.status,
        body,
      }
      await writeIpcMessage(this.socket, reply)
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error))
      const reply: IpcErrorMessage = {
        type: "error",
        id: message.id,
        code: "IPC_REQUEST_FAILED",
        message: err.message,
      }
      await writeIpcMessage(this.socket, reply).catch(() => undefined)
    }
  }

  private routeRequest(message: IpcRequestMessage): Response | Promise<Response> {
    const url = new URL(`http://localhost${message.path}`)
    if (message.query) {
      for (const [key, value] of Object.entries(message.query)) {
        if (value !== undefined) url.searchParams.set(key, String(value))
      }
    }

    const headers = new Headers(message.headers ?? {})
    if (message.body !== undefined && !headers.has("content-type")) {
      headers.set("content-type", "application/json")
    }

    const body = message.body != null ? JSON.stringify(message.body) : undefined
    return this.fetch(
      new Request(url, {
        method: message.method,
        headers,
        body,
      }),
    )
  }

  private startEventSubscription() {
    void (async () => {
      let delay = IpcConnection.EVENT_RETRY_BASE_MS
      while (!this.abortController.signal.aborted) {
        try {
          const response = await this.fetch(
            new Request("http://localhost/global/event", {
              method: "GET",
              headers: { accept: "text/event-stream" },
            }),
          )
          if (!response.ok || !response.body) {
            log.warn("ipc event subscription rejected", { status: response.status })
            // Non-retryable: the route doesn't exist or isn't SSE.
            return
          }
          // Reset backoff on successful connection.
          delay = IpcConnection.EVENT_RETRY_BASE_MS
          for await (const event of parseSseStream(response)) {
            if (this.abortController.signal.aborted) return
            await writeIpcMessage(this.socket, { type: "event", event }).catch(() => {
              this.abortController.abort()
            })
          }
          // Stream ended cleanly (EOF) — server restarted. Reset backoff so the
          // next reconnect attempt uses the base delay, not an accumulated value.
          delay = IpcConnection.EVENT_RETRY_BASE_MS
        } catch (error) {
          if (this.abortController.signal.aborted) return
          log.debug("ipc event subscription ended, retrying", { error, delayMs: delay })
        }
        if (this.abortController.signal.aborted) return
        await new Promise<void>((resolve) => {
          const onAbort = () => {
            clearTimeout(timer)
            resolve()
          }
          const timer = setTimeout(() => {
            this.abortController.signal.removeEventListener("abort", onAbort)
            resolve()
          }, delay)
          this.abortController.signal.addEventListener("abort", onAbort, { once: true })
        })
        delay = Math.min(delay * 2, IpcConnection.EVENT_RETRY_MAX_MS)
      }
    })()
  }
}

type ParsedIpcRequest =
  | { ok: true; message?: IpcRequestMessage }
  | { ok: false; id?: string; reason: string }

function parseIpcRequestMessage(message: unknown): ParsedIpcRequest {
  if (!isRecord(message)) return { ok: false, reason: "IPC message must be an object" }
  const type = message.type
  if (type !== "request") return { ok: true }

  const id = typeof message.id === "string" ? message.id : undefined
  const invalid = (reason: string): ParsedIpcRequest => (id ? { ok: false, id, reason } : { ok: false, reason })
  if (!id) return invalid("IPC request id must be a string")
  if (typeof message.method !== "string" || message.method.length === 0) {
    return invalid("IPC request method must be a non-empty string")
  }
  if (typeof message.path !== "string" || !message.path.startsWith("/")) {
    return invalid("IPC request path must be an absolute path")
  }
  const traceId = message.traceId === null ? undefined : message.traceId
  const query = message.query === null ? undefined : message.query
  const headers = message.headers === null ? undefined : message.headers
  if (traceId !== undefined && typeof traceId !== "string") {
    return invalid("IPC request traceId must be a string")
  }
  if (query !== undefined && !isIpcQuery(query)) {
    return invalid("IPC request query must be a string, number, boolean, or undefined record")
  }
  if (headers !== undefined && !isStringRecord(headers)) {
    return invalid("IPC request headers must be a string record")
  }

  const request: IpcRequestMessage = {
    type: "request",
    id,
    method: message.method,
    path: message.path,
  }
  if (traceId !== undefined) request.traceId = traceId
  if (query !== undefined) request.query = query
  if (Object.hasOwn(message, "body")) request.body = message.body
  if (headers !== undefined) request.headers = headers

  return { ok: true, message: request }
}

function isStringRecord(value: unknown): value is Record<string, string> {
  return isRecord(value) && Object.values(value).every((entry) => typeof entry === "string")
}

function isIpcQuery(value: unknown): value is IpcRequestMessage["query"] {
  return (
    isRecord(value) &&
    Object.values(value).every(
      (entry) =>
        entry === undefined ||
        typeof entry === "string" ||
        typeof entry === "boolean" ||
        (typeof entry === "number" && Number.isFinite(entry)),
    )
  )
}

async function parseResponseBody(response: Response): Promise<unknown> {
  const text = await response.text()
  if (!text) return true
  try {
    return JSON.parse(text)
  } catch {
    return text
  }
}

async function* parseSseStream(response: Response): AsyncGenerator<unknown> {
  const reader = response.body!.getReader()
  const decoder = new TextDecoder()
  let buffer = ""
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      // SSE spec (RFC): events are separated by a blank line (\n\n or \r\n\r\n).
      // Normalise CRLF to LF so a single split works for both wire formats.
      const normalised = buffer.replace(/\r\n/g, "\n").replace(/\r/g, "\n")
      const frames = normalised.split("\n\n")
      buffer = frames.pop() ?? ""
      for (const frame of frames) {
        const event = parseSseFrame(frame)
        if (event !== undefined) yield event
      }
    }
    buffer += decoder.decode()
    if (buffer.trim()) {
      const event = parseSseFrame(buffer)
      if (event !== undefined) yield event
    }
  } finally {
    // Cancel the reader so the upstream SSE connection is torn down,
    // not just detached — otherwise the server keeps buffering events.
    try {
      await reader.cancel()
    } catch {}
    reader.releaseLock()
  }
}

function parseSseFrame(frame: string): unknown | undefined {
  if (!frame.trim()) return undefined
  // Collect data lines; skip comment (:) and field-only (retry:, id:, event:) lines.
  const dataLines: string[] = []
  for (const line of frame.split("\n")) {
    if (line.startsWith("data:")) {
      // Value starts after "data:" with an optional single space.
      dataLines.push(line.length > 5 && line[5] === " " ? line.slice(6) : line.slice(5))
    }
  }
  if (dataLines.length === 0) return undefined
  const data = dataLines.join("\n")
  try {
    return JSON.parse(data)
  } catch {
    // Ignore malformed SSE frames.
    return undefined
  }
}
