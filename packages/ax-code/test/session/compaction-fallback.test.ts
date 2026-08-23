import { describe, expect, test, vi } from "vitest"
import { NamedError } from "@ax-code/util/error"
import { SessionCompaction } from "../../src/session/compaction"
import { CompactionFallback } from "../../src/session/compaction-fallback"
import { SessionProcessor } from "../../src/session/processor"
import { Instance } from "../../src/project/instance"
import { Log } from "../../src/util/log"
import { tmpdir } from "../fixture/fixture"
import { Session } from "../../src/session"
import { MessageV2 } from "../../src/session/message-v2"
import { ModelID, ProviderID } from "../../src/provider/schema"
import { Provider } from "../../src/provider/provider"
import { MessageID } from "../../src/session/schema"

Log.init({ print: false })

function createModel(opts: { providerID: string; modelID: string }): Provider.Model {
  return {
    id: ModelID.make(opts.modelID),
    providerID: ProviderID.make(opts.providerID),
    name: `${opts.providerID}/${opts.modelID}`,
    limit: {
      context: 100_000,
      input: 80_000,
      output: 32_000,
    },
    capabilities: {
      toolcall: true,
      attachment: false,
      reasoning: false,
      temperature: true,
      input: { text: true, image: false, audio: false, video: false },
      output: { text: true, image: false, audio: false, video: false },
    },
    api: { npm: "@ai-sdk/openai" },
    status: "active",
    options: {},
    headers: {},
    release_date: "2026-01-01",
  } as Provider.Model
}

type AttemptScript = { type: "fail"; error: () => NonNullable<MessageV2.Assistant["error"]> } | { type: "succeed" }

function apiError(input: { message: string; statusCode?: number; isRetryable: boolean }) {
  return () => new MessageV2.APIError(input).toObject()
}

/**
 * Replace SessionProcessor.create with a scripted fake. Each call records the
 * model it was created with; process() applies the script for that attempt
 * (recording a provider error on the assistant message like the real
 * processor does) and returns the matching result.
 */
function mockProcessor(script: AttemptScript[]) {
  const models: Array<{ providerID: string; modelID: string }> = []
  const spy = vi.spyOn(SessionProcessor, "create").mockImplementation((input) => {
    const attempt = models.length
    models.push({ providerID: input.model.providerID, modelID: input.model.id })
    const step = script[attempt] ?? { type: "succeed" as const }
    const fake = {
      get message() {
        return input.assistantMessage
      },
      async process() {
        if (step.type === "fail") {
          input.assistantMessage.error = step.error()
          return "stop"
        }
        return "continue"
      },
    }
    return fake as unknown as SessionProcessor.Info
  })
  return { spy, models }
}

function mockProviders(models: Record<string, Provider.Model>) {
  const getModel = vi.spyOn(Provider, "getModel").mockImplementation(async (providerID, modelID) => {
    const model = models[`${providerID}/${modelID}`]
    if (!model) throw new Error(`model not found: ${providerID}/${modelID}`)
    return model
  })
  return { getModel }
}

async function seedSession() {
  const session = await Session.create({})
  const user = await Session.updateMessage({
    id: MessageID.ascending(),
    sessionID: session.id,
    role: "user",
    time: { created: Date.now() },
    agent: "build",
    model: { providerID: ProviderID.make("test"), modelID: ModelID.make("test-model") },
    tools: {},
    mode: "build",
  } as MessageV2.User)
  return { session, user }
}

async function compactionAssistantMessages(sessionID: string) {
  const messages = await Session.messages({ sessionID: sessionID as never })
  return messages
    .map((m) => m.info)
    .filter((info): info is MessageV2.Assistant => info.role === "assistant")
    .sort((a, b) => a.time.created - b.time.created)
}

describe("session.compaction model fallback (C9)", () => {
  test("a transient provider error triggers exactly one retry down the ladder and records both attempts", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const small = createModel({ providerID: "test", modelID: "test-small" })
        const session = createModel({ providerID: "test", modelID: "test-model" })
        const smallSpy = vi.spyOn(Provider, "getSmallModel").mockResolvedValue(small)
        const { getModel } = mockProviders({ "test/test-model": session, "test/test-small": small })
        const processor = mockProcessor([
          { type: "fail", error: apiError({ message: "Service Unavailable", statusCode: 503, isRetryable: true }) },
          { type: "succeed" },
        ])
        try {
          const { session: s, user } = await seedSession()
          const result = await SessionCompaction.process({
            parentID: user.id,
            messages: await Session.messages({ sessionID: s.id }),
            sessionID: s.id,
            abort: new AbortController().signal,
            auto: true,
          })

          expect(result).toBe("continue")
          // Exactly one retry: small tier first, session model as the next rung.
          expect(processor.models).toEqual([
            { providerID: "test", modelID: "test-small" },
            { providerID: "test", modelID: "test-model" },
          ])

          // Both attempts are recorded as assistant messages; the failed one
          // carries the retryAttempt metadata.
          const assistants = await compactionAssistantMessages(s.id)
          expect(assistants).toHaveLength(2)
          const [failed, succeeded] = assistants
          expect(failed?.providerID).toBe("test")
          expect(failed?.modelID).toBe("test-small")
          expect(MessageV2.APIError.isInstance(failed?.error)).toBe(true)
          if (MessageV2.APIError.isInstance(failed?.error)) {
            expect(failed.error.data.metadata?.retryAttempt).toBe("1")
            expect(failed.error.data.metadata?.failureClass).toBe("internal_server_error")
          }
          expect(succeeded?.modelID).toBe("test-model")
          expect(succeeded?.error).toBeUndefined()
        } finally {
          processor.spy.mockRestore()
          smallSpy.mockRestore()
          getModel.mockRestore()
        }
      },
    })
  })

  test("a non-retryable error (invalid request) does not retry", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const small = createModel({ providerID: "test", modelID: "test-small" })
        const session = createModel({ providerID: "test", modelID: "test-model" })
        const smallSpy = vi.spyOn(Provider, "getSmallModel").mockResolvedValue(small)
        const { getModel } = mockProviders({ "test/test-model": session, "test/test-small": small })
        const processor = mockProcessor([
          {
            type: "fail",
            error: apiError({ message: "Invalid request: bad prompt", statusCode: 400, isRetryable: false }),
          },
          { type: "succeed" },
        ])
        try {
          const { session: s, user } = await seedSession()
          const result = await SessionCompaction.process({
            parentID: user.id,
            messages: await Session.messages({ sessionID: s.id }),
            sessionID: s.id,
            abort: new AbortController().signal,
            auto: true,
          })

          expect(result).toBe("stop")
          expect(processor.models).toEqual([{ providerID: "test", modelID: "test-small" }])

          const assistants = await compactionAssistantMessages(s.id)
          expect(assistants).toHaveLength(1)
          const failed = assistants[0]
          if (MessageV2.APIError.isInstance(failed?.error)) {
            expect(failed.error.data.metadata?.retryAttempt).toBe("1")
            expect(failed.error.data.metadata?.failureClass).toBe("invalid_request")
          } else {
            throw new Error("expected an APIError on the failed attempt")
          }
        } finally {
          processor.spy.mockRestore()
          smallSpy.mockRestore()
          getModel.mockRestore()
        }
      },
    })
  })

  test("fallback from a local provider to a cloud provider is refused", async () => {
    await using tmp = await tmpdir({
      config: {
        agent: { compaction: { model: "local/local-small" } },
      },
    })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const local = createModel({ providerID: "local", modelID: "local-small" })
        const cloud = createModel({ providerID: "cloud", modelID: "cloud-big" })
        const cloudSmall = createModel({ providerID: "cloud", modelID: "cloud-small" })
        const { getModel } = mockProviders({
          "local/local-small": local,
          "cloud/cloud-big": cloud,
          "cloud/cloud-small": cloudSmall,
        })
        const smallSpy = vi.spyOn(Provider, "getSmallModel").mockResolvedValue(cloudSmall)
        // isLocalProvider("local") resolves through Provider.list(): mark the
        // local provider by its loopback baseURL.
        const listSpy = vi.spyOn(Provider, "list").mockResolvedValue({
          local: {
            id: ProviderID.make("local"),
            name: "Local",
            source: "custom",
            env: [],
            options: { baseURL: "http://localhost:11434" },
            models: {},
          },
        } as never)
        const processor = mockProcessor([
          { type: "fail", error: apiError({ message: "Internal Server Error", statusCode: 500, isRetryable: true }) },
          { type: "succeed" },
        ])
        try {
          const session = await Session.create({})
          const user = await Session.updateMessage({
            id: MessageID.ascending(),
            sessionID: session.id,
            role: "user",
            time: { created: Date.now() },
            agent: "build",
            model: { providerID: ProviderID.make("cloud"), modelID: ModelID.make("cloud-big") },
            tools: {},
            mode: "build",
          } as MessageV2.User)

          const result = await SessionCompaction.process({
            parentID: user.id,
            messages: await Session.messages({ sessionID: session.id }),
            sessionID: session.id,
            abort: new AbortController().signal,
            auto: true,
          })

          // The pinned local model failed transiently, but the next rung is a
          // cloud provider — the privacy guard refuses the switch, so no
          // second attempt happens.
          expect(result).toBe("stop")
          expect(processor.models).toEqual([{ providerID: "local", modelID: "local-small" }])
        } finally {
          processor.spy.mockRestore()
          listSpy.mockRestore()
          smallSpy.mockRestore()
          getModel.mockRestore()
        }
      },
    })
  })

  test("caps at 2 total attempts and persists retryAttempt + final failure class on both", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const small = createModel({ providerID: "test", modelID: "test-small" })
        const session = createModel({ providerID: "test", modelID: "test-model" })
        const smallSpy = vi.spyOn(Provider, "getSmallModel").mockResolvedValue(small)
        const { getModel } = mockProviders({ "test/test-model": session, "test/test-small": small })
        const processor = mockProcessor([
          { type: "fail", error: apiError({ message: "Service Unavailable", statusCode: 503, isRetryable: true }) },
          { type: "fail", error: apiError({ message: "Bad Gateway", statusCode: 502, isRetryable: true }) },
          { type: "succeed" },
        ])
        try {
          const { session: s, user } = await seedSession()
          const result = await SessionCompaction.process({
            parentID: user.id,
            messages: await Session.messages({ sessionID: s.id }),
            sessionID: s.id,
            abort: new AbortController().signal,
            auto: true,
          })

          // Transient errors on both rungs: exactly 2 attempts, then stop.
          expect(result).toBe("stop")
          expect(processor.models).toEqual([
            { providerID: "test", modelID: "test-small" },
            { providerID: "test", modelID: "test-model" },
          ])

          const assistants = await compactionAssistantMessages(s.id)
          expect(assistants).toHaveLength(2)
          const [first, second] = assistants
          if (MessageV2.APIError.isInstance(first?.error)) {
            expect(first.error.data.metadata?.retryAttempt).toBe("1")
            expect(first.error.data.metadata?.failureClass).toBe("internal_server_error")
          } else {
            throw new Error("expected an APIError on attempt 1")
          }
          if (MessageV2.APIError.isInstance(second?.error)) {
            expect(second.error.data.metadata?.retryAttempt).toBe("2")
            expect(second.error.data.metadata?.failureClass).toBe("internal_server_error")
          } else {
            throw new Error("expected an APIError on attempt 2")
          }
        } finally {
          processor.spy.mockRestore()
          smallSpy.mockRestore()
          getModel.mockRestore()
        }
      },
    })
  })
})

describe("session.compaction-fallback classifier", () => {
  test("transient classes retry; invalid-request and context-window-exceeded never do", () => {
    const overloaded = new MessageV2.APIError({ message: "Overloaded", statusCode: 429, isRetryable: true }).toObject()
    expect(CompactionFallback.classify(overloaded)).toEqual({ class: "server_overloaded", retryable: true })

    const disconnect = new MessageV2.APIError({
      message: "Stream ended without finish event — possible network interruption",
      isRetryable: true,
    }).toObject()
    expect(CompactionFallback.classify(disconnect)).toEqual({ class: "stream_disconnect", retryable: true })

    const internal = new MessageV2.APIError({
      message: "Internal Server Error",
      statusCode: 500,
      isRetryable: true,
    }).toObject()
    expect(CompactionFallback.classify(internal)).toEqual({ class: "internal_server_error", retryable: true })

    const invalid = new MessageV2.APIError({ message: "Unauthorized", statusCode: 401, isRetryable: false }).toObject()
    expect(CompactionFallback.classify(invalid)).toEqual({ class: "invalid_request", retryable: false })

    const overflow = new MessageV2.ContextOverflowError({ message: "prompt is too long" }).toObject()
    expect(CompactionFallback.classify(overflow)).toEqual({ class: "context_window_exceeded", retryable: false })
  })

  test("permanent quota/billing errors and explicit non-retryable verdicts never retry", () => {
    // The AI SDK blanket-marks 429s isRetryable; quota exhaustion is permanent
    // and switching models does not refill the account (session/retry.ts
    // taxonomy).
    const quota = new MessageV2.APIError({
      message: "429 Quota exceeded for this account",
      statusCode: 429,
      isRetryable: true,
    }).toObject()
    expect(CompactionFallback.classify(quota)).toEqual({ class: "invalid_request", retryable: false })

    const billing = new MessageV2.APIError({
      message: "Too Many Requests",
      statusCode: 429,
      isRetryable: true,
      responseBody: "payment required",
    }).toObject()
    expect(CompactionFallback.classify(billing)).toEqual({ class: "invalid_request", retryable: false })

    // Explicit non-retryable verdict from the SDK, no permanent pattern needed.
    const sdkVerdict = new MessageV2.APIError({
      message: "rate limit",
      statusCode: 429,
      isRetryable: false,
    }).toObject()
    expect(CompactionFallback.classify(sdkVerdict)).toEqual({ class: "invalid_request", retryable: false })
  })

  test("annotate persists retry metadata on non-APIError transient shapes", () => {
    const unknown = new NamedError.Unknown({ message: "socket hang up" }).toObject()
    expect(CompactionFallback.classify(unknown)).toEqual({ class: "stream_disconnect", retryable: true })
    CompactionFallback.annotate(unknown, { retryAttempt: 1, failureClass: "stream_disconnect" })
    expect(unknown.data.metadata?.retryAttempt).toBe("1")
    expect(unknown.data.metadata?.failureClass).toBe("stream_disconnect")

    const aborted = new MessageV2.AbortedError({ message: "stream stalled" }).toObject()
    expect(CompactionFallback.classify(aborted)).toEqual({ class: "stream_disconnect", retryable: true })
    CompactionFallback.annotate(aborted, { retryAttempt: 2, failureClass: "stream_disconnect" })
    expect(aborted.data.metadata?.retryAttempt).toBe("2")

    // Shapes without a metadata record in their schema are left untouched.
    const overflow = new MessageV2.ContextOverflowError({ message: "prompt is too long" }).toObject()
    CompactionFallback.annotate(overflow, { retryAttempt: 1, failureClass: "context_window_exceeded" })
    expect("metadata" in overflow.data).toBe(false)
  })
})
