import { randomUUID } from "node:crypto"
import { connect, type Socket } from "node:net"
import { resolve as resolvePath } from "node:path"
import { withDirectoryHeaders, withWorkspaceHeaders } from "../protocol.js"
import type { Event } from "../v2/index.js"
import type { HeadlessRuntimeCommand, HeadlessRuntimeCommandResult } from "./command.js"
import type { HeadlessTransport, HeadlessTransportRequest, HeadlessTransportSubscribeOptions } from "./transport.js"
import {
  decodeIpcFrames,
  type IpcErrorMessage,
  type IpcMessage,
  type IpcRequestMessage,
  writeIpcMessage,
} from "./ipc-protocol.js"

export type IpcTransportOptions = {
  /** Path to the Unix domain socket or `host:port` for loopback fallback. */
  socketPath: string
  directory?: string
  headers?: Record<string, string>
  experimental_workspaceID?: string
  /**
   * AbortSignal used to cancel the connection attempt. Once connected, call
   * `close()` to tear down the socket.
   */
  signal?: AbortSignal
}

export type IpcTransportConnectResult = {
  socket: Socket
  /** Async iterator of all framed messages received from the server. */
  messages: AsyncIterable<IpcMessage>
}

type IpcTransportResponse = {
  status: number
  body?: unknown
}

type IpcEventWaiter = {
  resolve: (value: IteratorResult<Event, undefined>) => void
}

type IpcEventSubscriber = {
  queue: Event[]
  resyncRequired: boolean
  waiter?: IpcEventWaiter
}

// Bound both the pre-subscription buffer and each subscriber's independent
// queue. This absorbs normal bursts without allowing request-only or stalled
// consumers to grow memory without limit.
const MAX_BUFFERED_EVENTS = 1000

export async function connectIpcTransport(options: IpcTransportOptions): Promise<IpcTransportConnectResult> {
  return new Promise((resolve, reject) => {
    if (options.signal?.aborted) {
      reject(new Error("IPC transport connection aborted"))
      return
    }

    const socket = connect(options.socketPath, () => {
      cleanup()
      resolve({ socket, messages: readMessages(socket) })
    })

    const onError = (err: Error) => {
      cleanup()
      reject(err)
    }

    const onAbort = () => {
      cleanup()
      socket.destroy()
      reject(new Error("IPC transport connection aborted"))
    }

    const cleanup = () => {
      socket.off("error", onError)
      options.signal?.removeEventListener("abort", onAbort)
    }

    socket.once("error", onError)
    options.signal?.addEventListener("abort", onAbort, { once: true })
  })
}

async function* readMessages(socket: Socket): AsyncGenerator<IpcMessage> {
  const chunks: Buffer[] = []
  let totalLength = 0
  try {
    for await (const chunk of socket) {
      const buf = chunk as Buffer
      chunks.push(buf)
      totalLength += buf.length
      // Only concatenate when we have at least a 4-byte length header.
      if (totalLength < 4) continue
      const buffer = Buffer.concat(chunks, totalLength)
      chunks.length = 0
      totalLength = 0
      const { messages, remaining } = decodeIpcFrames(buffer)
      if (remaining.length > 0) {
        chunks.push(remaining)
        totalLength = remaining.length
      }
      for (const message of messages) {
        yield message
      }
    }
  } catch (error) {
    // Socket errors surface as thrown chunks; rethrow so consumers can handle.
    throw error
  }
}

export function createIpcTransport(options: IpcTransportOptions): HeadlessTransport {
  let connection: IpcTransportConnectResult | undefined
  let pendingConnection: Promise<IpcTransportConnectResult> | undefined
  const pendingRequests = new Map<
    string,
    { resolve: (value: IpcTransportResponse) => void; reject: (error: Error) => void }
  >()
  const pendingEvents: Event[] = []
  let pendingEventsOverflowed = false
  const eventSubscribers = new Set<IpcEventSubscriber>()
  let readerPromise: Promise<void> | undefined
  let closePromise: Promise<void> | undefined
  let closed = false

  const baseHeaders = buildBaseHeaders(options)

  async function ensureConnection(): Promise<IpcTransportConnectResult> {
    if (connection) return connection
    if (pendingConnection) return pendingConnection
    pendingConnection = connectIpcTransport(options)
      .then((conn) => {
        pendingConnection = undefined
        // close() may have run while the connection was being established.
        // Destroy the late-arriving socket so it cannot leak or start a reader.
        if (closed) {
          conn.socket.destroy()
          throw new Error("IPC transport closed")
        }
        connection = conn
        startReader(conn)
        return conn
      })
      .catch((error) => {
        // Reset so the next call retries instead of returning a stale rejection.
        pendingConnection = undefined
        throw error
      })
    return pendingConnection
  }

  function startReader(conn: IpcTransportConnectResult) {
    readerPromise = (async () => {
      try {
        for await (const message of conn.messages) {
          handleMessage(message)
        }
      } catch (error) {
        failAllPending(error instanceof Error ? error : new Error(String(error)))
      } finally {
        closed = true
        failAllPending(new Error("IPC transport closed"))
      }
    })()
  }

  function handleMessage(message: IpcMessage) {
    switch (message.type) {
      case "response": {
        const pending = pendingRequests.get(message.id)
        if (!pending) return
        pendingRequests.delete(message.id)
        pending.resolve({ status: message.status, body: message.body })
        break
      }
      case "error": {
        const pending = pendingRequests.get(message.id)
        if (!pending) return
        pendingRequests.delete(message.id)
        pending.reject(new IpcTransportError(message))
        break
      }
      case "event": {
        const event = normalizeIpcEvent(message.event, options.directory)
        if (!event) return
        // The HTTP transport gives every subscribe() call an independent SSE
        // stream. Mirror that contract with a queue per IPC subscriber so a
        // slow consumer cannot lose an event to a faster consumer.
        if (eventSubscribers.size === 0) {
          pendingEventsOverflowed = bufferEvent(pendingEvents, event) || pendingEventsOverflowed
          break
        }
        for (const subscriber of eventSubscribers) {
          const waiter = subscriber.waiter
          if (waiter) waiter.resolve({ value: event, done: false })
          else subscriber.resyncRequired = bufferEvent(subscriber.queue, event) || subscriber.resyncRequired
        }
        break
      }
    }
  }

  function failAllPending(error: Error) {
    // Capture and clear before rejecting so re-entrant calls are safe.
    const requests = [...pendingRequests.values()]
    pendingRequests.clear()
    for (const pending of requests) {
      pending.reject(error)
    }
    pendingEvents.length = 0
    pendingEventsOverflowed = false
    // End waiting subscriptions cleanly rather than throwing into consumers'
    // loops. Queued events remain available so a remote EOF cannot silently
    // discard the tail of a stream.
    for (const subscriber of eventSubscribers) {
      subscriber.waiter?.resolve({ value: undefined, done: true })
    }
  }

  async function writeRequest(request: HeadlessTransportRequest): Promise<IpcTransportResponse> {
    if (closed) throw new Error("IPC transport is closed")
    const conn = await ensureConnection()
    const id = generateRequestId()
    const message: IpcRequestMessage = {
      type: "request",
      id,
      method: request.method,
      path: request.path,
      query: sanitizeQuery(request.query),
      headers: baseHeaders,
    }
    if (request.body !== undefined) {
      message.body = request.body
    }
    const responsePromise = new Promise<IpcTransportResponse>((resolve, reject) => {
      pendingRequests.set(id, { resolve, reject })
    })
    try {
      await writeIpcMessage(conn.socket, message)
    } catch (error) {
      // The request never reached the server, so no response will arrive.
      // Remove the pending entry to avoid failing it later with no observer
      // (an unhandled rejection that crashes Node >= 15).
      pendingRequests.delete(id)
      throw error
    }
    return responsePromise
  }

  const transport: HeadlessTransport = {
    async requestJson<TResult>(request: HeadlessTransportRequest): Promise<TResult> {
      const response = await writeRequest(request)
      if (!isOkStatus(response.status)) {
        throw new Error(`Headless runtime request failed (${response.status}): ${formatResponseBody(response.body)}`)
      }
      return (response.body ?? true) as TResult
    },

    async sendCommand(command: HeadlessRuntimeCommand): Promise<HeadlessRuntimeCommandResult> {
      switch (command.type) {
        case "session.prompt":
        case "session.command":
        case "session.shell": {
          const route = commandRoute(command)
          const response = await writeRequest({
            method: "POST",
            path: `/session/${encodeURIComponent(command.sessionID)}/${route}`,
            body: command.body as Record<string, unknown>,
          })
          return commandResult(response)
        }
        case "session.abort": {
          const response = await writeRequest({
            method: "POST",
            path: `/session/${encodeURIComponent(command.sessionID)}/abort`,
          })
          return commandResult(response)
        }
        case "permission.reply":
        case "question.reply": {
          const path = command.type === "permission.reply" ? "/permission/reply" : "/question/reply"
          const response = await writeRequest({
            method: "POST",
            path,
            body: command.body as Record<string, unknown>,
          })
          return commandResult(response)
        }
      }
    },

    async *subscribe(options: HeadlessTransportSubscribeOptions = {}): AsyncGenerator<Event> {
      const signal = options.signal
      if (signal?.aborted) return
      const subscriber: IpcEventSubscriber = {
        queue: pendingEvents.splice(0),
        resyncRequired: pendingEventsOverflowed,
      }
      pendingEventsOverflowed = false
      eventSubscribers.add(subscriber)
      try {
        await ensureConnection()
        while (!(signal?.aborted ?? false)) {
          if (subscriber.resyncRequired) {
            subscriber.resyncRequired = false
            yield bufferOverflowEvent()
            continue
          }
          if (subscriber.queue.length > 0) {
            yield subscriber.queue.shift()!
            continue
          }
          if (closed) break
          const next = await new Promise<IteratorResult<Event, undefined>>((resolve) => {
            const onAbort = () => finish({ value: undefined, done: true })
            const finish = (value: IteratorResult<Event, undefined>) => {
              if (subscriber.waiter?.resolve !== finish) return
              subscriber.waiter = undefined
              signal?.removeEventListener("abort", onAbort)
              resolve(value)
            }
            subscriber.waiter = { resolve: finish }
            signal?.addEventListener("abort", onAbort, { once: true })
            // Cover an abort racing between the loop condition and listener
            // registration.
            if (signal?.aborted) onAbort()
          })
          if (next.done) break
          yield next.value
        }
      } finally {
        eventSubscribers.delete(subscriber)
        subscriber.waiter?.resolve({ value: undefined, done: true })
        subscriber.queue.length = 0
      }
    },

    async close() {
      if (closePromise) return closePromise
      closePromise = (async () => {
        closed = true
        // Fail all pending callers before destroying the socket so they receive
        // a clean error rather than a raw socket destruction error from the reader.
        failAllPending(new Error("IPC transport closed"))
        // A connection may still be in flight; wait for it and destroy the
        // late-arriving socket so it cannot leak or keep the process alive.
        if (pendingConnection) {
          const conn = await pendingConnection.catch(() => undefined)
          conn?.socket.destroy()
        }
        // Do this even when the reader already observed remote EOF: close()
        // remains the idempotent owner of local socket cleanup.
        connection?.socket.destroy()
        if (readerPromise) {
          // Swallow reader termination errors; the socket is already destroyed.
          await readerPromise.catch(() => undefined)
        }
      })()
      return closePromise
    },
  }

  return transport
}

export class IpcTransportError extends Error {
  readonly code: string
  readonly details: unknown

  constructor(error: IpcErrorMessage) {
    super(error.message)
    this.name = "IpcTransportError"
    this.code = error.code
    this.details = error.details
  }
}

function generateRequestId(): string {
  return randomUUID()
}

function sanitizeQuery(query: HeadlessTransportRequest["query"]) {
  if (!query) return query
  return Object.fromEntries(Object.entries(query).filter(([, value]) => value !== undefined)) as Record<
    string,
    string | number | boolean
  >
}

function bufferEvent(queue: Event[], event: Event) {
  const overflowed = queue.length >= MAX_BUFFERED_EVENTS
  queue.push(event)
  if (queue.length > MAX_BUFFERED_EVENTS) queue.shift()
  return overflowed
}

function bufferOverflowEvent(): Event {
  return {
    type: "server.resync_required",
    properties: { reason: "buffer_overflow", cursor: "ipc:buffer_overflow" },
  }
}

function normalizeIpcEvent(value: unknown, directory?: string): Event | undefined {
  if (!isRecord(value)) return undefined

  // Older IPC servers sent the runtime event directly. Keep accepting that
  // shape before looking for the /global/event envelope.
  if (typeof value.type === "string") return value as Event

  const payload = value.payload
  if (!isRecord(payload) || typeof payload.type !== "string") return undefined
  if (directory !== undefined) {
    if (typeof value.directory !== "string" || resolvePath(value.directory) !== resolvePath(directory)) {
      return undefined
    }
  }
  return payload as Event
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}

function buildBaseHeaders(options: IpcTransportOptions): Record<string, string> {
  let headers: Record<string, string> = { ...options.headers }
  if (options.directory) {
    headers = withDirectoryHeaders(headers, options.directory)
  }
  if (options.experimental_workspaceID) {
    headers = withWorkspaceHeaders(headers, options.experimental_workspaceID)
  }
  return headers
}

function isOkStatus(status: number) {
  return status >= 200 && status < 300
}

function formatResponseBody(body: unknown) {
  if (body === undefined || body === true || body === "") return ""
  if (typeof body === "string") return body
  try {
    return JSON.stringify(body)
  } catch {
    return String(body)
  }
}

function ensureOkResponse(response: IpcTransportResponse) {
  if (!isOkStatus(response.status)) {
    throw new Error(`Headless runtime request failed (${response.status}): ${formatResponseBody(response.body)}`)
  }
}

function commandResult(response: IpcTransportResponse): HeadlessRuntimeCommandResult {
  ensureOkResponse(response)
  if (response.status === 202) return { accepted: true, status: 202 }
  return { accepted: true, status: 200, body: response.body ?? true }
}

function commandRoute(
  command: Extract<HeadlessRuntimeCommand, { type: "session.prompt" | "session.command" | "session.shell" }>,
): string {
  switch (command.type) {
    case "session.prompt":
      return command.mode === "sync" ? "message" : "prompt_async"
    case "session.command":
      return command.mode === "sync" ? "command" : "command_async"
    case "session.shell":
      return command.mode === "sync" ? "shell" : "shell_async"
  }
}
