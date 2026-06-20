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

/**
 * Encode an IPC message as a length-prefixed msgpack frame.
 * Frame layout: [4-byte big-endian length][msgpack bytes].
 */
export function encodeIpcMessage(message: IpcMessage): IpcFrame {
  const bytes = encode(message)
  const frame = Buffer.allocUnsafe(4 + bytes.length)
  frame.writeUInt32BE(bytes.length, 0)
  frame.set(bytes, 4)
  return frame
}

/**
 * Decode all complete frames present in `buffer`, returning the parsed messages
 * and the unconsumed tail. The tail must be prepended to the next chunk.
 */
export function decodeIpcFrames(buffer: Buffer): {
  messages: IpcMessage[]
  remaining: Buffer
} {
  const messages: IpcMessage[] = []
  let offset = 0
  while (offset + 4 <= buffer.length) {
    const length = buffer.readUInt32BE(offset)
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
  let buffer: Buffer = Buffer.alloc(0)
  for await (const chunk of socket) {
    buffer = Buffer.concat([buffer, chunk as Buffer]) as Buffer
    const { messages, remaining } = decodeIpcFrames(buffer)
    buffer = remaining
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
