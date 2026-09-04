import { afterEach, describe, expect, test, vi } from "vitest"
import { EventEmitter } from "node:events"
import { Rpc } from "../../src/util/rpc"

type Endpoint = {
  onmessage: ((event: { data: string }) => void | Promise<void>) | null
  onWireDeath?: (() => void) | null
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
  globalThis.onmessage = null
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

function createStdioRpcPair(definition: Parameters<typeof Rpc.listen>[0]) {
  const stdin = new EventEmitter() as EventEmitter & { setEncoding: (encoding: BufferEncoding) => typeof stdin }
  stdin.setEncoding = () => stdin
  const target: Endpoint = {
    onmessage: null,
    postMessage(data) {
      queueMicrotask(() => stdin.emit("data", data + "\n"))
    },
  }
  const stdout = {
    write(data: string) {
      queueMicrotask(() => target.onmessage?.({ data }))
      return true
    },
    on() {
      return stdout
    },
  }
  const done = Rpc.listenStdio(definition, {
    stdin: stdin as unknown as Pick<NodeJS.ReadStream, "on" | "setEncoding">,
    stdout: stdout as unknown as Pick<NodeJS.WriteStream, "write" | "on">,
  })
  return {
    target,
    async restore() {
      stdin.emit("close")
      await done
    },
  }
}

async function flushMicrotasks() {
  for (let index = 0; index < 10; index++) await Promise.resolve()
}

afterEach(() => {
  globalThis.onmessage = null
  // The Rpc namespace's `emitMessage` channel is a singleton with a
  // double-init guard (production code calls listen() OR listenStdio()
  // exactly once). Tests legitimately swap between them, so reset
  // between cases.
  Rpc._resetEmitMessageForTest()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe("Rpc", () => {
  describe.each(["worker", "stdio"] as const)("%s cancellation", (transport) => {
    function connect(definition: Parameters<typeof Rpc.listen>[0]) {
      if (transport === "stdio") return createStdioRpcPair(definition)
      const pair = createRpcPair()
      Rpc.listen(definition)
      return pair
    }

    test("rejects pre-aborted calls without dispatching", async () => {
      const run = vi.fn(() => "ok")
      const pair = connect({ run })
      try {
        const client = Rpc.client<{ run(input: undefined): string }>(pair.target)
        const controller = new AbortController()
        controller.abort()

        await expect(client.call("run", undefined, { signal: controller.signal })).rejects.toMatchObject({
          name: "AbortError",
        })
        expect(run).not.toHaveBeenCalled()
      } finally {
        await pair.restore()
      }
    })

    test("rejects promptly, cancels the server signal, and removes the deadline", async () => {
      vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] })
      const gate = Promise.withResolvers<string>()
      let serverSignal: AbortSignal | undefined
      const pair = connect({
        run(_input: undefined, context?: { signal: AbortSignal }) {
          serverSignal = context?.signal
          return gate.promise
        },
      })
      const client = Rpc.client<{ run(input: undefined): Promise<string> }>(pair.target)
      const controller = new AbortController()
      const settled = vi.fn()
      const pending = client.call("run", undefined, { signal: controller.signal }).then(settled, settled)
      try {
        await flushMicrotasks()
        controller.abort()
        await flushMicrotasks()

        expect(settled).toHaveBeenCalledWith(expect.objectContaining({ name: "AbortError" }))
        expect(serverSignal?.aborted).toBe(true)
        expect(vi.getTimerCount()).toBe(0)
      } finally {
        gate.resolve("late success")
        await pending
        await pair.restore()
      }
    })

    test("cancels server work when the RPC deadline expires", async () => {
      vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] })
      const gate = Promise.withResolvers<string>()
      let serverSignal: AbortSignal | undefined
      const pair = connect({
        run(_input: undefined, context?: { signal: AbortSignal }) {
          serverSignal = context?.signal
          return gate.promise
        },
      })
      const client = Rpc.client<{ run(input: undefined): Promise<string> }>(pair.target)
      const pending = client.call("run", undefined).catch((error: unknown) => error)
      try {
        await vi.advanceTimersByTimeAsync(60_000)

        expect(await pending).toEqual(expect.objectContaining({ message: expect.stringContaining("timed out") }))
        expect(serverSignal?.aborted).toBe(true)
        expect(vi.getTimerCount()).toBe(0)
      } finally {
        gate.resolve("late success")
        await flushMicrotasks()
        await pair.restore()
      }
    })

    test("removes cancellation listeners after success", async () => {
      const pair = connect({ run: () => "ok" })
      try {
        const client = Rpc.client<{ run(input: undefined): string }>(pair.target)
        const controller = new AbortController()
        const removeListener = vi.spyOn(controller.signal, "removeEventListener")

        await expect(client.call("run", undefined, { signal: controller.signal })).resolves.toBe("ok")

        expect(removeListener).toHaveBeenCalledWith("abort", expect.any(Function))
      } finally {
        await pair.restore()
      }
    })

    test("removes cancellation listeners after a server error", async () => {
      const pair = connect({
        run() {
          throw new Error("server failure")
        },
      })
      try {
        const client = Rpc.client<{ run(input: undefined): string }>(pair.target)
        const controller = new AbortController()
        const removeListener = vi.spyOn(controller.signal, "removeEventListener")

        await expect(client.call("run", undefined, { signal: controller.signal })).rejects.toThrow("server failure")

        expect(removeListener).toHaveBeenCalledWith("abort", expect.any(Function))
      } finally {
        await pair.restore()
      }
    })

    test("does not cancel a completed or subsequent call", async () => {
      const serverSignals: AbortSignal[] = []
      const pair = connect({
        run(_input: undefined, context: { signal: AbortSignal }) {
          serverSignals.push(context.signal)
          return "ok"
        },
      })
      try {
        const client = Rpc.client<{ run(input: undefined): string }>(pair.target)
        const controller = new AbortController()

        await client.call("run", undefined, { signal: controller.signal })
        controller.abort()
        await expect(client.call("run", undefined)).resolves.toBe("ok")

        expect(serverSignals.map((signal) => signal.aborted)).toEqual([false, false])
      } finally {
        await pair.restore()
      }
    })
  })

  test("cleans up cancellation when the wire dies", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] })
    const target: Endpoint = { onmessage: null, postMessage: vi.fn() }
    const client = Rpc.client<{ run(input: undefined): string }>(target)
    const controller = new AbortController()
    const removeListener = vi.spyOn(controller.signal, "removeEventListener")
    const pending = client.call("run", undefined, { signal: controller.signal })

    target.onWireDeath?.()

    await expect(pending).rejects.toThrow("RPC wire closed")
    expect(removeListener).toHaveBeenCalledWith("abort", expect.any(Function))
    expect(vi.getTimerCount()).toBe(0)
  })

  test("does not send a request cancelled during serialization", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] })
    const postMessage = vi.fn()
    const target: Endpoint = { onmessage: null, postMessage }
    const client = Rpc.client<{ run(input: { toJSON(): string }): string }>(target)
    const controller = new AbortController()

    await expect(
      client.call(
        "run",
        {
          toJSON() {
            controller.abort()
            return "cancelled"
          },
        },
        { signal: controller.signal },
      ),
    ).rejects.toMatchObject({ name: "AbortError" })
    expect(postMessage).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)
  })

  test("decodeWireMessage accepts only decoded object messages", () => {
    expect(Rpc.decodeWireMessage({ type: "rpc.request", id: 1 })).toEqual({ type: "rpc.request", id: 1 })
    expect(Rpc.decodeWireMessage(null)).toBeUndefined()
    expect(Rpc.decodeWireMessage([])).toBeUndefined()
    expect(Rpc.decodeWireMessage("not an object")).toBeUndefined()
  })

  test("parseWireMessage parses JSON object messages before decoding", () => {
    expect(Rpc.parseWireMessage(`  ${JSON.stringify({ type: "rpc.request", id: 1 })}\n`)).toEqual({
      type: "rpc.request",
      id: 1,
    })
    expect(Rpc.parseWireMessage("{not json")).toBeUndefined()
    expect(Rpc.parseWireMessage("")).toBeUndefined()
    expect(Rpc.parseWireMessage("[]")).toBeUndefined()
  })

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

  test("rejects new calls immediately after the transport has closed", async () => {
    const postMessage = vi.fn()
    const target: Endpoint = {
      onmessage: null,
      postMessage,
    }
    const client = Rpc.client<{ health(input: undefined): Promise<void> }>(target)

    target.onWireDeath?.()

    await expect(client.call("health", undefined)).rejects.toThrow("RPC wire closed")
    expect(postMessage).not.toHaveBeenCalled()
  })

  test("serializes unprintable worker handler failures", async () => {
    const pair = createRpcPair()
    try {
      const responses: string[] = []
      pair.target.onmessage = (event) => {
        responses.push(event.data)
      }
      Rpc.listen({
        explode() {
          throw {
            toString() {
              throw new Error("cannot print")
            },
          }
        },
      })

      const handler = globalThis.onmessage as ((event: MessageEvent<string>) => void | Promise<void>) | null
      expect(handler).toBeFunction()
      await expect(
        Promise.resolve(
          handler?.({
            data: JSON.stringify({ type: "rpc.request", method: "explode", id: 11 }),
          } as MessageEvent<string>),
        ),
      ).resolves.toBeUndefined()
      await new Promise((resolve) => setTimeout(resolve, 0))

      expect(responses.map((line) => JSON.parse(line))).toContainEqual({
        type: "rpc.error",
        id: 11,
        error: { message: "Unknown error" },
      })
    } finally {
      pair.restore()
    }
  })

  test("drops malformed and non-object worker messages without crashing", async () => {
    const pair = createRpcPair()
    try {
      Rpc.listen({
        plusOne(value: number) {
          return value + 1
        },
      })

      const handler = globalThis.onmessage as ((event: MessageEvent<string>) => void | Promise<void>) | null
      expect(handler).toBeFunction()
      await expect(Promise.resolve(handler?.({ data: "not json" } as MessageEvent<string>))).resolves.toBeUndefined()
      await expect(Promise.resolve(handler?.({ data: "null" } as MessageEvent<string>))).resolves.toBeUndefined()
      await expect(Promise.resolve(handler?.({ data: "[]" } as MessageEvent<string>))).resolves.toBeUndefined()
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
      on() {
        return stdout
      },
    }

    const done = Rpc.listenStdio(
      {
        async plusOne(value: number) {
          Rpc.emit("seen", value)
          return value + 1
        },
      },
      {
        stdin: stdin as unknown as Pick<NodeJS.ReadStream, "on" | "setEncoding">,
        stdout: stdout as unknown as Pick<NodeJS.WriteStream, "write" | "on">,
      },
    )

    stdin.emit("data", JSON.stringify({ type: "rpc.request", method: "plusOne", input: 1, id: 7 }) + "\n")
    await new Promise((resolve) => setTimeout(resolve, 0))
    stdin.emit("close")
    await done

    const parsed = writes.map((line) => JSON.parse(line))
    expect(parsed).toContainEqual({ type: "rpc.event", event: "seen", data: 1 })
    expect(parsed).toContainEqual({ type: "rpc.result", result: 2, id: 7 })
  })

  test("stdio event serialization does not fail the active request", async () => {
    const stdin = new EventEmitter() as EventEmitter & { setEncoding: (encoding: BufferEncoding) => typeof stdin }
    stdin.setEncoding = () => stdin
    const writes: string[] = []
    const stdout = {
      write(line: string) {
        writes.push(line)
        return true
      },
      on() {
        return stdout
      },
    }

    const done = Rpc.listenStdio(
      {
        async emitNonJson() {
          const data: Record<string, unknown> = { count: 1n }
          data.self = data
          Rpc.emit("non-json", data)
          return "ok"
        },
      },
      {
        stdin: stdin as unknown as Pick<NodeJS.ReadStream, "on" | "setEncoding">,
        stdout: stdout as unknown as Pick<NodeJS.WriteStream, "write" | "on">,
      },
    )

    stdin.emit("data", JSON.stringify({ type: "rpc.request", method: "emitNonJson", id: 8 }) + "\n")
    await new Promise((resolve) => setTimeout(resolve, 0))
    stdin.emit("close")
    await done

    const parsed = writes.map((line) => JSON.parse(line))
    expect(parsed).toContainEqual({
      type: "rpc.event",
      event: "non-json",
      data: { count: "1", self: "[Circular]" },
    })
    expect(parsed).toContainEqual({ type: "rpc.result", result: "ok", id: 8 })
  })
})
