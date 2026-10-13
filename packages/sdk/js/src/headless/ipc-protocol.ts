import { decode, encode } from "@msgpack/msgpack"
import type { Socket } from "node:net"

/** Length-prefixed IPC message: request, response, error, or event. */
export type IpcMessage = IpcRequestMessage | IpcResponseMessage | IpcErrorMessage | IpcEventMessage

/** IPC request frame (method, path, query, body, headers). */
export type IpcRequestMessage = {
  type: "request"
  id: string
  traceId?: string
  method: string
  path: string
  query?: Record<string, string | number | boolean | undefined>
  body?: unknown
  headers?: Record<string, string>
}

/** IPC response frame (status and optional body). */
export type IpcResponseMessage = {
  type: "response"
  id: string
  status: number
  body?: unknown
}

/** IPC error frame (code, message, optional details). */
export type IpcErrorMessage = {
  type: "error"
  id: string
  code: string
  message: string
  details?: unknown
}

/** IPC event frame wrapping a runtime event payload. */
export type IpcEventMessage = {
  type: "event"
  event: unknown
}

/** Length-prefixed msgpack frame (`Uint8Array`). */
export type IpcFrame = Uint8Array

// Upper bound on one framed IPC message; a larger advertised frame is rejected
// before any body bytes are buffered.
export const IPC_MAX_FRAME_BYTES: number = 64 * 1024 * 1024

/**
 * Error thrown when an IPC frame's length header or encoded body exceeds
 * {@link IPC_MAX_FRAME_BYTES}. Carries the offending length and the cap so
 * callers can surface the misconfiguration without re-deriving it.
 */
export class IpcFrameTooLargeError extends Error {
  readonly length: number
  readonly max: number

  constructor(length: number, max: number) {
    super(`IPC frame of ${length} bytes exceeds the maximum of ${max} bytes`)
    this.name = "IpcFrameTooLargeError"
    this.length = length
    this.max = max
  }
}

/**
 * Encode an IPC message as a length-prefixed msgpack frame.
 * Frame layout: [4-byte big-endian length][msgpack bytes].
 *
 * @throws {IpcFrameTooLargeError} when the encoded payload exceeds
 * {@link IPC_MAX_FRAME_BYTES}.
 */
export function encodeIpcMessage(message: IpcMessage): IpcFrame {
  const bytes = encode(message)
  if (bytes.length > IPC_MAX_FRAME_BYTES) throw new IpcFrameTooLargeError(bytes.length, IPC_MAX_FRAME_BYTES)
  const frame = Buffer.allocUnsafe(4 + bytes.length)
  frame.writeUInt32BE(bytes.length, 0)
  frame.set(bytes, 4)
  return frame
}

/**
 * Decode all complete frames present in `buffer`, returning the parsed messages
 * and the unconsumed tail. The tail must be prepended to the next chunk.
 *
 * @throws {IpcFrameTooLargeError} as soon as a decoded length header exceeds
 * {@link IPC_MAX_FRAME_BYTES}, before any body bytes are buffered.
 */
export function decodeIpcFrames(buffer: Buffer): {
  messages: IpcMessage[]
  remaining: Buffer
} {
  const messages: IpcMessage[] = []
  let offset = 0
  while (offset + 4 <= buffer.length) {
    const length = buffer.readUInt32BE(offset)
    if (length > IPC_MAX_FRAME_BYTES) throw new IpcFrameTooLargeError(length, IPC_MAX_FRAME_BYTES)
    const frameEnd = offset + 4 + length
    if (frameEnd > buffer.length) break
    messages.push(decode(buffer.subarray(offset + 4, frameEnd)) as IpcMessage)
    offset = frameEnd
  }
  return { messages, remaining: buffer.subarray(offset) }
}

/**
 * Async iterator that yields framed IPC messages from a Node net Socket.
 */
export async function* readIpcMessages(socket: Socket): AsyncGenerator<IpcMessage> {
  const chunks: Buffer[] = []
  let totalLength = 0
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
}

/**
 * Write a framed IPC message to a socket and return a Promise that resolves
 * when the write completes.
 */
export function writeIpcMessage(socket: Socket, message: IpcMessage): Promise<void> {
  const frame = encodeIpcMessage(message)
  return new Promise((resolve, reject) => {
    socket.write(frame, (err) => {
      if (err) reject(err)
      else resolve()
    })
  })
}
