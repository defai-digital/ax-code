import { describe, expect, test } from "bun:test"
import path from "path"
import { SessionCompaction } from "../../src/session/compaction"
import { Token } from "../../src/util/token"
import { Instance } from "../../src/project/instance"
import { Log } from "../../src/util/log"
import { tmpdir } from "../fixture/fixture"
import { Session } from "../../src/session"
import { MessageV2 } from "../../src/session/message-v2"
import { markEstimatedUsage } from "../../src/provider/usage"
import { ModelID, ProviderID } from "../../src/provider/schema"
import type { Provider } from "../../src/provider/provider"
import { MessageID, PartID } from "../../src/session/schema"

Log.init({ print: false })

function createModel(opts: { context: number; output: number; input?: number; npm?: string }): Provider.Model {
  return {
    id: "test-model",
    providerID: "test",
    name: "Test",
    limit: {
      context: opts.context,
      input: opts.input,
      output: opts.output,
    },
    capabilities: {
      toolcall: true,
      attachment: false,
      reasoning: false,
      temperature: true,
      input: { text: true, image: false, audio: false, video: false },
      output: { text: true, image: false, audio: false, video: false },
    },
    api: { npm: opts.npm ?? "@ai-sdk/openai" },
    status: "active",
    options: {},
    headers: {},
    release_date: "2026-01-01",
  } as Provider.Model
}

describe("session.compaction.isOverflow", () => {
  test("returns true when token count exceeds usable context", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        // Default reserved = 10% of cap. cap = 100k → usable = 90k.
        const model = createModel({ context: 100_000, output: 32_000 })
        const tokens = { input: 90_000, output: 5_000, reasoning: 0, cache: { read: 0, write: 0 } }
        expect(await SessionCompaction.isOverflow({ tokens, model })).toBe(true)
      },
    })
  })

  test("returns false when token count within usable context", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const model = createModel({ context: 200_000, output: 32_000 })
        const tokens = { input: 100_000, output: 10_000, reasoning: 0, cache: { read: 0, write: 0 } }
        expect(await SessionCompaction.isOverflow({ tokens, model })).toBe(false)
      },
    })
  })

  test("includes cache.read in token count", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        // cap = 100k → usable = 90k. Total = 75k input + 10k output + 10k cache = 95k.
        const model = createModel({ context: 100_000, output: 32_000 })
        const tokens = { input: 75_000, output: 10_000, reasoning: 0, cache: { read: 10_000, write: 0 } }
        expect(await SessionCompaction.isOverflow({ tokens, model })).toBe(true)
      },
    })
  })

  test("includes reasoning tokens when total is missing or lower than components", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        // cap = 100k -> usable = 90k. Reported total is stale/low, but
        // component total is 95k once reasoning is included.
        const model = createModel({ context: 100_000, output: 32_000 })
        const tokens = {
          total: 80_000,
          input: 80_000,
          output: 0,
          reasoning: 15_000,
          cache: { read: 0, write: 0 },
        }
        expect(SessionCompaction.componentTotal(tokens)).toBe(95_000)
        expect(SessionCompaction.effectiveTotal(tokens)).toBe(95_000)
        expect(await SessionCompaction.isOverflow({ tokens, model })).toBe(true)
      },
    })
  })

  test("respects input limit for input caps", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const model = createModel({ context: 400_000, input: 272_000, output: 128_000 })
        const tokens = { input: 271_000, output: 1_000, reasoning: 0, cache: { read: 2_000, write: 0 } }
        expect(await SessionCompaction.isOverflow({ tokens, model })).toBe(true)
      },
    })
  })

  test("returns false when input/output are within input caps", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const model = createModel({ context: 400_000, input: 272_000, output: 128_000 })
        const tokens = { input: 200_000, output: 20_000, reasoning: 0, cache: { read: 10_000, write: 0 } }
        expect(await SessionCompaction.isOverflow({ tokens, model })).toBe(false)
      },
    })
  })

  test("returns false when output within limit with input caps", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const model = createModel({ context: 200_000, input: 120_000, output: 10_000 })
        const tokens = { input: 50_000, output: 9_999, reasoning: 0, cache: { read: 0, write: 0 } }
        expect(await SessionCompaction.isOverflow({ tokens, model })).toBe(false)
      },
    })
  })

  // ─── Regression tests for input-limited models (Claude + prompt caching) ─
  // Models with limit.input set (e.g. Claude with prompt caching) cap the
  // input budget below the full context window. isOverflow() honors that
  // cap: usable = max(0, (limit.input ?? context) - reserved), where
  // reserved defaults to 10% of the cap.

  test("input-limited model triggers compaction near the input boundary", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        // Simulate Claude with prompt caching: input limit = 200K.
        // cap = 200K → reserved = 20K → usable = 180K.
        const model = createModel({ context: 200_000, input: 200_000, output: 32_000 })

        const tokens = { input: 180_000, output: 15_000, reasoning: 0, cache: { read: 3_000, write: 0 } }

        expect(await SessionCompaction.isOverflow({ tokens, model })).toBe(true)
      },
    })
  })

  test("context-limited model (no limit.input) uses context - 10% as the usable budget", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        // No limit.input — cap = 200K → usable = 180K.
        const model = createModel({ context: 200_000, output: 32_000 })

        const tokens = { input: 180_000, output: 15_000, reasoning: 0, cache: { read: 3_000, write: 0 } }

        expect(await SessionCompaction.isOverflow({ tokens, model })).toBe(true)
      },
    })
  })

  test("input-limited and context-limited models agree on overflow when caps match", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        // Two models with identical caps differing only in whether
        // limit.input is explicitly set. Both reach the same decision
        // because both apply the 10% reserved fraction to the same cap.
        const withInputLimit = createModel({ context: 200_000, input: 200_000, output: 32_000 })
        const withoutInputLimit = createModel({ context: 200_000, output: 32_000 })

        // 181K total > 180K usable for both.
        const tokens = { input: 166_000, output: 10_000, reasoning: 0, cache: { read: 5_000, write: 0 } }

        const withLimit = await SessionCompaction.isOverflow({ tokens, model: withInputLimit })
        const withoutLimit = await SessionCompaction.isOverflow({ tokens, model: withoutInputLimit })

        expect(withLimit).toBe(withoutLimit)
        expect(withLimit).toBe(true)
      },
    })
  })

  test("scales to 1M context models — fires at ~900K, not at 200K", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        // Claude Opus 4.7 / Sonnet 4.6 / Gemini / Qwen 1M class.
        // cap = 1M → usable = 900K. 850K should NOT fire; 920K should.
        const model = createModel({ context: 1_000_000, output: 128_000 })

        const within = { input: 850_000, output: 0, reasoning: 0, cache: { read: 0, write: 0 } }
        const over = { input: 920_000, output: 0, reasoning: 0, cache: { read: 0, write: 0 } }

        expect(await SessionCompaction.isOverflow({ tokens: within, model })).toBe(false)
        expect(await SessionCompaction.isOverflow({ tokens: over, model })).toBe(true)
      },
    })
  })

  test("handles models where output equals context", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        // Older `context - maxOutput` formula would zero out usable here
        // and fire on every step. The 10%-reserved formula keeps a real
        // working budget.
        const model = createModel({ context: 262_144, output: 262_144 })

        const within = { input: 230_000, output: 0, reasoning: 0, cache: { read: 0, write: 0 } }
        const over = { input: 240_000, output: 0, reasoning: 0, cache: { read: 0, write: 0 } }

        expect(await SessionCompaction.isOverflow({ tokens: within, model })).toBe(false)
        expect(await SessionCompaction.isOverflow({ tokens: over, model })).toBe(true)
      },
    })
  })

  test("explicit compaction.reserved overrides the 10% default", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        await Bun.write(
          path.join(dir, "ax-code.json"),
          JSON.stringify({
            // Reserve 200K instead of 10% (= 100K). Usable = 800K.
            compaction: { reserved: 200_000 },
          }),
        )
      },
    })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const model = createModel({ context: 1_000_000, output: 128_000 })

        // 850K is within the 90% default but over the 800K configured cap.
        const tokens = { input: 850_000, output: 0, reasoning: 0, cache: { read: 0, write: 0 } }

        expect(await SessionCompaction.isOverflow({ tokens, model })).toBe(true)
      },
    })
  })

  test("disables automatic compaction when the usable budget is too small to converge", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        await Bun.write(
          path.join(dir, "ax-code.json"),
          JSON.stringify({
            compaction: { reserved: 4_200 },
          }),
        )
      },
    })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const model = createModel({ context: 5_000, output: 32 })
        const tokens = { input: 2_000, output: 0, reasoning: 0, cache: { read: 0, write: 0 } }

        expect(await SessionCompaction.budget(model)).toBeUndefined()
        expect(await SessionCompaction.isOverflow({ tokens, model })).toBe(false)
      },
    })
  })

  test("treats limit.input == 0 as unset and falls back to context", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        // Snapshot stragglers occasionally declare limit.input: 0 alongside
        // a real context window. Treat 0 as unset so the trigger is based
        // on context (cap = 200K → usable = 180K).
        const model = createModel({ context: 200_000, input: 0, output: 32_000 })

        const within = { input: 150_000, output: 0, reasoning: 0, cache: { read: 0, write: 0 } }
        const over = { input: 185_000, output: 0, reasoning: 0, cache: { read: 0, write: 0 } }

        expect(await SessionCompaction.isOverflow({ tokens: within, model })).toBe(false)
        expect(await SessionCompaction.isOverflow({ tokens: over, model })).toBe(true)
      },
    })
  })

  test("returns false when model context limit is 0", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const model = createModel({ context: 0, output: 32_000 })
        const tokens = { input: 100_000, output: 10_000, reasoning: 0, cache: { read: 0, write: 0 } }
        expect(await SessionCompaction.isOverflow({ tokens, model })).toBe(false)
      },
    })
  })

  test("returns false when compaction.auto is disabled", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        await Bun.write(
          path.join(dir, "ax-code.json"),
          JSON.stringify({
            compaction: { auto: false },
          }),
        )
      },
    })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const model = createModel({ context: 100_000, output: 32_000 })
        const tokens = { input: 75_000, output: 5_000, reasoning: 0, cache: { read: 0, write: 0 } }
        expect(await SessionCompaction.isOverflow({ tokens, model })).toBe(false)
      },
    })
  })
})

describe("util.token.estimate", () => {
  test("estimates tokens from text (4 chars per token)", () => {
    const text = "x".repeat(4000)
    expect(Token.estimate(text)).toBe(1000)
  })

  test("estimates tokens from larger text", () => {
    const text = "y".repeat(20_000)
    expect(Token.estimate(text)).toBe(5000)
  })

  test("returns 0 for empty string", () => {
    expect(Token.estimate("")).toBe(0)
  })
})

describe("session.compaction.estimateToolPartTokens", () => {
  function completedToolPart(input: Record<string, unknown>, output = "ok") {
    return {
      id: "part",
      messageID: "message",
      sessionID: "session",
      type: "tool",
      callID: "call",
      tool: "read",
      state: {
        status: "completed",
        input,
        output,
        title: "Read file",
        metadata: {},
        time: { start: 1, end: 2 },
      },
    } as any
  }

  test("counts serialized tool input, not only output", () => {
    const small = completedToolPart({ filePath: "README.md" }, "same")
    const largeInput = completedToolPart({ filePath: "README.md", pattern: "x".repeat(4000) }, "same")

    expect(SessionCompaction.estimateToolPartTokens(largeInput)).toBeGreaterThan(
      SessionCompaction.estimateToolPartTokens(small) + 900,
    )
  })

  test("counts attachment placeholders", () => {
    const plain = completedToolPart({ filePath: "image.png" }, "same")
    const withAttachment = {
      ...plain,
      state: {
        ...plain.state,
        attachments: [
          {
            id: "file",
            messageID: "message",
            sessionID: "session",
            type: "file",
            mime: "image/png",
            filename: "screenshot.png",
            url: "data:image/png;base64,AA==",
          },
        ],
      },
    } as any

    expect(SessionCompaction.estimateToolPartTokens(withAttachment)).toBeGreaterThan(
      SessionCompaction.estimateToolPartTokens(plain),
    )
  })

  test("prune uses compacted clones without mutating caller-owned message parts", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        await Bun.write(path.join(dir, "ax-code.json"), JSON.stringify({ compaction: { prune: true } }))
      },
    })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
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
        const assistant = await Session.updateMessage({
          id: MessageID.ascending(),
          parentID: user.id,
          sessionID: session.id,
          role: "assistant",
          mode: "build",
          agent: "build",
          path: { cwd: tmp.path, root: tmp.path },
          tokens: {
            input: 0,
            output: 0,
            reasoning: 0,
            cache: { read: 0, write: 0 },
          },
          modelID: ModelID.make("test-model"),
          providerID: ProviderID.make("test"),
          time: { created: Date.now() },
        } as MessageV2.Assistant)
        await Session.updatePart({
          id: PartID.ascending(),
          messageID: assistant.id,
          sessionID: session.id,
          type: "tool",
          callID: "call",
          tool: "read",
          state: {
            status: "completed",
            input: { filePath: "large.txt" },
            output: "x".repeat(260_000),
            title: "Read file",
            metadata: {},
            time: { start: 1, end: 2 },
          },
        })

        const messages = await Session.messages({ sessionID: session.id })
        const part = messages
          .flatMap((message) => message.parts)
          .find((item): item is MessageV2.ToolPart => item.type === "tool")
        expect(part?.state.status).toBe("completed")
        if (!part || part.state.status !== "completed") throw new Error("expected completed tool part")
        expect(SessionCompaction.estimateToolPartTokens(part)).toBeGreaterThan(SessionCompaction.PRUNE_PROTECT)

        await SessionCompaction.prune({ sessionID: session.id, messages })

        expect(part.state.time.compacted).toBeUndefined()
      },
    })
  })
})

describe("session.compaction.process busy semantics", () => {
  test("returns 'busy' when a second concurrent process for the same session overlaps the first", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({})
        // The compaction process internally checks `inFlight.has(sessionID)`
        // and returns "busy" without doing work. We exercise the in-flight
        // gate directly by launching two calls in parallel. Both calls go
        // through with an empty message list, so the inner work returns
        // quickly without exercising LLM/db state — what we're pinning is
        // the busy gate, not the compaction algorithm itself.
        const ac = new AbortController()
        const messages: MessageV2.WithParts[] = []
        const parentID = MessageID.make("msg_busy_test_parent")
        const first = SessionCompaction.process({
          parentID,
          messages,
          sessionID: session.id,
          abort: ac.signal,
          auto: true,
        }).catch((err) => ({ error: err }) as const)
        const second = SessionCompaction.process({
          parentID,
          messages,
          sessionID: session.id,
          abort: ac.signal,
          auto: true,
        }).catch((err) => ({ error: err }) as const)
        const [a, b] = await Promise.all([first, second])
        // Exactly one call should observe in-flight and return "busy"
        // without doing work. The other actually enters processInner
        // and runs the compaction (which in this minimal fixture fails
        // because no parent message exists — we only care about the
        // busy gate, not the algorithm).
        const results = [a, b]
        const busy = results.filter((r) => r === "busy").length
        expect(busy).toBe(1)
      },
    })
  })

  test("clears the in-flight gate after process resolves", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({})
        const ac = new AbortController()
        const messages: MessageV2.WithParts[] = []
        const parentID = MessageID.make("msg_busy_test_parent2")
        // First call resolves (with an error in this fixture, fine).
        await SessionCompaction.process({
          parentID,
          messages,
          sessionID: session.id,
          abort: ac.signal,
          auto: true,
        }).catch(() => undefined)
        // After the first completes, the in-flight gate must be cleared
        // so a subsequent call is no longer "busy".
        const second = await SessionCompaction.process({
          parentID,
          messages,
          sessionID: session.id,
          abort: ac.signal,
          auto: true,
        }).catch((err) => ({ error: err }) as const)
        // Second call ran (errored, but not "busy"). If the gate had
        // leaked, we'd see "busy" here.
        expect(second).not.toBe("busy")
      },
    })
  })
})

describe("session.compaction observability", () => {
  test("logs compaction trigger reason without prompt content", async () => {
    const lines: string[] = []
    await Log.init({ print: true, level: "INFO" }, { stderrWrite: (line) => lines.push(line) })
    try {
      await using tmp = await tmpdir()
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const session = await Session.create({})
          await SessionCompaction.create({
            sessionID: session.id,
            agent: "build",
            model: {
              providerID: ProviderID.make("test"),
              modelID: ModelID.make("test-model"),
            },
            auto: true,
            triggerReason: "prompt_preflight",
          })
        },
      })

      const output = lines.join("")
      expect(output).toContain("command=session.compaction.create")
      expect(output).toContain("triggerReason=prompt_preflight")
      expect(output).not.toContain("secret prompt")
    } finally {
      await Log.init({ print: false })
    }
  })
})

describe("session.getUsage", () => {
  test("normalizes standard usage to token format", () => {
    const model = createModel({ context: 100_000, output: 32_000 })
    const result = Session.getUsage({
      model,
      usage: {
        inputTokens: 1000,
        outputTokens: 500,
        totalTokens: 1500,
      },
    })

    expect(result.tokens.input).toBe(1000)
    expect(result.tokens.output).toBe(500)
    expect(result.tokens.reasoning).toBe(0)
    expect(result.tokens.cache.read).toBe(0)
    expect(result.tokens.cache.write).toBe(0)
    expect(result.source).toBe("exact")
  })

  test("classifies estimated and missing usage sources", () => {
    const model = createModel({ context: 100_000, output: 32_000 })
    const estimated = Session.getUsage({
      model,
      usage: markEstimatedUsage({
        inputTokens: { total: 100, noCache: 100, cacheRead: 0, cacheWrite: 0 },
        outputTokens: { total: 20, text: 20, reasoning: 0 },
      } as any),
    })
    const missing = Session.getUsage({
      model,
      usage: { inputTokens: 0, outputTokens: 0 } as any,
    })

    expect(estimated.source).toBe("estimated")
    expect(missing.source).toBe("missing")
  })

  test("extracts cached tokens to cache.read", () => {
    const model = createModel({ context: 100_000, output: 32_000 })
    const result = Session.getUsage({
      model,
      usage: {
        inputTokens: 1000,
        outputTokens: 500,
        totalTokens: 1500,
        cachedInputTokens: 200,
      },
    })

    expect(result.tokens.input).toBe(800)
    expect(result.tokens.cache.read).toBe(200)
  })

  test("handles anthropic cache write metadata", () => {
    const model = createModel({ context: 100_000, output: 32_000 })
    const result = Session.getUsage({
      model,
      usage: {
        inputTokens: 1000,
        outputTokens: 500,
        totalTokens: 1500,
      },
      metadata: {
        anthropic: {
          cacheCreationInputTokens: 300,
        },
      },
    })

    expect(result.tokens.cache.write).toBe(300)
  })

  test("does not subtract cached tokens for anthropic provider", () => {
    const model = createModel({ context: 100_000, output: 32_000 })
    const result = Session.getUsage({
      model,
      usage: {
        inputTokens: 1000,
        outputTokens: 500,
        totalTokens: 1500,
        cachedInputTokens: 200,
      },
      metadata: {
        anthropic: {},
      },
    })

    expect(result.tokens.input).toBe(1000)
    expect(result.tokens.cache.read).toBe(200)
  })

  test("handles reasoning tokens", () => {
    const model = createModel({ context: 100_000, output: 32_000 })
    const result = Session.getUsage({
      model,
      usage: {
        inputTokens: 1000,
        outputTokens: 500,
        totalTokens: 1500,
        reasoningTokens: 100,
      },
    })

    expect(result.tokens.reasoning).toBe(100)
    expect(result.tokens.total).toBe(1600)
  })

  test("computes conservative total when totalTokens is missing", () => {
    const model = createModel({ context: 100_000, output: 32_000 })
    const result = Session.getUsage({
      model,
      usage: {
        inputTokens: 1000,
        outputTokens: 500,
        reasoningTokens: 100,
      } as any,
    })

    expect(result.tokens.input).toBe(1000)
    expect(result.tokens.output).toBe(500)
    expect(result.tokens.reasoning).toBe(100)
    expect(result.tokens.total).toBe(1600)
  })

  test("handles undefined optional values gracefully", () => {
    const model = createModel({ context: 100_000, output: 32_000 })
    const result = Session.getUsage({
      model,
      usage: {
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
      },
    })

    expect(result.tokens.input).toBe(0)
    expect(result.tokens.output).toBe(0)
    expect(result.tokens.reasoning).toBe(0)
    expect(result.tokens.cache.read).toBe(0)
    expect(result.tokens.cache.write).toBe(0)
  })

  test.each(["@ai-sdk/google-vertex/anthropic"])("computes total from components for %s models", (npm) => {
    const model = createModel({ context: 100_000, output: 32_000, npm })
    const usage = {
      inputTokens: 1000,
      outputTokens: 500,
      // These providers typically report total as input + output only,
      // excluding cache read/write.
      totalTokens: 1500,
      cachedInputTokens: 200,
    }

    const result = Session.getUsage({
      model,
      usage,
      metadata: {
        anthropic: {
          cacheCreationInputTokens: 300,
        },
      },
    })

    expect(result.tokens.input).toBe(1000)
    expect(result.tokens.cache.read).toBe(200)
    expect(result.tokens.cache.write).toBe(300)
    expect(result.tokens.total).toBe(2000)
  })
})

describe("session.compaction.prune tier-aware", () => {
  test("ContextTier classifies recent messages as Tier 1 and old messages as Tier 3", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const { ContextTier } = await import("../../src/session/context-tier")

        // Create 10 messages: 5 user turns (10 messages total)
        const messages: MessageV2.WithParts[] = []
        for (let i = 0; i < 5; i++) {
          messages.push({
            info: {
              id: MessageID.ascending(),
              sessionID: "ses_test" as any,
              role: "user",
              time: { created: Date.now() + i * 2 },
              summary: false,
            } as any,
            parts: [],
          })
          messages.push({
            info: {
              id: MessageID.ascending(),
              sessionID: "ses_test" as any,
              role: "assistant",
              time: { created: Date.now() + i * 2 + 1 },
              summary: false,
            } as any,
            parts: [
              {
                id: PartID.ascending(),
                messageID: MessageID.ascending(),
                sessionID: "ses_test" as any,
                type: "tool" as const,
                callID: `call_${i}`,
                tool: "read",
                state: {
                  status: "completed" as const,
                  input: {},
                  output: "x".repeat(1000),
                  title: "tool result",
                  metadata: {},
                  time: { start: Date.now(), end: Date.now() },
                },
              },
            ],
          })
        }

        const classified = ContextTier.classify(messages, { recentTurns: 2, supportingTurns: 2 })
        const dist = ContextTier.distribution(classified)

        // Should have 10 messages total
        expect(dist.total).toBe(10)
        // Last 2 user turns = 4 messages (2 user + 2 assistant) = Tier 1
        expect(dist.tier1).toBe(4)
        // Supporting turns (turns 3-4) = 4 messages = Tier 2
        expect(dist.tier2).toBe(4)
        // First user turn = 2 messages = Tier 3
        expect(dist.tier3).toBe(2)

        // Verify first message is Tier 3
        expect(classified[0].tier).toBe(3)
        // Verify last message is Tier 1
        expect(classified[9].tier).toBe(1)
      },
    })
  })
})
