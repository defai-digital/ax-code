import { createServer, type Server, type Socket } from "node:net"
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
  private eventReader: Promise<void> | undefined
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
        if (message.type === "request") {
          this.handleRequest(message).catch((error) => {
            log.error("ipc request failed", { error, requestId: message.id })
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
    this.eventReader = (async () => {
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
        if (!frame.trim()) continue
        // Collect data lines; skip comment (:) and field-only (retry:, id:, event:) lines.
        const dataLines: string[] = []
        for (const line of frame.split("\n")) {
          if (line.startsWith("data:")) {
            // Value starts after "data:" with an optional single space.
            dataLines.push(line.length > 5 && line[5] === " " ? line.slice(6) : line.slice(5))
          }
        }
        if (dataLines.length === 0) continue
        const data = dataLines.join("\n")
        try {
          yield JSON.parse(data)
        } catch {
          // Ignore malformed SSE frames.
        }
      }
    }
  } finally {
    // Cancel the reader so the upstream SSE connection is torn down,
    // not just detached — otherwise the server keeps buffering events.
    try { await reader.cancel() } catch {}
    reader.releaseLock()
  }
}
