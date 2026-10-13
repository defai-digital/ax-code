import { describe, expect, test, vi } from "vitest"
import { Readable } from "node:stream"
import type { Socket } from "node:net"
import {
  encodeIpcMessage,
  readIpcMessages,
  IPC_MAX_FRAME_BYTES,
  IpcFrameTooLargeError,
} from "../../src/server/ipc-protocol"

function stream(chunks: Buffer[]) {
  return Readable.from(chunks) as unknown as Socket
}

const message = { type: "response" as const, id: "fragmented", status: 200, body: "x".repeat(8192) }

describe("fragmented IPC frames", () => {
  test("copies fragmented payloads within a linear byte budget", async () => {
    const frame = Buffer.from(encodeIpcMessage(message))
    const chunks = Array.from({ length: Math.ceil(frame.length / 32) }, (_, index) =>
      frame.subarray(index * 32, (index + 1) * 32),
    )
    let copied = 0
    const copy = Buffer.prototype.copy
    const copySpy = vi.spyOn(Buffer.prototype, "copy").mockImplementation(function (
      this: Buffer,
      target,
      targetStart = 0,
      sourceStart = 0,
      sourceEnd = this.length,
    ) {
      const length = copy.call(this, target, targetStart, sourceStart, sourceEnd)
      copied += length
      return length
    })
    const original = Buffer.concat
    const spy = vi.spyOn(Buffer, "concat").mockImplementation((list, length) => {
      copied += length ?? list.reduce((sum, chunk) => sum + chunk.length, 0)
      return original(list, length)
    })
    try {
      const received = []
      for await (const value of readIpcMessages(stream(chunks))) received.push(value)
      expect(received).toEqual([message])
      expect(copied).toBeLessThanOrEqual(frame.length * 2)
    } finally {
      spy.mockRestore()
      copySpy.mockRestore()
    }
  })

  test.each([1, 3, 4, 12])("rejects EOF after %i bytes of a frame", async (length) => {
    const frame = Buffer.from(encodeIpcMessage(message))
    const iterator = readIpcMessages(stream([frame.subarray(0, length)]))
    await expect(iterator.next()).rejects.toThrow("Truncated IPC frame")
  })

  test("delivers a complete frame before rejecting a later oversized header", async () => {
    const header = Buffer.alloc(4)
    header.writeUInt32BE(IPC_MAX_FRAME_BYTES + 1)
    const iterator = readIpcMessages(stream([Buffer.concat([Buffer.from(encodeIpcMessage(message)), header])]))
    await expect(iterator.next()).resolves.toEqual({ value: message, done: false })
    await expect(iterator.next()).rejects.toBeInstanceOf(IpcFrameTooLargeError)
  })

  test("accepts split headers, coalesced frames and clean EOF", async () => {
    const frame = Buffer.from(encodeIpcMessage(message))
    const received = []
    for await (const value of readIpcMessages(
      stream([frame.subarray(0, 1), frame.subarray(1, 3), Buffer.concat([frame.subarray(3), frame])]),
    ))
      received.push(value)
    expect(received).toEqual([message, message])
  })
})
