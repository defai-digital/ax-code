import { afterAll, afterEach, beforeAll, expect, test, vi } from "vitest"
import { McpSampling } from "../../src/mcp/sampling"
import { Permission } from "../../src/permission"
import { Instance } from "../../src/project/instance"
import { SessionID } from "../../src/session/schema"

// Autonomous mode defaults ON at runtime (AX_CODE_AUTONOMOUS) and the
// sampling handler must decline in autonomous mode; tests force it off.
const ORIGINAL_AUTONOMOUS = process.env.AX_CODE_AUTONOMOUS
beforeAll(() => {
  process.env.AX_CODE_AUTONOMOUS = "false"
})
afterAll(() => {
  if (ORIGINAL_AUTONOMOUS === undefined) delete process.env.AX_CODE_AUTONOMOUS
  else process.env.AX_CODE_AUTONOMOUS = ORIGINAL_AUTONOMOUS
})

afterEach(async () => {
  await Instance.disposeAll()
})

// -------------------------------------------------------------------------
// RateLimiter
// -------------------------------------------------------------------------

test("RateLimiter.tryConsume enforces the per-minute window", () => {
  let now = 0
  const limiter = new McpSampling.RateLimiter({ now: () => now, windowMs: 60_000, perMinute: 3, perSession: 100 })
  expect(limiter.tryConsume()).toBe(true)
  expect(limiter.tryConsume()).toBe(true)
  expect(limiter.tryConsume()).toBe(true)
  expect(limiter.tryConsume()).toBe(false)
  now += 60_000
  expect(limiter.tryConsume()).toBe(true)
})

test("RateLimiter.tryConsume enforces the per-session cap regardless of window", () => {
  let now = 0
  const limiter = new McpSampling.RateLimiter({ now: () => now, windowMs: 60_000, perMinute: 100, perSession: 5 })
  for (let i = 0; i < 5; i++) {
    now += 1
    expect(limiter.tryConsume()).toBe(true)
  }
  // Even with the window rolled, the session cap is a hard ceiling.
  now += 120_000
  expect(limiter.tryConsume()).toBe(false)
})

test("RateLimiter.dispose() refuses subsequent calls", () => {
  const limiter = new McpSampling.RateLimiter({ perMinute: 1, perSession: 1 })
  expect(limiter.tryConsume()).toBe(true)
  limiter.dispose()
  expect(limiter.tryConsume()).toBe(false)
})

// -------------------------------------------------------------------------
// sanitizeText + planRequest
// -------------------------------------------------------------------------

test("sanitizeText strips hidden Unicode and caps length", () => {
  // U+E0001 (tag character) and U+202E (right-to-left override) must go.
  const out = McpSampling.sanitizeText(`a\u{e0001}b\u202Ec` + "x".repeat(5000), 10)
  expect(out).not.toMatch(/[\u{e0001}-\u{e007f}\u202a-\u202e]/u)
  expect([...out].length).toBeLessThanOrEqual(13) // 10 + "..."
})

test("sanitizeText returns empty for non-strings and all-whitespace", () => {
  expect(McpSampling.sanitizeText(undefined, 100)).toBe("")
  expect(McpSampling.sanitizeText("\u0000\t\n", 100)).toBe("")
})

test("planRequest accepts a minimal request and caps the requested tokens", () => {
  const plan = McpSampling.planRequest({
    params: {
      maxTokens: 10_000,
      messages: [{ role: "user", content: { type: "text", text: "hi" } }],
    },
    maxTokensCap: 500,
  })
  expect(plan).toMatchObject({ ok: true })
  if (!plan.ok) return
  expect(plan.requestedMaxTokens).toBe(500)
  expect(plan.messages).toEqual([{ role: "user", text: "hi" }])
})

test("planRequest sanitises the system prompt and message text", () => {
  const plan = McpSampling.planRequest({
    params: {
      maxTokens: 100,
      systemPrompt: `sys\u{e0001}tem\u202E`,
      messages: [{ role: "user", content: { type: "text", text: `hello\u{e0001}world` } }],
    },
    maxTokensCap: 1000,
  })
  expect(plan).toMatchObject({ ok: true })
  if (!plan.ok) return
  expect(plan.systemPrompt).toBe("system")
  expect(plan.messages[0]?.text).toBe("helloworld")
})

test("planRequest rejects missing or non-positive maxTokens", () => {
  expect(
    McpSampling.planRequest({
      params: { messages: [{ role: "user", content: { type: "text", text: "x" } }] },
      maxTokensCap: 1000,
    }),
  ).toMatchObject({ ok: false })
  expect(
    McpSampling.planRequest({
      params: { maxTokens: 0, messages: [{ role: "user", content: { type: "text", text: "x" } }] },
      maxTokensCap: 1000,
    }),
  ).toMatchObject({ ok: false })
  expect(
    McpSampling.planRequest({
      params: { maxTokens: 50, messages: [{ role: "user", content: { type: "text", text: "x" } }] },
      maxTokensCap: 50,
    }),
  ).toMatchObject({ ok: true, requestedMaxTokens: 50 })
})

test("planRequest rejects empty messages, oversize, unknown roles, and non-text content", () => {
  const empty = McpSampling.planRequest({ params: { maxTokens: 100, messages: [] }, maxTokensCap: 1000 })
  expect(empty).toMatchObject({ ok: false })

  const unknownRole = McpSampling.planRequest({
    params: { maxTokens: 100, messages: [{ role: "system", content: { type: "text", text: "x" } }] },
    maxTokensCap: 1000,
  })
  expect(unknownRole).toMatchObject({ ok: false })

  const nonText = McpSampling.planRequest({
    params: { maxTokens: 100, messages: [{ role: "user", content: { type: "image", data: "abc" } }] },
    maxTokensCap: 1000,
  })
  expect(nonText).toMatchObject({ ok: false })
})

// -------------------------------------------------------------------------
// decide
// -------------------------------------------------------------------------

function callContext(signal?: AbortSignal) {
  return {
    sessionID: SessionID.make("ses_sampling"),
    ...(signal ? { signal } : {}),
  }
}

const baseParams = {
  maxTokens: 200,
  messages: [{ role: "user" as const, content: { type: "text" as const, text: "hi" } }],
}

test("decide declines in autonomous mode without asking", async () => {
  const ask = vi.fn()
  const generate = vi.fn()
  const decision = await McpSampling.decide({
    server: "srv",
    params: baseParams,
    call: callContext(),
    autonomous: true,
    rateLimited: false,
    maxTokensCap: 2000,
    ask,
    generate,
  })
  expect(decision.kind).toBe("decline")
  expect(ask).not.toHaveBeenCalled()
  expect(generate).not.toHaveBeenCalled()
})

test("decide declines when no in-flight call is available", async () => {
  const ask = vi.fn()
  const decision = await McpSampling.decide({
    server: "srv",
    params: baseParams,
    call: undefined,
    autonomous: false,
    rateLimited: false,
    maxTokensCap: 2000,
    ask,
    generate: vi.fn(),
  })
  expect(decision.kind).toBe("decline")
  expect(ask).not.toHaveBeenCalled()
})

test("decide rejects with a structured code when the rate limit is exhausted", async () => {
  const ask = vi.fn()
  const decision = await McpSampling.decide({
    server: "srv",
    params: baseParams,
    call: callContext(),
    autonomous: false,
    rateLimited: true,
    maxTokensCap: 2000,
    ask,
    generate: vi.fn(),
  })
  expect(decision.kind).toBe("reject")
  if (decision.kind === "reject") {
    expect(decision.code).toBe(-32029)
    expect(decision.message).toContain("rate limit")
  }
  expect(ask).not.toHaveBeenCalled()
})

test("decide declines when the user denies the prompt", async () => {
  const ask = vi.fn(async () => "deny" as const)
  const generate = vi.fn()
  const decision = await McpSampling.decide({
    server: "srv",
    params: baseParams,
    call: callContext(),
    autonomous: false,
    rateLimited: false,
    maxTokensCap: 2000,
    ask,
    generate,
  })
  expect(decision.kind).toBe("decline")
  expect(generate).not.toHaveBeenCalled()
})

test("decide returns the model output on allow", async () => {
  const ask = vi.fn(async () => "allow" as const)
  const generate = vi.fn(async () => ({ text: "Hello back", model: "prov/model", stopReason: "endTurn" as const }))
  const decision = await McpSampling.decide({
    server: "srv",
    params: baseParams,
    call: callContext(),
    autonomous: false,
    rateLimited: false,
    maxTokensCap: 2000,
    ask,
    generate,
  })
  expect(decision.kind).toBe("ok")
  if (decision.kind !== "ok") return
  expect(decision.result).toEqual({
    model: "prov/model",
    role: "assistant",
    content: { type: "text", text: "Hello back" },
    stopReason: "endTurn",
  })
  expect(ask).toHaveBeenCalledWith(
    expect.objectContaining({
      server: "srv",
      messageCount: 1,
      requestedMaxTokens: 200,
    }),
  )
})

test("decide wraps a Permission.RejectedError as a decline", async () => {
  const ask = vi.fn(async () => {
    throw new Permission.RejectedError()
  })
  const decision = await McpSampling.decide({
    server: "srv",
    params: baseParams,
    call: callContext(),
    autonomous: false,
    rateLimited: false,
    maxTokensCap: 2000,
    ask,
    generate: vi.fn(),
  })
  expect(decision.kind).toBe("decline")
})

test("decide surfaces a generate() failure as a JSON-RPC -32603 reject", async () => {
  const ask = vi.fn(async () => "allow" as const)
  const generate = vi.fn(async () => {
    throw new Error("model offline")
  })
  const decision = await McpSampling.decide({
    server: "srv",
    params: baseParams,
    call: callContext(),
    autonomous: false,
    rateLimited: false,
    maxTokensCap: 2000,
    ask,
    generate,
  })
  expect(decision.kind).toBe("reject")
  if (decision.kind === "reject") {
    expect(decision.code).toBe(-32603)
    expect(decision.message).toContain("model offline")
  }
})

test("decide rejects with -32602 when the request is malformed", async () => {
  const ask = vi.fn()
  const decision = await McpSampling.decide({
    server: "srv",
    params: { maxTokens: 0, messages: [] },
    call: callContext(),
    autonomous: false,
    rateLimited: false,
    maxTokensCap: 2000,
    ask,
    generate: vi.fn(),
  })
  expect(decision.kind).toBe("reject")
  if (decision.kind === "reject") expect(decision.code).toBe(-32602)
})

// -------------------------------------------------------------------------
// clientCapabilities
// -------------------------------------------------------------------------

test("clientCapabilities returns the wire capability only when enabled", () => {
  expect(McpSampling.clientCapabilities(false)).toEqual({})
  expect(McpSampling.clientCapabilities(true)).toEqual({ sampling: {} })
})
