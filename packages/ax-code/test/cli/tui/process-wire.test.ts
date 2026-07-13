import { EventEmitter } from "node:events"
import { describe, expect, test, vi } from "vitest"
import { createProcessWire } from "../../../src/cli/cmd/tui/thread"

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

  test("treats a spawn error as a dead RPC wire", () => {
    const child = createChild()
    const wire = createProcessWire(child, "test-backend")
    const onWireDeath = vi.fn()
    wire.onWireDeath = onWireDeath

    child.emit("error", new Error("spawn failed"))

    expect(onWireDeath).toHaveBeenCalledOnce()
  })
})
