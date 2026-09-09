import { EventEmitter } from "node:events"
import { describe, expect, test, vi } from "vitest"
import { createProcessWire } from "../../../src/cli/cmd/tui/thread"
import { Rpc } from "../../../src/util/rpc"

function createChild() {
  const child = new EventEmitter() as EventEmitter & {
    stdin: EventEmitter & { destroyed: boolean; write: (data: string) => void }
    stdout: EventEmitter & { setEncoding: (encoding: string) => void }
    stderr: EventEmitter & { setEncoding: (encoding: string) => void }
  }
  child.stdin = Object.assign(new EventEmitter(), { destroyed: false, write: vi.fn() })
  child.stdout = Object.assign(new EventEmitter(), { setEncoding: vi.fn() })
  child.stderr = Object.assign(new EventEmitter(), { setEncoding: vi.fn() })
  return child
}

describe("tui process RPC wire", () => {
  test("delivers a fragmented session transcript larger than one MiB", async () => {
    const child = createChild()
    const wire = createProcessWire(child, "test-backend")
    const client = Rpc.client<{ fetch(input: undefined): Promise<{ body: string }> }>(wire)
    const pending = client.call("fetch", undefined)
    const request = JSON.parse(vi.mocked(child.stdin.write).mock.calls[0][0])
    const body = "会话🙂".repeat(300_000)
    const response = JSON.stringify({ type: "rpc.result", id: request.id, result: { body } }) + "\n"
    const delivered = vi.fn(wire.onmessage!)
    wire.onmessage = delivered
    for (let offset = 0; offset < response.length; offset += 16_384) {
      child.stdout.emit("data", response.slice(offset, offset + 16_384))
    }
    // End the pending call even on a regression so the test does not leave a timer behind.
    const result = pending.catch(() => undefined)
    if (!delivered.mock.calls.length) child.emit("exit", 1)
    expect(delivered).toHaveBeenCalledOnce()
    expect(await result).toEqual({ body })
  })

  test("does not apply the frame limit to several complete lines in one chunk", () => {
    const child = createChild()
    const wire = createProcessWire(child, "test-backend")
    const received = vi.fn()
    wire.onmessage = received
    const frame = JSON.stringify({ type: "rpc.event", event: "message", data: "x".repeat(600_000) })
    child.stdout.emit("data", frame + "\n" + frame + "\n")
    expect(received).toHaveBeenCalledTimes(2)
    expect(received.mock.calls.map(([event]) => event.data)).toEqual([frame, frame])
  })

  test("rejects pending RPC calls as soon as the backend child exits", () => {
    const child = createChild()
    const wire = createProcessWire(child, "test-backend")
    const onWireDeath = vi.fn()
    wire.onWireDeath = onWireDeath

    child.emit("exit", 1, null)

    expect(onWireDeath).toHaveBeenCalledOnce()
    expect(wire.onmessage).toBeNull()
    expect(wire.onWireDeath).toBeNull()
  })

  test("rejects pending calls immediately when an individual frame exceeds the limit", async () => {
    const child = createChild()
    const wire = createProcessWire(child, "test-backend")
    const client = Rpc.client<{ fetch(input: undefined): Promise<void> }>(wire)
    const pending = expect(client.call("fetch", undefined)).rejects.toThrow("RPC wire closed")
    const chunk = "x".repeat(1024 * 1024)
    for (let index = 0; index < 64; index++) child.stdout.emit("data", chunk)
    expect(wire.wireClosed).toBe(false)
    child.stdout.emit("data", "x")
    await pending
    expect(wire.wireClosed).toBe(true)
    child.stdout.emit("data", '\n{"type":"rpc.result","id":1,"result":null}\n')
    expect(wire.onmessage).toBeNull()
  })

  test("preserves framing around noise, CRLF, partial tails, and empty lines", () => {
    const child = createChild()
    const wire = createProcessWire(child, "test-backend")
    const received = vi.fn()
    wire.onmessage = received
    child.stdout.emit("data", '\nnoise\n{"type":"rpc.event","event":"first"}\r\n{"type":')
    expect(received).toHaveBeenCalledOnce()
    child.stdout.emit("data", '"rpc.event","event":"second"}\n')
    expect(received.mock.calls.map(([event]) => JSON.parse(event.data).event)).toEqual(["first", "second"])
  })

  test("rejects pending calls on stdout stream failure", async () => {
    const child = createChild()
    const wire = createProcessWire(child, "test-backend")
    const client = Rpc.client<{ fetch(input: undefined): Promise<void> }>(wire)
    const pending = expect(client.call("fetch", undefined)).rejects.toThrow("RPC wire closed")
    child.stdout.emit("error", new Error("broken output pipe"))
    await pending
  })

  test("treats a spawn error as a dead RPC wire", () => {
    const child = createChild()
    const wire = createProcessWire(child, "test-backend")
    const onWireDeath = vi.fn()
    wire.onWireDeath = onWireDeath

    child.emit("error", new Error("spawn failed"))

    expect(onWireDeath).toHaveBeenCalledOnce()
  })

  test("rejects calls when the backend exits before the RPC client attaches", async () => {
    const child = createChild()
    const wire = createProcessWire(child, "test-backend")

    child.emit("exit", 1, null)

    const client = Rpc.client<{ health(input: undefined): Promise<void> }>(wire)
    await expect(client.call("health", undefined)).rejects.toThrow("RPC wire closed")
    expect(child.stdin.write).not.toHaveBeenCalled()
  })
})
