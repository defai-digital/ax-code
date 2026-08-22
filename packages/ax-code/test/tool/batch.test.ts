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
})
