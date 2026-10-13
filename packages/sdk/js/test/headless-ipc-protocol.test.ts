import { describe, expect, test } from "vitest"
import { Buffer } from "node:buffer"
import {
  decodeIpcFrames,
  encodeIpcMessage,
  IPC_MAX_FRAME_BYTES,
  IpcFrameTooLargeError,
} from "../src/headless/ipc-protocol.js"

describe("ipc protocol codec", () => {
  test("encodes and decodes a request frame", () => {
    const message = {
      type: "request" as const,
      id: "req-1",
      method: "POST",
      path: "/session",
      body: { title: "test" },
    }
    const frame = encodeIpcMessage(message)
    expect(frame.length).toBeGreaterThan(4)
    const length = Buffer.from(frame).readUInt32BE(0)
    expect(length).toBe(frame.length - 4)
    const { messages, remaining } = decodeIpcFrames(Buffer.from(frame))
    expect(remaining.length).toBe(0)
    expect(messages).toEqual([message])
  })

  test("decodes partial frames with remaining tail", () => {
    const message = {
      type: "response" as const,
      id: "req-1",
      status: 200,
      body: { id: "sess-1" },
    }
    const frame = Buffer.from(encodeIpcMessage(message))
    const partial = frame.subarray(0, frame.length - 5)
    const { messages, remaining } = decodeIpcFrames(partial)
    expect(messages).toEqual([])
    expect(remaining.length).toBe(partial.length)
  })

  test("decodes multiple frames from a single buffer", () => {
    const messages = [
      { type: "request" as const, id: "a", method: "GET", path: "/global/health" },
      { type: "response" as const, id: "a", status: 200, body: { healthy: true } },
      { type: "event" as const, event: { type: "server.connected" } },
    ]
    const buffer = Buffer.concat(messages.map((m) => Buffer.from(encodeIpcMessage(m))))
    const decoded = decodeIpcFrames(buffer)
    expect(decoded.remaining.length).toBe(0)
    expect(decoded.messages).toEqual(messages)
  })

  test("handles large payloads", () => {
    const body: Record<string, string> = {}
    for (let i = 0; i < 10_000; i++) {
      body[`key-${i}`] = "x".repeat(100)
    }
    const message = { type: "request" as const, id: "big", method: "POST", path: "/bulk", body }
    const frame = Buffer.from(encodeIpcMessage(message))
    const decoded = decodeIpcFrames(frame)
    expect(decoded.messages).toHaveLength(1)
    expect((decoded.messages[0] as { body: typeof body }).body).toEqual(body)
  })

  test("decodeIpcFrames throws when a length header exceeds the cap", () => {
    const advertised = IPC_MAX_FRAME_BYTES + 1
    const buffer = Buffer.alloc(4 + 8)
    buffer.writeUInt32BE(advertised, 0)
    // A few trailing bytes prove the decoder rejects on the header alone
    // without waiting for the body to finish.
    buffer.writeUInt32BE(0xdeadbeef, 4)
    expect(() => decodeIpcFrames(buffer)).toThrow(IpcFrameTooLargeError)
    try {
      decodeIpcFrames(buffer)
    } catch (error) {
      expect(error).toBeInstanceOf(IpcFrameTooLargeError)
      expect((error as IpcFrameTooLargeError).length).toBe(advertised)
      expect((error as IpcFrameTooLargeError).max).toBe(IPC_MAX_FRAME_BYTES)
      expect((error as Error).name).toBe("IpcFrameTooLargeError")
    }
  })

  test("encodeIpcMessage throws when the encoded payload exceeds the cap", () => {
    // msgpack encodes Buffer as bin (1 marker byte + 4 length bytes + N data bytes),
    // so a payload of exactly IPC_MAX_FRAME_BYTES bytes plus the object/key overhead
    // is guaranteed to encode past the cap.
    const message = {
      type: "request" as const,
      id: "huge",
      method: "POST",
      path: "/huge",
      body: { data: Buffer.alloc(IPC_MAX_FRAME_BYTES) },
    }
    expect(() => encodeIpcMessage(message)).toThrow(IpcFrameTooLargeError)
    try {
      encodeIpcMessage(message)
    } catch (error) {
      expect(error).toBeInstanceOf(IpcFrameTooLargeError)
      expect((error as IpcFrameTooLargeError).length).toBeGreaterThan(IPC_MAX_FRAME_BYTES)
      expect((error as IpcFrameTooLargeError).max).toBe(IPC_MAX_FRAME_BYTES)
    }
  })

  test("normal round-trip still decodes within the cap", () => {
    const message = {
      type: "request" as const,
      id: "ok",
      method: "GET",
      path: "/global/health",
    }
    const frame = Buffer.from(encodeIpcMessage(message))
    const { messages, remaining } = decodeIpcFrames(frame)
    expect(remaining.length).toBe(0)
    expect(messages).toEqual([message])
  })
})
