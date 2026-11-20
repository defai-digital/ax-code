import { afterEach, expect, test, vi } from "vitest"
import { TreeSitterClient } from "../src/lib/tree-sitter/client.js"
import { clearAllDebounces } from "../src/lib/debounce.js"

// Keep worker messaging observable without starting a real parser thread.
function initializedClient() {
  const client = new TreeSitterClient({ dataPath: ".internal/test-parsers" }, { autoStartWorker: false })
  const postMessage = vi.fn()
  const state = client as any
  state.initialized = true
  state.worker = {
    postMessage,
    terminate: vi.fn(),
    onmessage: null,
    onerror: null,
  }
  state.buffers.set(1, {
    id: 1,
    content: "old",
    version: 1,
    filetype: "typescript",
    hasParser: true,
  })
  return { client, postMessage, state }
}

afterEach(() => {
  clearAllDebounces()
  vi.useRealTimers()
})

test("clients with the same buffer IDs reset independently", async () => {
  vi.useFakeTimers()
  const a = initializedClient()
  const b = initializedClient()
  await a.client.resetBuffer(1, 2, "first")
  await b.client.resetBuffer(1, 2, "second")
  await vi.advanceTimersByTimeAsync(10)
  expect(a.postMessage).toHaveBeenCalledWith(expect.objectContaining({ type: "RESET_BUFFER", content: "first" }))
  expect(b.postMessage).toHaveBeenCalledWith(expect.objectContaining({ type: "RESET_BUFFER", content: "second" }))
  await a.client.destroy()
  await b.client.destroy()
})

test("destroying one client preserves another client's pending reset", async () => {
  vi.useFakeTimers()
  const a = initializedClient()
  const b = initializedClient()
  await b.client.resetBuffer(1, 2, "second")
  await a.client.destroy()
  await vi.advanceTimersByTimeAsync(10)
  expect(b.postMessage).toHaveBeenCalledWith(expect.objectContaining({ type: "RESET_BUFFER" }))
  await b.client.destroy()
})

test("removal cancels resets before waiting for worker acknowledgement and clears its timeout", async () => {
  vi.useFakeTimers()
  const { client, postMessage, state } = initializedClient()
  await client.resetBuffer(1, 2, "removed")
  const removed = client.removeBuffer(1)
  await vi.advanceTimersByTimeAsync(20)
  expect(postMessage.mock.calls.map(([message]) => message.type)).toEqual(["DISPOSE_BUFFER"])
  state.handleWorkerMessage({ data: { type: "BUFFER_DISPOSED", bufferId: 1 } })
  await removed
  expect(vi.getTimerCount()).toBe(0)
  await client.destroy()
})

test("queued edits cannot outlive client destruction", async () => {
  const { client, postMessage } = initializedClient()
  const error = vi.spyOn(console, "error").mockImplementation(() => {})
  try {
    client.updateBuffer(1, [], "new", 2)
    await client.destroy()
    await Promise.resolve()
    expect(postMessage).not.toHaveBeenCalled()
    expect(error).not.toHaveBeenCalled()
  } finally {
    error.mockRestore()
  }
})

test("a delayed parser initialization cannot resurrect a removed buffer", async () => {
  const { client, state, postMessage } = initializedClient()
  const creating = client.createBuffer(2, "pending", "typescript")
  const init = postMessage.mock.calls.at(-1)![0]
  const removed = client.removeBuffer(2)
  state.handleWorkerMessage({
    data: {
      type: "PARSER_INIT_RESPONSE",
      messageId: init.messageId,
      bufferId: 2,
      hasParser: true,
    },
  })
  state.handleWorkerMessage({ data: { type: "BUFFER_DISPOSED", bufferId: 2 } })
  await removed
  expect(await creating).toBe(false)
  expect(client.getBuffer(2)).toBeUndefined()
  await client.destroy()
})

test("initialization send failure clears the timeout immediately", async () => {
  vi.useFakeTimers()
  const { client, state, postMessage } = initializedClient()
  state.initialized = false
  postMessage.mockImplementation(() => {
    throw new Error("worker closed")
  })
  await expect(client.initialize()).rejects.toThrow("worker closed")
  expect(vi.getTimerCount()).toBe(0)
  await client.destroy()
})

test("edits arriving before a pending reset are folded into the latest full content", async () => {
  vi.useFakeTimers()
  const { client, postMessage } = initializedClient()
  await client.resetBuffer(1, 2, "reset content")
  await client.updateBuffer(1, [], "newer content", 3)
  await vi.advanceTimersByTimeAsync(10)
  expect(postMessage.mock.calls.map(([message]) => message)).toEqual([
    expect.objectContaining({ type: "RESET_BUFFER", bufferId: 1, version: 3, content: "newer content" }),
  ])
  await client.destroy()
})

test("reset supersedes edits still waiting in the local queue", async () => {
  vi.useFakeTimers()
  const { client, postMessage } = initializedClient()
  void client.updateBuffer(1, [], "old edit", 2)
  await client.resetBuffer(1, 3, "replacement")
  await vi.advanceTimersByTimeAsync(10)
  expect(postMessage.mock.calls.map(([message]) => message.type)).toEqual(["RESET_BUFFER"])
  await client.destroy()
})

test("a buffer without a parser can be recreated under the same id", async () => {
  const { client, state, postMessage } = initializedClient()

  const failed = client.createBuffer(2, "x", "no-such-language")
  const failedInit = postMessage.mock.calls.at(-1)![0]
  state.handleWorkerMessage({
    data: { type: "PARSER_INIT_RESPONSE", messageId: failedInit.messageId, bufferId: 2, hasParser: false },
  })
  expect(await failed).toBe(false)
  expect(client.getBuffer(2)).toBeUndefined()

  const retry = client.createBuffer(2, "x", "typescript")
  const retryInit = postMessage.mock.calls.at(-1)![0]
  state.handleWorkerMessage({
    data: { type: "PARSER_INIT_RESPONSE", messageId: retryInit.messageId, bufferId: 2, hasParser: true },
  })
  expect(await retry).toBe(true)
  expect(client.getBuffer(2)?.hasParser).toBe(true)

  await client.destroy()
})

test("a worker error for a pending initialization rejects and clears the buffer", async () => {
  const { client, state, postMessage } = initializedClient()
  const creating = client.createBuffer(2, "x", "typescript")
  const init = postMessage.mock.calls.at(-1)![0]
  state.handleWorkerMessage({ data: { type: "ERROR", messageId: init.messageId, bufferId: 2, error: "boom" } })
  await expect(creating).rejects.toThrow("boom")
  expect(client.getBuffer(2)).toBeUndefined()
  await client.destroy()
})

test("a worker error for a one-shot highlight rejects the request", async () => {
  const { client, state, postMessage } = initializedClient()
  const highlighting = client.highlightOnce("x", "typescript")
  const request = postMessage.mock.calls.at(-1)![0]
  state.handleWorkerMessage({ data: { type: "ERROR", messageId: request.messageId, error: "highlight boom" } })
  await expect(highlighting).rejects.toThrow("highlight boom")
  await client.destroy()
})

test("a worker error without a message id does not discard pending requests", async () => {
  const { client, state, postMessage } = initializedClient()
  const highlighting = client.highlightOnce("x", "typescript")
  const request = postMessage.mock.calls.at(-1)![0]
  state.handleWorkerMessage({ data: { type: "ERROR", error: "background failure" } })
  state.handleWorkerMessage({
    data: { type: "ONESHOT_HIGHLIGHT_RESPONSE", messageId: request.messageId, hasParser: true, highlights: [] },
  })
  await expect(highlighting).resolves.toMatchObject({ highlights: [] })
  await client.destroy()
})

test("a failed data path update can be retried with the same path", async () => {
  const { client, state, postMessage } = initializedClient()

  const first = client.setDataPath("/bad/path")
  await Promise.resolve()
  const firstMessage = postMessage.mock.calls.at(-1)![0]
  expect(firstMessage.type).toBe("UPDATE_DATA_PATH")
  state.handleWorkerMessage({
    data: { type: "UPDATE_DATA_PATH_RESPONSE", messageId: firstMessage.messageId, error: "mkdir failed" },
  })
  await expect(first).rejects.toThrow("mkdir failed")

  const retry = client.setDataPath("/bad/path")
  await Promise.resolve()
  const retryMessage = postMessage.mock.calls.at(-1)![0]
  expect(retryMessage.type).toBe("UPDATE_DATA_PATH")
  expect(retryMessage.messageId).not.toBe(firstMessage.messageId)
  state.handleWorkerMessage({
    data: { type: "UPDATE_DATA_PATH_RESPONSE", messageId: retryMessage.messageId },
  })
  await expect(retry).resolves.toBeUndefined()

  await client.destroy()
})

test("setDataPath on an uninitialized client records the path without worker traffic", async () => {
  const { client, postMessage, state } = initializedClient()
  state.initialized = false
  await client.setDataPath("/new/path")
  expect(postMessage).not.toHaveBeenCalled()
  expect(state.options.dataPath).toBe("/new/path")
  await client.destroy()
})

test("failed initialization retires its worker and permits a fresh retry", async () => {
  const { client, state, postMessage } = initializedClient()
  state.initialized = false
  state.registerDefaultParsers = vi.fn().mockResolvedValue(undefined)
  const oldWorker = state.worker
  postMessage.mockImplementation(() => {
    throw new Error("worker closed")
  })
  await expect(client.initialize()).rejects.toThrow("worker closed")
  expect(oldWorker.terminate).toHaveBeenCalledOnce()
  expect(state.worker).toBeUndefined()
  state.worker = { postMessage: vi.fn(), terminate: vi.fn(), onmessage: null, onerror: null }
  const retry = client.initialize()
  state.handleWorkerMessage({ data: { type: "INIT_RESPONSE" } })
  await retry
  expect(client.isInitialized()).toBe(true)
  await client.destroy()
})

test("overlapping data path updates commit in call order", async () => {
  const { client, state, postMessage } = initializedClient()
  const updates = () =>
    postMessage.mock.calls.map(([message]) => message).filter((message) => message.type === "UPDATE_DATA_PATH")
  const flush = async () => {
    for (let i = 0; i < 4; i++) await Promise.resolve()
  }

  const first = client.setDataPath("/path/a")
  await flush()
  expect(updates()).toHaveLength(1)
  state.handleWorkerMessage({ data: { type: "UPDATE_DATA_PATH_RESPONSE", messageId: updates()[0].messageId } })
  await first

  const second = client.setDataPath("/path/b")
  await flush()
  expect(updates()).toHaveLength(2)

  // While /path/b is still unacknowledged, a bounce back to /path/a must queue
  // instead of early-returning against the stale committed path.
  const third = client.setDataPath("/path/a")
  await flush()
  expect(updates()).toHaveLength(2)

  state.handleWorkerMessage({ data: { type: "UPDATE_DATA_PATH_RESPONSE", messageId: updates()[1].messageId } })
  await second
  await flush()
  expect(updates()).toHaveLength(3)
  expect(updates()[2].dataPath).toBe("/path/a")

  state.handleWorkerMessage({ data: { type: "UPDATE_DATA_PATH_RESPONSE", messageId: updates()[2].messageId } })
  await third
  expect(state.options.dataPath).toBe("/path/a")
  await client.destroy()
})

test("a timed-out dispose does not consume a later dispose acknowledgement", async () => {
  vi.useFakeTimers()
  const { client, state, postMessage } = initializedClient()
  const disposed: number[] = []
  client.on("buffer:disposed", (id) => disposed.push(id))

  const first = client.removeBuffer(1)
  await vi.advanceTimersByTimeAsync(3000)
  await first

  const creating = client.createBuffer(1, "new", "typescript")
  const init = postMessage.mock.calls.at(-1)![0]
  state.handleWorkerMessage({
    data: { type: "PARSER_INIT_RESPONSE", messageId: init.messageId, bufferId: 1, hasParser: true },
  })
  expect(await creating).toBe(true)

  let secondDone = false
  const second = client.removeBuffer(1).then(() => {
    secondDone = true
  })
  await Promise.resolve()

  // The late acknowledgement for the timed-out dispose must not resolve the
  // newer dispose that reused the same buffer id.
  state.handleWorkerMessage({ data: { type: "BUFFER_DISPOSED", bufferId: 1 } })
  for (let i = 0; i < 4; i++) await Promise.resolve()
  expect(secondDone).toBe(false)

  state.handleWorkerMessage({ data: { type: "BUFFER_DISPOSED", bufferId: 1 } })
  await second
  expect(disposed).toEqual([1, 1])
  await client.destroy()
})
