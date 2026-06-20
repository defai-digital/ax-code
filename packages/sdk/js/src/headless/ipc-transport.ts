import { connect, type Socket } from "node:net"
import type { Event } from "../v2/index.js"
import type {
  HeadlessRuntimeCommand,
  HeadlessRuntimeCommandResult,
} from "./command.js"
import type {
  HeadlessTransport,
  HeadlessTransportRequest,
  HeadlessTransportSubscribeOptions,
} from "./transport.js"
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
  let buffer: Buffer = Buffer.alloc(0)
  try {
    for await (const chunk of socket) {
      buffer = Buffer.concat([buffer, chunk as Buffer]) as Buffer
      const { messages, remaining } = decodeIpcFrames(buffer)
      buffer = remaining
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
  let pendingRequests = new Map<
    string,
    { resolve: (value: IpcTransportResponse) => void; reject: (error: Error) => void }
  >()
  let eventQueue: Event[] = []
  let eventWaiters: Array<{
    resolve: (value: IteratorResult<Event, undefined>) => void
    reject: (error: Error) => void
  }> = []
  let readerPromise: Promise<void> | undefined
  let closed = false

  const baseHeaders = buildBaseHeaders(options)

  async function ensureConnection(): Promise<IpcTransportConnectResult> {
    if (connection) return connection
    if (pendingConnection) return pendingConnection
    pendingConnection = connectIpcTransport(options).then((conn) => {
      connection = conn
      pendingConnection = undefined
      startReader(conn)
      return conn
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
        const event = message.event as Event
        const waiter = eventWaiters.shift()
        if (waiter) {
          waiter.resolve({ value: event, done: false })
        } else {
          eventQueue.push(event)
        }
        break
      }
    }
  }

  function failAllPending(error: Error) {
    for (const pending of pendingRequests.values()) {
      pending.reject(error)
    }
    pendingRequests.clear()
    for (const waiter of eventWaiters) {
      waiter.reject(error)
    }
    eventWaiters = []
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
      query: request.query,
      headers: baseHeaders,
    }
    if (request.body !== undefined) {
      message.body = request.body
    }
    const responsePromise = new Promise<IpcTransportResponse>((resolve, reject) => {
      pendingRequests.set(id, { resolve, reject })
    })
    await writeIpcMessage(conn.socket, message)
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
      await ensureConnection()
      const signal = options.signal
      while (!closed && !(signal?.aborted ?? false)) {
        if (eventQueue.length > 0) {
          yield eventQueue.shift()!
          continue
        }
        const next = await new Promise<IteratorResult<Event, undefined>>((resolve, reject) => {
          eventWaiters.push({ resolve, reject })
          signal?.addEventListener(
            "abort",
            () => {
              reject(new Error("IPC subscription aborted"))
            },
            { once: true },
          )
        })
        if (next.done) break
        yield next.value
      }
    },

    async close() {
      if (closed) return
      closed = true
      connection?.socket.destroy()
      failAllPending(new Error("IPC transport closed"))
      if (readerPromise) {
        // Swallow reader termination errors; the socket is already destroyed.
        await readerPromise.catch(() => undefined)
      }
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
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

function buildBaseHeaders(options: IpcTransportOptions): Record<string, string> {
  const headers: Record<string, string> = { ...options.headers }
  if (options.directory) {
    const encodedDirectory = /[^\x00-\x7F]/.test(options.directory)
      ? encodeURIComponent(options.directory)
      : options.directory
    headers["x-ax-code-directory"] = encodedDirectory
    headers["x-opencode-directory"] = encodedDirectory
  }
  if (options.experimental_workspaceID) {
    headers["x-ax-code-workspace-id"] = options.experimental_workspaceID
    headers["x-opencode-workspace-id"] = options.experimental_workspaceID
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
  command: Extract<
    HeadlessRuntimeCommand,
    { type: "session.prompt" | "session.command" | "session.shell" }
  >,
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
