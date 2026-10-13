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

export function writeIpcMessage(socket: Socket, message: IpcMessage): Promise<void> {
  const frame = encodeIpcMessage(message)
  return new Promise((resolve, reject) => {
    socket.write(frame, (err) => {
      if (err) reject(err)
      else resolve()
    })
  })
}
