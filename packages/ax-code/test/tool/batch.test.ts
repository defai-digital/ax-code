import { afterEach, describe, expect, test, vi } from "vitest"
import { BatchTool, withToolTimeout } from "../../src/tool/batch"
import { Session } from "../../src/session"

describe("tool.batch", () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  test("aborts the underlying tool signal when the timeout expires", async () => {
    let sawAbort = false

    await expect(
      withToolTimeout({
        tool: "slow",
        parent: new AbortController().signal,
        timeoutMs: 10,
        run(signal) {
          return new Promise((_, reject) => {
            signal.addEventListener(
              "abort",
              () => {
                sawAbort = true
                reject(signal.reason)
              },
              { once: true },
            )
          })
        },
      }),
    ).rejects.toThrow("Tool 'slow' timed out after 10ms")

    expect(sawAbort).toBe(true)
  })

  test("propagates parent aborts to the underlying tool signal", async () => {
    const parent = new AbortController()

    const pending = withToolTimeout({
      tool: "child",
      parent: parent.signal,
      timeoutMs: 1000,
      run(signal) {
        return new Promise((_, reject) => {
          signal.addEventListener("abort", () => reject(signal.reason), { once: true })
        })
      },
    })

    parent.abort(new Error("cancelled"))

    await expect(pending).rejects.toThrow("cancelled")
  })

  test("cleans up parent abort listeners when the tool throws synchronously", async () => {
    const parent = new AbortController()
    const originalRemoveEventListener = parent.signal.removeEventListener.bind(parent.signal)
    let removedAbortListeners = 0

    parent.signal.removeEventListener = ((...args: Parameters<typeof parent.signal.removeEventListener>) => {
      const [type] = args
      if (type === "abort") removedAbortListeners++
      return originalRemoveEventListener(...args)
    }) as typeof parent.signal.removeEventListener

    await expect(
      withToolTimeout({
        tool: "sync-fail",
        parent: parent.signal,
        timeoutMs: 1000,
        run() {
          throw new Error("boom")
        },
      }),
    ).rejects.toThrow("boom")

    expect(removedAbortListeners).toBe(1)
  })

  test("executes subcalls through the scoped dispatcher", async () => {
    const updatePart = vi.spyOn(Session, "updatePart").mockImplementation(async (part) => part as any)
    const attachment = {
      id: "part_attachment",
      sessionID: "ses_batch",
      messageID: "msg_batch",
      type: "file" as const,
      mime: "text/plain",
      filename: "result.txt",
      url: "data:text/plain,ok",
    }
    const execute = vi.fn(async () => ({
      title: "Read",
      output: "ok",
      metadata: {},
      attachments: [attachment],
    }))
    const batch = await BatchTool.init()

    const result = await batch.execute({ tool_calls: [{ tool: "read", parameters: { filePath: "README.md" } }] }, {
      sessionID: "ses_batch",
      messageID: "msg_batch",
      agent: "build",
      abort: new AbortController().signal,
      callID: "call_batch",
      messages: [],
      extra: { toolDispatcher: { ids: ["read"], execute } },
      metadata() {},
      async ask() {},
    } as any)

    expect(execute).toHaveBeenCalledWith(
      expect.objectContaining({
        tool: "read",
        parameters: { filePath: "README.md" },
        abort: expect.any(AbortSignal),
      }),
    )
    expect(result.metadata).toMatchObject({ totalCalls: 1, successful: 1, failed: 0 })
    expect(updatePart).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "tool",
        state: expect.objectContaining({ status: "completed", attachments: [attachment] }),
      }),
    )
  })

  test("cannot reach a tool omitted from the scoped dispatcher", async () => {
    vi.spyOn(Session, "updatePart").mockImplementation(async (part) => part as any)
    const execute = vi.fn()
    const batch = await BatchTool.init()

    const result = await batch.execute({ tool_calls: [{ tool: "bash", parameters: { command: "pwd" } }] }, {
      sessionID: "ses_batch",
      messageID: "msg_batch",
      agent: "build",
      abort: new AbortController().signal,
      callID: "call_batch",
      messages: [],
      extra: { toolDispatcher: { ids: ["read"], execute } },
      metadata() {},
      async ask() {},
    } as any)

    expect(execute).not.toHaveBeenCalled()
    expect(result.metadata).toMatchObject({ totalCalls: 1, successful: 0, failed: 1 })
  })

  describe("concurrency classification (D7)", () => {
    function batchCtx(dispatcher: {
      ids: string[]
      execute: unknown
      concurrencySafe?: (input: { tool: string; parameters: unknown }) => boolean
    }) {
      return {
        sessionID: "ses_batch",
        messageID: "msg_batch",
        agent: "build",
        abort: new AbortController().signal,
        callID: "call_batch",
        messages: [],
        extra: { toolDispatcher: dispatcher },
        metadata() {},
        async ask() {},
      } as any
    }

    test("pools consecutive calls whose tools declare concurrency safety", async () => {
      vi.spyOn(Session, "updatePart").mockImplementation(async (part) => part as any)
      const events: string[] = []
      let releaseA!: () => void
      let releaseB!: () => void
      const gateA = new Promise<void>((resolve) => (releaseA = resolve))
      const gateB = new Promise<void>((resolve) => (releaseB = resolve))
      const execute = vi.fn((input: { tool: string }) => {
        events.push(`start:${input.tool}`)
        const gate = input.tool === "probe_a" ? gateA : gateB
        return gate.then(() => {
          events.push(`end:${input.tool}`)
          return { title: input.tool, output: "ok", metadata: {} }
        })
      })
      const batch = await BatchTool.init()

      const pending = batch.execute(
        {
          tool_calls: [
            { tool: "probe_a", parameters: {} },
            { tool: "probe_b", parameters: {} },
          ],
        },
        batchCtx({ ids: ["probe_a", "probe_b"], execute, concurrencySafe: () => true }),
      )

      // Both calls must start before either resolves — proof they share the pool.
      await vi.waitFor(() => expect(events).toEqual(["start:probe_a", "start:probe_b"]))
      releaseA()
      releaseB()
      const result = await pending
      expect(result.metadata).toMatchObject({ totalCalls: 2, successful: 2, failed: 0 })
    })

    test("serializes undeclared tools as barriers between pooled safe calls", async () => {
      vi.spyOn(Session, "updatePart").mockImplementation(async (part) => part as any)
      const events: string[] = []
      let releaseSafe!: () => void
      const safeGate = new Promise<void>((resolve) => (releaseSafe = resolve))
      const execute = vi.fn(async (input: { tool: string }) => {
        events.push(`start:${input.tool}`)
        if (input.tool === "safe_a") await safeGate
        events.push(`end:${input.tool}`)
        return { title: input.tool, output: "ok", metadata: {} }
      })
      const batch = await BatchTool.init()

      const pending = batch.execute(
        {
          tool_calls: [
            { tool: "safe_a", parameters: {} },
            { tool: "unsafe_b", parameters: {} },
            { tool: "safe_c", parameters: {} },
          ],
        },
        batchCtx({
          ids: ["safe_a", "unsafe_b", "safe_c"],
          execute,
          concurrencySafe: ({ tool }) => tool.startsWith("safe"),
        }),
      )

      // The barrier must not start while the pooled safe call is still blocked.
      await vi.waitFor(() => expect(events).toEqual(["start:safe_a"]))
      await new Promise((resolve) => setTimeout(resolve, 20))
      expect(events).toEqual(["start:safe_a"])

      releaseSafe()
      const result = await pending
      expect(events).toEqual([
        "start:safe_a",
        "end:safe_a",
        "start:unsafe_b",
        "end:unsafe_b",
        "start:safe_c",
        "end:safe_c",
      ])
      expect(result.metadata).toMatchObject({ totalCalls: 3, successful: 3, failed: 0 })
    })

    test("serializes two edit calls to the same file (regression: no concurrent writes)", async () => {
      vi.spyOn(Session, "updatePart").mockImplementation(async (part) => part as any)
      let releaseFirst!: () => void
      const firstGate = new Promise<void>((resolve) => (releaseFirst = resolve))
      let calls = 0
      let active = 0
      let concurrent = false
      // The real `edit` tool declares no concurrencySafe predicate, which the
      // dispatcher surfaces as `false` — same classification used here.
      const execute = vi.fn(async () => {
        calls++
        const mine = calls
        active++
        if (active > 1) concurrent = true
        if (mine === 1) await firstGate
        active--
        return { title: "edit", output: "ok", metadata: {} }
      })
      const batch = await BatchTool.init()

      const pending = batch.execute(
        {
          tool_calls: [
            { tool: "edit", parameters: { filePath: "/tmp/same.txt", oldString: "a", newString: "b" } },
            { tool: "edit", parameters: { filePath: "/tmp/same.txt", oldString: "c", newString: "d" } },
          ],
        },
        batchCtx({ ids: ["edit"], execute, concurrencySafe: () => false }),
      )

      // The second edit must not start while the first is still blocked.
      await vi.waitFor(() => expect(calls).toBe(1))
      await new Promise((resolve) => setTimeout(resolve, 20))
      expect(calls).toBe(1)

      releaseFirst()
      const result = await pending
      expect(result.metadata).toMatchObject({ totalCalls: 2, successful: 2, failed: 0 })
      expect(concurrent).toBe(false)
    })

    test("still rejects batch and task subcalls even when the dispatcher lists them", async () => {
      vi.spyOn(Session, "updatePart").mockImplementation(async (part) => part as any)
      const execute = vi.fn(async () => ({ title: "", output: "ok", metadata: {} }))
      const batch = await BatchTool.init()

      const result = await batch.execute(
        {
          tool_calls: [
            { tool: "batch", parameters: {} },
            { tool: "task", parameters: {} },
          ],
        },
        batchCtx({ ids: ["batch", "task"], execute, concurrencySafe: () => true }),
      )

      expect(execute).not.toHaveBeenCalled()
      expect(result.metadata).toMatchObject({ totalCalls: 2, successful: 0, failed: 2 })
      expect(result.output).toContain("2 failed")
    })
  })
})
