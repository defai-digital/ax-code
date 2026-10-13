import { decode, encode } from "@msgpack/msgpack"
import type { Socket } from "node:net"

export type IpcMessage = IpcRequestMessage | IpcResponseMessage | IpcErrorMessage | IpcEventMessage

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

export type IpcResponseMessage = {
  type: "response"
  id: string
  status: number
  body?: unknown
}

export type IpcErrorMessage = {
  type: "error"
  id: string
  code: string
  message: string
  details?: unknown
}

export type IpcEventMessage = {
  type: "event"
  event: unknown
}

export type IpcFrame = Uint8Array

// Upper bound on one framed IPC message. Tool output and SSE events are capped
// far below this, so a larger advertised frame is a misbehaving or hostile peer
// and must not be buffered.
export const IPC_MAX_FRAME_BYTES = 64 * 1024 * 1024

export class IpcFrameTooLargeError extends Error {
  constructor(
    readonly length: number,
    readonly max: number,
  ) {
    super(`IPC frame of ${length} bytes exceeds the maximum of ${max} bytes`)
    this.name = "IpcFrameTooLargeError"
  }
}

export function encodeIpcMessage(message: IpcMessage): IpcFrame {
  const bytes = encode(message)
  if (bytes.length > IPC_MAX_FRAME_BYTES) throw new IpcFrameTooLargeError(bytes.length, IPC_MAX_FRAME_BYTES)
  const frame = Buffer.allocUnsafe(4 + bytes.length)
  frame.writeUInt32BE(bytes.length, 0)
  frame.set(bytes, 4)
  return frame
}

export function decodeIpcFrames(buffer: Buffer): {
  messages: IpcMessage[]
  remaining: Buffer
} {
  const messages: IpcMessage[] = []
  let offset = 0
  while (offset + 4 <= buffer.length) {
    const length = buffer.readUInt32BE(offset)
    // Reject the oversized header now, before buffering a body that will never
    // be accepted.
    if (length > IPC_MAX_FRAME_BYTES) throw new IpcFrameTooLargeError(length, IPC_MAX_FRAME_BYTES)
    const frameEnd = offset + 4 + length
    if (frameEnd > buffer.length) break
    messages.push(decode(buffer.subarray(offset + 4, frameEnd)) as IpcMessage)
    offset = frameEnd
  }
  return { messages, remaining: buffer.subarray(offset) }
}

export async function* readIpcMessages(socket: Socket): AsyncGenerator<IpcMessage> {
  const header = Buffer.allocUnsafe(4)
  let headerLength = 0
  let body: Buffer | undefined
  let bodyLength = 0
  for await (const chunk of socket) {
    const buffer = chunk as Buffer
    let offset = 0
    while (offset < buffer.length) {
      if (!body) {
        const count = Math.min(4 - headerLength, buffer.length - offset)
        buffer.copy(header, headerLength, offset, offset + count)
        headerLength += count
        offset += count
        if (headerLength < 4) continue
        const length = header.readUInt32BE(0)
        if (length > IPC_MAX_FRAME_BYTES) throw new IpcFrameTooLargeError(length, IPC_MAX_FRAME_BYTES)
        // Own one bounded body buffer. Each incoming byte is copied once,
        // and a tiny partial frame never retains a large coalesced chunk.
        body = Buffer.allocUnsafe(length)
      }
      const count = Math.min(body.length - bodyLength, buffer.length - offset)
      buffer.copy(body, bodyLength, offset, offset + count)
      bodyLength += count
      offset += count
      if (bodyLength < body.length) continue
      const message = decode(body) as IpcMessage
      body = undefined
      bodyLength = 0
      headerLength = 0
      // Deliver prior complete frames even if a later frame is malformed.
      yield message
    }
  }
  if (headerLength > 0) throw new Error("Truncated IPC frame")
}

export function writeIpcMessage(socket: Socket, message: IpcMessage): Promise<void> {
  const frame = encodeIpcMessage(message)
  return new Promise((resolve, reject) => {
    socket.write(frame, (err) => {
      if (err) reject(err)
      else resolve()
    })
  })
}
