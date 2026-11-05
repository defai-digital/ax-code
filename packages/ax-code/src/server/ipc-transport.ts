import { createServer, type Socket } from "node:net"
import { realpathSync } from "node:fs"
import { basename, dirname, join } from "node:path"
import { isRecord } from "@/util/record"
import { Log } from "@/util/log"
import { sleep } from "@/util/timeout"
import { waitForAbort } from "@/util/abort"
import type { IpcErrorMessage, IpcMessage, IpcRequestMessage } from "./ipc-protocol"
import { IpcFrameTooLargeError, readIpcMessages, writeIpcMessage } from "./ipc-protocol"

const log = Log.create({ service: "ipc-server" })

/**
 * How long the refusal reply may hold the teardown of an oversized-frame
 * connection. A peer that stopped reading never drains its receive buffer, so
 * the socket write callback never fires; the connection must still be aborted
 * and destroyed rather than held open by a courtesy message.
 */
const FRAME_TOO_LARGE_REPLY_DEADLINE_MS = 250
const MAX_SSE_FRAME_CHARACTERS = 16 * 1024 * 1024

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
  onListening?: (socketPath: string) => void
}

export function resolveIpcSocketPath(socketPath: string): string {
  try {
    return join(realpathSync(dirname(socketPath)), basename(socketPath))
  } catch {
    return socketPath
  }
}

export async function listenIpc(opts: IpcServerOptions): Promise<IpcServerHandle> {
  const { fetch, onListening } = opts
  const socketPath = resolveIpcSocketPath(opts.socketPath)
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
    function onError(err: Error) {
      reject(err)
    }
    server.once("error", onError)
    server.listen(socketPath, () => {
      // Bind failures already used once("error"). Keep a listener afterwards so
      // a later server-level 'error' is logged instead of crashing.
      server.off("error", onError)
      // @scan-suppress race_scan
      server.on("error", (error) => {
        log.error("ipc server error after listen", { error })
      })
      onListening?.(socketPath)
      resolve()
    })
  })

  return {
    socketPath,
    stop: async (_closeActiveConnections) => {
      // `server.close()` waits for every socket, while each IPC socket owns a
      // long-lived event stream. Always terminate those streams first or a
      // nominally graceful shutdown can wait forever. Keep the optional
      // argument for API compatibility; shutdown safety no longer depends on
      // callers remembering to opt in.
      for (const socket of connections) {
        socket.destroy()
      }
      connections.clear()
      return new Promise((resolve) => server.close(() => resolve()))
    },
  }
}

export class IpcConnection {
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
      if (error instanceof IpcFrameTooLargeError) {
        // A peer advertised a frame larger than the cap. Refuse it: log the
        // reason, tell the client if the write path still works, then tear the
        // connection down instead of buffering the oversized body.
        log.warn("ipc frame too large, closing connection", { length: error.length, max: error.max })
        const reply: IpcErrorMessage = {
          type: "error",
          id: "",
          code: "IPC_FRAME_TOO_LARGE",
          message: error.message,
        }
        // Best-effort: a peer that stopped reading never drains its receive
        // buffer, so this write would never call back and the teardown below
        // would never run — leaving the connection and its event subscription
        // queueing writes into unbounded memory, which is what the frame cap
        // exists to prevent.
        await Promise.race([
          writeIpcMessage(this.socket, reply).catch(() => undefined),
          sleep(FRAME_TOO_LARGE_REPLY_DEADLINE_MS),
        ])
      } else {
        log.debug("ipc connection ended", { error })
      }
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
      let lastEventID: string | undefined
      while (!this.abortController.signal.aborted) {
        const attempt = new AbortController()
        const signal = AbortSignal.any([this.abortController.signal, attempt.signal])
        let watchdog: ReturnType<typeof setTimeout> | undefined
        const resetWatchdog = (ms = 60_000) => {
          clearTimeout(watchdog)
          watchdog = setTimeout(() => attempt.abort(new Error("ipc event subscription timed out")), ms)
          watchdog.unref?.()
        }
        resetWatchdog(10_000)
        try {
          const response = await waitForAbort(
            Promise.resolve(
              this.fetch(
                new Request("http://localhost/global/event", {
                  method: "GET",
                  headers: { accept: "text/event-stream", ...(lastEventID ? { "Last-Event-ID": lastEventID } : {}) },
                  signal,
                }),
              ),
            ).then((response) => {
              if (signal.aborted) {
                void response.body?.cancel().catch(() => {})
                signal.throwIfAborted()
              }
              return response
            }),
            signal,
          )
          if (!response.ok) {
            void response.body?.cancel().catch(() => {})
            log.warn("ipc event subscription rejected", { status: response.status })
            if (response.status >= 400 && response.status < 500 && ![408, 429].includes(response.status)) return
            throw new Error(`ipc event subscription returned ${response.status}`)
          }
          if (!response.body) throw new Error("ipc event subscription returned no body")
          resetWatchdog()
          for await (const frame of parseSseStream(response, signal, {
            onActivity: resetWatchdog,
            onMetadataID: (id) => {
              lastEventID = id || undefined
            },
          })) {
            signal.throwIfAborted()
            await waitForAbort(writeIpcMessage(this.socket, { type: "event", event: frame.event }), signal).catch(
              (error) => {
                // A stalled write means this IPC peer stopped reading. Close
                // its socket instead of opening more upstream subscriptions.
                this.abortController.abort()
                this.socket.destroy()
                throw error
              },
            )
            if (frame.id !== undefined) lastEventID = frame.id || undefined
            delay = IpcConnection.EVENT_RETRY_BASE_MS
          }
        } catch (error) {
          if (this.abortController.signal.aborted) return
          log.debug("ipc event subscription ended, retrying", { error, delayMs: delay })
        } finally {
          clearTimeout(watchdog)
          attempt.abort()
        }
        if (this.abortController.signal.aborted) return
        await sleep(delay, { signal: this.abortController.signal }).catch(() => {})
        delay = Math.min(delay * 2, IpcConnection.EVENT_RETRY_MAX_MS)
      }
    })()
  }
}

type ParsedIpcRequest = { ok: true; message?: IpcRequestMessage } | { ok: false; id?: string; reason: string }

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

async function* parseSseStream(
  response: Response,
  signal: AbortSignal,
  options: { onActivity: () => void; onMetadataID: (id: string) => void },
): AsyncGenerator<{ event: unknown; id?: string }> {
  const reader = response.body!.getReader()
  const decoder = new TextDecoder()
  let buffer = ""
  let skipLF = false
  let cancelled = false
  const cancel = () => {
    if (cancelled) return
    cancelled = true
    void reader.cancel().catch(() => {})
  }
  signal.addEventListener("abort", cancel, { once: true })
  try {
    while (!signal.aborted) {
      const { done, value } = await waitForAbort(reader.read(), signal)
      if (done) break
      options.onActivity()
      let chunk = decoder.decode(value, { stream: true })
      if (chunk) {
        // A CR terminates a line immediately. If its optional LF arrives in
        // another chunk, swallow that LF instead of delaying a live CR frame.
        const leadingLF = skipLF && chunk.startsWith("\n")
        skipLF = chunk.endsWith("\r")
        if (leadingLF) chunk = chunk.slice(1)
        buffer += chunk.replace(/\r\n|\r/g, "\n")
      }
      let boundary: number
      while ((boundary = buffer.indexOf("\n\n")) >= 0) {
        checkSseFrameSize(boundary)
        const frame = buffer.slice(0, boundary)
        buffer = buffer.slice(boundary + 2)
        signal.throwIfAborted()
        const event = parseSseFrame(frame, options.onMetadataID)
        if (event !== undefined) yield event
      }
      checkSseFrameSize(buffer.length)
    }
    buffer += decoder.decode()
    checkSseFrameSize(buffer.length)
    if (!signal.aborted && buffer.trim()) {
      const event = parseSseFrame(buffer.replace(/\r\n|\r/g, "\n"), options.onMetadataID)
      if (event !== undefined) yield event
    }
  } finally {
    // Cancel the reader so the upstream SSE connection is torn down,
    // not just detached — otherwise the server keeps buffering events.
    signal.removeEventListener("abort", cancel)
    cancel()
    reader.releaseLock()
  }
}

function checkSseFrameSize(size: number): void {
  if (size > MAX_SSE_FRAME_CHARACTERS) {
    throw new Error(`IPC SSE frame exceeds the maximum of ${MAX_SSE_FRAME_CHARACTERS} characters`)
  }
}

function parseSseFrame(frame: string, onMetadataID: (id: string) => void): { event: unknown; id?: string } | undefined {
  if (!frame.trim()) return undefined
  // Collect data lines; skip comment (:) and field-only (retry:, id:, event:) lines.
  const dataLines: string[] = []
  let id: string | undefined
  for (const line of frame.split("\n")) {
    if (line === "id" || line.startsWith("id:")) {
      const value = line === "id" ? "" : line.slice(3).replace(/^ /, "")
      if (!value.includes("\0")) id = value
    }
    if (line.startsWith("data:")) {
      // Value starts after "data:" with an optional single space.
      dataLines.push(line.length > 5 && line[5] === " " ? line.slice(6) : line.slice(5))
    }
  }
  if (dataLines.length === 0) {
    if (id !== undefined) onMetadataID(id)
    return undefined
  }
  const data = dataLines.join("\n")
  try {
    return { event: JSON.parse(data), id }
  } catch {
    // Ignore malformed SSE frames.
    return undefined
  }
}
