import { afterEach, expect, test, vi } from "vitest"
import { getEventListeners } from "node:events"
import { LLM } from "../../src/session/llm"
import { Provider } from "../../src/provider/provider"
import { ProviderID, ModelID } from "../../src/provider/schema"
import { SessionID, MessageID } from "../../src/session/schema"
import { MessageV2 } from "../../src/session/message-v2"
import { SessionRetry } from "../../src/session/retry"
import { resolveAxEngineSetup } from "../../src/provider/ax-engine/setup"

afterEach(() => {
  vi.restoreAllMocks()
  vi.useRealTimers()
})

function setup() {
  vi.useFakeTimers()
  const providerID = ProviderID.make("ax-engine")
  const modelID = ModelID.make("qwen3.8-27b-axq-6bit")
  const modality = { text: true, audio: false, image: false, video: false, pdf: false }
  const model: Provider.Model = {
    id: modelID,
    providerID,
    name: "Test engine",
    api: { id: modelID, url: "http://127.0.0.1:31418/v1", npm: "@ai-sdk/openai-compatible" },
    capabilities: {
      temperature: true,
      reasoning: false,
      attachment: false,
      toolcall: true,
      input: modality,
      output: modality,
      interleaved: false,
    },
    limit: { context: 65536, output: 16384 },
    status: "active",
    options: {},
    headers: {},
    release_date: "2026-09-10",
  }
  vi.spyOn(Provider, "getProvider").mockResolvedValue({
    id: providerID,
    name: "Test engine",
    source: "config",
    env: [],
    options: {},
    models: { [modelID]: model },
  })
  const caller = new AbortController()
  const entered = Promise.withResolvers<AbortSignal>()
  const load = Promise.withResolvers<Awaited<ReturnType<typeof Provider.getLanguage>>>()
  vi.spyOn(Provider, "getLanguage").mockImplementation(async (_model, context) => {
    entered.resolve(context!.signal!)
    return load.promise
  })
  const sessionID = SessionID.descending()
  const pending = LLM.stream({
    sessionID,
    model,
    user: {
      id: MessageID.ascending(),
      sessionID,
      role: "user",
      time: { created: Date.now() },
      agent: "test",
      model: { providerID, modelID },
    },
    agent: { name: "test", mode: "primary", options: {}, permission: [] },
    config: {},
    system: [],
    messages: [],
    tools: {},
    abort: caller.signal,
  }).catch((error: unknown) => error)
  return { entered, load, pending, caller, providerID }
}

test("the outer local setup timeout cancels background startup and remains non-retryable", async () => {
  const f = setup()
  const signal = await f.entered.promise
  await vi.advanceTimersByTimeAsync(300_001)
  const result = await f.pending
  const aborted = signal.aborted
  // Settle the abandoned loader even when testing the pre-fix implementation.
  f.load.reject(new Error("Late startup failure"))
  await Promise.resolve()
  expect(aborted).toBe(true)
  expect(f.caller.signal.aborted).toBe(false)
  const persisted = MessageV2.fromError(result, { providerID: f.providerID })
  expect(persisted).toMatchObject({ name: "APIError", data: { isRetryable: false } })
  expect(SessionRetry.retryable(persisted)).toBeUndefined()
  expect(getEventListeners(f.caller.signal, "abort")).toHaveLength(0)
  expect(vi.getTimerCount()).toBe(0)
})

test("user cancellation stops waiting for an uncooperative local setup without waiting for its timeout", async () => {
  const f = setup()
  await f.entered.promise
  const reason = new DOMException("User cancelled setup", "AbortError")
  f.caller.abort(reason)
  let result: unknown
  void f.pending.then((value) => {
    result = value
  })
  await vi.advanceTimersByTimeAsync(1)
  const immediate = result
  f.load.reject(new Error("Late startup failure"))
  await f.pending
  expect(immediate).toBe(reason)
  expect(vi.getTimerCount()).toBe(0)
})

test("successful setup releases its deadline and caller listener without cancelling the resident engine", async () => {
  vi.useFakeTimers()
  const caller = new AbortController()
  let owned: AbortSignal | undefined
  const result = await resolveAxEngineSetup(
    { modelID: "test", signal: caller.signal, timeoutMs: 50 },
    async (signal) => {
      owned = signal
      return "ready"
    },
  )
  expect(result).toBe("ready")
  expect(getEventListeners(caller.signal, "abort")).toHaveLength(0)
  expect(vi.getTimerCount()).toBe(0)
  caller.abort()
  await vi.advanceTimersByTimeAsync(100)
  expect(owned?.aborted).toBe(false)
})

test("a sibling setup failure cancels unfinished work with the original cause", async () => {
  const caller = new AbortController()
  const failure = new Error("Provider configuration unavailable")
  let owned: AbortSignal | undefined
  await expect(
    resolveAxEngineSetup({ modelID: "test", signal: caller.signal }, async (signal) => {
      owned = signal
      throw failure
    }),
  ).rejects.toBe(failure)
  expect(owned?.reason).toBe(failure)
  expect(caller.signal.aborted).toBe(false)
  expect(getEventListeners(caller.signal, "abort")).toHaveLength(0)
})

test("a setup result after the deadline cannot win before the timeout callback runs", async () => {
  vi.useFakeTimers()
  const caller = new AbortController()
  await expect(
    resolveAxEngineSetup({ modelID: "test", signal: caller.signal, timeoutMs: 50 }, async () => {
      vi.setSystemTime(Date.now() + 51)
      return "late ready"
    }),
  ).rejects.toMatchObject({ name: "AxEngineStartupError", data: { reason: "setup-timeout" } })
  expect(vi.getTimerCount()).toBe(0)
})

test("pre-cancelled setup never enters its loader", async () => {
  const reason = new DOMException("Cancelled", "AbortError")
  const load = vi.fn(async () => "unexpected")
  await expect(resolveAxEngineSetup({ modelID: "test", signal: AbortSignal.abort(reason) }, load)).rejects.toBe(reason)
  expect(load).not.toHaveBeenCalled()
})
