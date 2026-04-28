import { afterEach, describe, expect, test } from "bun:test"
import { EventEmitter } from "node:events"
import { Rpc } from "../../src/util/rpc"

type Endpoint = {
  onmessage: ((event: { data: string }) => void | Promise<void>) | null
  postMessage(data: string): void
}

function createRpcPair() {
  const target: Endpoint = {
    onmessage: null,
    postMessage(data) {
      queueMicrotask(() => {
        const handler = globalThis.onmessage as ((event: MessageEvent<string>) => void | Promise<void>) | null
        handler?.({ data } as MessageEvent<string>)
      })
    },
  }

  const prevOnMessage = globalThis.onmessage
  const prevPostMessage = globalThis.postMessage
  globalThis.postMessage = ((data: string) => {
    queueMicrotask(() => {
      target.onmessage?.({ data })
    })
  }) as typeof globalThis.postMessage

  return {
    target,
    restore() {
      globalThis.onmessage = prevOnMessage
      globalThis.postMessage = prevPostMessage
    },
  }
}

afterEach(() => {
  globalThis.onmessage = null
})

describe("Rpc", () => {
  test("returns successful handler results", async () => {
    const pair = createRpcPair()
    try {
      Rpc.listen({
        async plusOne(value: number) {
          return value + 1
        },
      })
      const client = Rpc.client<{ plusOne(input: number): Promise<number> }>(pair.target)

      await expect(client.call("plusOne", 1)).resolves.toBe(2)
    } finally {
      pair.restore()
    }
  })

  test("rejects immediately when the worker handler throws", async () => {
    const pair = createRpcPair()
    try {
      Rpc.listen({
        explode() {
          throw new Error("worker exploded")
        },
      })
      const client = Rpc.client<{ explode(input: undefined): Promise<void> }>(pair.target)

      await expect(client.call("explode", undefined)).rejects.toThrow("worker exploded")
    } finally {
      pair.restore()
    }
  })

  test("supports newline-framed stdio requests and event emission", async () => {
    const stdin = new EventEmitter() as EventEmitter & { setEncoding: (encoding: BufferEncoding) => typeof stdin }
    stdin.setEncoding = () => stdin
    const writes: string[] = []
    const stdout = {
      write(line: string) {
        writes.push(line)
        return true
      },
    }

    const done = Rpc.listenStdio(
      {
        async plusOne(value: number) {
          Rpc.emit("seen", value)
          return value + 1
        },
      },
      { stdin: stdin as unknown as Pick<NodeJS.ReadStream, "on" | "setEncoding">, stdout },
    )

    stdin.emit("data", JSON.stringify({ type: "rpc.request", method: "plusOne", input: 1, id: 7 }) + "\n")
    await new Promise((resolve) => setTimeout(resolve, 0))
    stdin.emit("close")
    await done

    const parsed = writes.map((line) => JSON.parse(line))
    expect(parsed).toContainEqual({ type: "rpc.event", event: "seen", data: 1 })
    expect(parsed).toContainEqual({ type: "rpc.result", result: 2, id: 7 })
  })
})
