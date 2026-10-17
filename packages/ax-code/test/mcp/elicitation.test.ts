import { afterAll, afterEach, beforeAll, expect, test, vi } from "vitest"
import type { Client } from "@modelcontextprotocol/client"
import { Client as RealClient, InMemoryTransport } from "@modelcontextprotocol/client"
import { Server } from "@modelcontextprotocol/server"
import { McpElicitation } from "../../src/mcp/elicitation"
import { Bus } from "../../src/bus"
import { Question } from "../../src/question"
import { Instance } from "../../src/project/instance"
import { SessionID } from "../../src/session/schema"
import { tmpdir } from "../fixture/fixture"

// Autonomous mode defaults ON at runtime (AX_CODE_AUTONOMOUS), which makes
// the elicitation handler decline before asking. The integration test at the
// bottom exercises the human-ask path, so force autonomous=false for it.
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

function formParams(input?: { message?: string; properties?: Record<string, unknown>; required?: string[] }) {
  return {
    message: input?.message ?? "Please complete your profile",
    requestedSchema: {
      type: "object",
      properties: input?.properties ?? {
        name: { type: "string", title: "Name" },
        plan: { type: "string", enum: ["free", "pro"], enumNames: ["Free", "Pro"] },
        tier: {
          type: "string",
          oneOf: [
            { const: "a", title: "Tier A" },
            { const: "b", title: "Tier B" },
          ],
        },
        verified: { type: "boolean", title: "Verified" },
        age: { type: "integer", title: "Age", minimum: 0, maximum: 150 },
      },
      required: input?.required ?? ["name"],
    },
  }
}

// -------------------------------------------------------------------------
// planForm: schema -> questions
// -------------------------------------------------------------------------

test("planForm maps string, enum, oneOf, boolean and number fields onto questions", () => {
  const plan = McpElicitation.planForm(formParams())
  expect(plan.ok).toBe(true)
  if (!plan.ok) return
  expect(plan.fields.map((field) => field.type)).toEqual(["string", "enum", "enum", "boolean", "number"])

  const [name, planField, tier, verified, age] = plan.fields
  expect(name.question.header).toBe("Name")
  expect(name.question.options).toEqual([])
  expect(name.question.custom).toBeUndefined()
  expect(name.required).toBe(true)
  expect(name.question.question).toContain("(required)")

  expect(planField.options).toEqual([
    { label: "Free", value: "free" },
    { label: "Pro", value: "pro" },
  ])
  expect(planField.question.custom).toBe(false)
  expect(planField.question.options[0]).toEqual({ label: "Free", description: "free" })
  expect(planField.required).toBe(false)

  expect(tier.options).toEqual([
    { label: "Tier A", value: "a" },
    { label: "Tier B", value: "b" },
  ])
  expect(tier.question.custom).toBe(false)

  expect(verified.options).toEqual([
    { label: "Yes", value: "true" },
    { label: "No", value: "false" },
  ])
  expect(verified.question.custom).toBe(false)

  expect(age.integer).toBe(true)
  expect(age.minimum).toBe(0)
  expect(age.maximum).toBe(150)
  expect(age.question.question).toContain("(integer)")
})

test("planForm sanitizes and caps the untrusted message", () => {
  const plan = McpElicitation.planForm(formParams({ message: `line one\nline two\ttab ${"x".repeat(2000)}` }))
  expect(plan.ok).toBe(true)
  if (!plan.ok) return
  expect(plan.message.startsWith("line one line two tab ")).toBe(true)
  expect([...plan.message].length).toBeLessThanOrEqual(McpElicitation.MAX_FIELDS * 0 + 500 + 3)
  for (const field of plan.fields) {
    expect(field.question.question.startsWith("line one line two tab ")).toBe(true)
    expect(field.question.question).not.toMatch(/[\u0000-\u001f]/)
  }
})

test("planForm rejects schemas with too many fields", () => {
  const properties: Record<string, unknown> = {}
  for (let index = 0; index < McpElicitation.MAX_FIELDS + 1; index++) properties[`f${index}`] = { type: "string" }
  const plan = McpElicitation.planForm(formParams({ properties }))
  expect(plan).toMatchObject({ ok: false })
  if (plan.ok) return
  expect(plan.reason).toContain("fields")
})

test("planForm rejects empty, malformed and unsupported schemas", () => {
  expect(McpElicitation.planForm({ message: "x", requestedSchema: { type: "object", properties: {} } })).toMatchObject({
    ok: false,
  })
  expect(McpElicitation.planForm({ message: "x" })).toMatchObject({ ok: false })
  expect(
    McpElicitation.planForm(formParams({ properties: { nested: { type: "object", title: "Nested" } } })),
  ).toMatchObject({ ok: false })
  expect(McpElicitation.planForm(formParams({ properties: { tags: { type: "array", title: "Tags" } } }))).toMatchObject(
    {
      ok: false,
    },
  )
  expect(McpElicitation.planForm(formParams({ properties: { wild: { title: "No type" } } }))).toMatchObject({
    ok: false,
  })
})

test("planForm rejects enum fields with too many choices", () => {
  const values = Array.from({ length: McpElicitation.MAX_ENUM_OPTIONS + 1 }, (_, index) => `v${index}`)
  const plan = McpElicitation.planForm(formParams({ properties: { pick: { type: "string", enum: values } } }))
  expect(plan).toMatchObject({ ok: false })
})

test("planForm rejects malformed enums instead of degrading them to free text", () => {
  const nonString = McpElicitation.planForm({
    message: "m",
    requestedSchema: {
      type: "object",
      properties: { pick: { type: "string", enum: ["ok", 5] } },
    },
  })
  expect(nonString).toMatchObject({ ok: false })

  const mismatchedNames = McpElicitation.planForm({
    message: "m",
    requestedSchema: {
      type: "object",
      properties: { pick: { type: "string", enum: ["a"], enumNames: ["A", "B"] } },
    },
  })
  expect(mismatchedNames).toMatchObject({ ok: false })

  const empty = McpElicitation.planForm({
    message: "m",
    requestedSchema: {
      type: "object",
      properties: { pick: { type: "string", enum: [] } },
    },
  })
  expect(empty).toMatchObject({ ok: false })
})

// -------------------------------------------------------------------------
// coerceAnswers: answers -> content
// -------------------------------------------------------------------------

test("coerceAnswers converts labels and text to the schema types", () => {
  const plan = McpElicitation.planForm(formParams())
  expect(plan.ok).toBe(true)
  if (!plan.ok) return
  const result = McpElicitation.coerceAnswers(plan.fields, [["Ada"], ["Free"], ["Tier B"], ["Yes"], ["36"]])
  expect(result).toEqual({
    ok: true,
    content: { name: "Ada", plan: "free", tier: "b", verified: true, age: 36 },
  })
})

test("coerceAnswers omits unanswered optional fields and declines empty required ones", () => {
  const plan = McpElicitation.planForm(formParams())
  expect(plan.ok).toBe(true)
  if (!plan.ok) return
  const omitted = McpElicitation.coerceAnswers(plan.fields, [["Ada"], [], [""], ["No"], []])
  expect(omitted).toEqual({ ok: true, content: { name: "Ada", verified: false } })

  const missingRequired = McpElicitation.coerceAnswers(plan.fields, [[""], ["Free"], ["Tier A"], ["Yes"], ["36"]])
  expect(missingRequired).toMatchObject({ ok: false })
})

test("coerceAnswers declines answers that violate number and enum constraints", () => {
  const plan = McpElicitation.planForm(formParams())
  expect(plan.ok).toBe(true)
  if (!plan.ok) return
  expect(McpElicitation.coerceAnswers(plan.fields, [["Ada"], ["Free"], ["Tier A"], ["Yes"], ["1.5"]])).toMatchObject({
    ok: false,
  })
  expect(McpElicitation.coerceAnswers(plan.fields, [["Ada"], ["Free"], ["Tier A"], ["Yes"], ["-1"]])).toMatchObject({
    ok: false,
  })
  expect(McpElicitation.coerceAnswers(plan.fields, [["Ada"], ["Free"], ["Tier A"], ["Yes"], ["999"]])).toMatchObject({
    ok: false,
  })
  expect(
    McpElicitation.coerceAnswers(plan.fields, [["Ada"], ["Enterprise"], ["Tier A"], ["Yes"], ["36"]]),
  ).toMatchObject({ ok: false })
  expect(McpElicitation.coerceAnswers(plan.fields, [["Ada"], ["Free"], ["Tier A"], ["maybe"], ["36"]])).toMatchObject({
    ok: false,
  })
})

// -------------------------------------------------------------------------
// decide: decline / cancel / autonomous paths
// -------------------------------------------------------------------------

function callContext(signal?: AbortSignal) {
  return {
    sessionID: SessionID.make("ses_elicitation"),
    ...(signal ? { signal } : {}),
  }
}

test("decide declines in autonomous mode without asking", async () => {
  const ask = vi.fn()
  const decision = await McpElicitation.decide({ params: formParams(), call: callContext(), autonomous: true, ask })
  expect(decision.action).toBe("decline")
  expect(ask).not.toHaveBeenCalled()
})

test("decide declines requests without an in-flight call and url mode asks then opens", async () => {
  const ask = vi.fn()
  const noCall = await McpElicitation.decide({ params: formParams(), call: undefined, autonomous: false, ask })
  expect(noCall.action).toBe("decline")
  expect(ask).not.toHaveBeenCalled()

  // URL mode is now handled: https URL with an in-flight call asks the user
  // and opens the URL on accept. The Open answer is the first option label.
  const openUrl = vi.fn(async () => undefined)
  ask.mockResolvedValueOnce([["Open"]])
  const accepted = await McpElicitation.decide({
    params: { mode: "url", message: "Continue", url: "https://example.com", elicitationId: "1" },
    call: callContext(),
    autonomous: false,
    ask,
    openUrl,
  })
  expect(accepted.action).toBe("accept")
  expect(openUrl).toHaveBeenCalledWith("https://example.com/")
})

test("decide declines unsupported schemas without asking", async () => {
  const ask = vi.fn()
  const decision = await McpElicitation.decide({
    params: formParams({ properties: { nested: { type: "object" } } }),
    call: callContext(),
    autonomous: false,
    ask,
  })
  expect(decision.action).toBe("decline")
  expect(ask).not.toHaveBeenCalled()
})

test("decide returns accept with coerced content", async () => {
  const ask = vi.fn(async () => [["Ada"], ["Free"], ["Tier A"], ["No"], ["36"]])
  const decision = await McpElicitation.decide({
    params: formParams(),
    call: callContext(),
    autonomous: false,
    ask,
  })
  expect(decision).toEqual({
    action: "accept",
    category: "user_accepted",
    content: { name: "Ada", plan: "free", tier: "a", verified: false, age: 36 },
  })
})

test("decide declines when the user dismisses the prompt", async () => {
  const ask = vi.fn(async () => {
    throw new Question.RejectedError()
  })
  const decision = await McpElicitation.decide({
    params: formParams(),
    call: callContext(),
    autonomous: false,
    ask,
  })
  expect(decision.action).toBe("decline")
})

test("decide cancels when the tool call aborted while the prompt was open", async () => {
  const controller = new AbortController()
  const ask = vi.fn(async () => {
    controller.abort()
    throw new Question.RejectedError()
  })
  const decision = await McpElicitation.decide({
    params: formParams(),
    call: callContext(controller.signal),
    autonomous: false,
    ask,
  })
  expect(decision.action).toBe("cancel")
})

test("decide declines when the answers cannot be coerced", async () => {
  const ask = vi.fn(async () => [[]])
  const decision = await McpElicitation.decide({
    params: formParams(),
    call: callContext(),
    autonomous: false,
    ask,
  })
  expect(decision.action).toBe("decline")
})

// -------------------------------------------------------------------------
// In-flight call tracking
// -------------------------------------------------------------------------

test("withActiveCall exposes the bound context and clears it afterwards", async () => {
  const client = {} as unknown as Client
  const options: object = {}
  const context = callContext()
  expect(McpElicitation.currentCall(client)).toBeUndefined()
  let observed: unknown
  await McpElicitation.withActiveCall(client, options, async () => {
    // Before binding there is no context even inside the call.
    observed = McpElicitation.currentCall(client)
  })
  expect(observed).toBeUndefined()

  McpElicitation.bindCallContext(options, context)
  await McpElicitation.withActiveCall(client, options, async () => {
    observed = McpElicitation.currentCall(client)
  })
  expect(observed).toBe(context)
  expect(McpElicitation.currentCall(client)).toBeUndefined()
})

test("currentCall skips aborted contexts", async () => {
  const client = {} as unknown as Client
  const controller = new AbortController()
  const options: object = {}
  McpElicitation.bindCallContext(options, callContext(controller.signal))
  await McpElicitation.withActiveCall(client, options, async () => {
    controller.abort()
    expect(McpElicitation.currentCall(client)).toBeUndefined()
  })
})

// -------------------------------------------------------------------------
// Integration: real SDK client + server over InMemoryTransport
// -------------------------------------------------------------------------

test("elicitation/create surfaces as a session question and returns coerced content", async () => {
  await using tmp = await tmpdir({ git: true })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const server = new Server({ name: "form-server", version: "1.0.0" }, { capabilities: { tools: {} } })
      server.setRequestHandler("tools/call", async (request: { params: { name: string } }) => {
        const result = (await server.request({
          method: "elicitation/create",
          params: {
            message: "Please complete your profile",
            requestedSchema: {
              type: "object",
              properties: {
                name: { type: "string", title: "Name" },
                age: { type: "integer", title: "Age", minimum: 0 },
              },
              required: ["name"],
            },
          },
        })) as { action: string; content?: Record<string, unknown> }
        const content = result.content ?? {}
        return {
          content: [{ type: "text" as const, text: `action=${result.action} name=${content.name} age=${content.age}` }],
        }
      })
      const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
      await server.connect(serverTransport)
      const client = new RealClient(
        { name: "ax-code", version: "test" },
        { capabilities: McpElicitation.clientCapabilities() },
      )
      McpElicitation.registerHandler(client, "form-server")
      await client.connect(clientTransport)
      const resolved: Array<Record<string, unknown>> = []
      const unsubscribe = Bus.subscribe(McpElicitation.Event.Resolved, (event) => {
        resolved.push(event.properties)
      })
      try {
        const controller = new AbortController()
        const options: object = {}
        McpElicitation.bindCallContext(options, {
          sessionID: SessionID.make("ses_elicitation"),
          signal: controller.signal,
        })
        const call = McpElicitation.withActiveCall(client, options, () =>
          client.callTool({ name: "profile", arguments: {} }),
        )
        // Wait for the handler to surface the question in the session.
        let surfaced: Awaited<ReturnType<typeof Question.list>>[number] | undefined
        for (let attempt = 0; attempt < 500 && !surfaced; attempt++) {
          const pending = await Question.list()
          surfaced = pending[0]
          if (!surfaced) await new Promise((resolve) => setTimeout(resolve, 10))
        }
        expect(surfaced).toBeDefined()
        expect(surfaced?.questions.map((question) => question.header)).toEqual(["Name", "Age"])
        expect(surfaced?.questions[0]?.question).toContain("Please complete your profile")
        expect(surfaced?.questions[0]?.question).toContain("(required)")
        await Question.reply({ requestID: surfaced!.id, answers: [["Ada"], ["36"]] })
        const result = await call
        const text = (result.content as Array<{ type: string; text?: string }>)[0]?.text
        expect(text).toBe("action=accept name=Ada age=36")

        // ADR-254: one redacted event with names and counts, never values or the server message.
        await new Promise((resolve) => setTimeout(resolve, 0))
        expect(resolved).toEqual([
          {
            server: "form-server",
            sessionID: "ses_elicitation",
            mode: "form",
            action: "accept",
            category: "user_accepted",
            fieldCount: 2,
            fieldNames: ["name", "age"],
          },
        ])
        const serialized = JSON.stringify(resolved)
        expect(serialized).not.toContain("Ada")
        expect(serialized).not.toContain("36")
        expect(serialized).not.toContain("complete your profile")
      } finally {
        unsubscribe()
        await client.close().catch(() => {})
        await server.close().catch(() => {})
      }
    },
  })
})

// -------------------------------------------------------------------------
// URL mode (ADR-252)
// -------------------------------------------------------------------------

test("planUrl accepts https and loopback http and declines plain http", () => {
  const https = McpElicitation.planUrl({ mode: "url", message: "open me", url: "https://example.com/path" })
  expect(https).toMatchObject({ ok: true })
  if (https.ok) expect(https.url).toBe("https://example.com/path")

  const loopback = McpElicitation.planUrl({ url: "http://localhost:3000/cb" })
  expect(loopback).toMatchObject({ ok: true })

  const loopbackIP = McpElicitation.planUrl({ url: "http://127.0.0.1:9000/" })
  expect(loopbackIP).toMatchObject({ ok: true })

  expect(McpElicitation.planUrl({ url: "http://example.com/" })).toMatchObject({ ok: false })
  expect(McpElicitation.planUrl({ url: "ftp://example.com/" })).toMatchObject({ ok: false })
  expect(McpElicitation.planUrl({ url: "not a url" })).toMatchObject({ ok: false })
  expect(McpElicitation.planUrl({ url: "" })).toMatchObject({ ok: false })
})

test("planUrl sanitizes and caps the untrusted message", () => {
  const plan = McpElicitation.planUrl({
    mode: "url",
    message: `evil\u0000injection\t${"x".repeat(2000)}`,
    url: "https://example.com",
  })
  expect(plan).toMatchObject({ ok: true })
  if (!plan.ok) return
  expect(plan.message).not.toMatch(/[\u0000-\u001f]/)
  expect([...plan.message].length).toBeLessThanOrEqual(500 + 3)
})

test("decide url mode declines non-https non-loopback without asking", async () => {
  const ask = vi.fn()
  const decision = await McpElicitation.decide({
    params: { mode: "url", message: "open", url: "http://example.com/" },
    call: callContext(),
    autonomous: false,
    ask,
  })
  expect(decision.action).toBe("decline")
  expect(ask).not.toHaveBeenCalled()
})

test("decide url mode always declines in autonomous mode", async () => {
  const ask = vi.fn()
  const decision = await McpElicitation.decide({
    params: { mode: "url", message: "open", url: "https://example.com/" },
    call: callContext(),
    autonomous: true,
    ask,
  })
  expect(decision.action).toBe("decline")
  expect(ask).not.toHaveBeenCalled()
})

test("decide url mode declines when the user picks Decline", async () => {
  const ask = vi.fn(async () => [["Decline"]])
  const openUrl = vi.fn()
  const decision = await McpElicitation.decide({
    params: { mode: "url", message: "open", url: "https://example.com/" },
    call: callContext(),
    autonomous: false,
    ask,
    openUrl,
  })
  expect(decision.action).toBe("decline")
  expect(openUrl).not.toHaveBeenCalled()
})

test("decide url mode calls openUrl exactly once on accept", async () => {
  const openUrl = vi.fn(async () => undefined)
  const ask = vi.fn(async () => [["Open"]])
  const decision = await McpElicitation.decide({
    params: { mode: "url", message: "open", url: "https://example.com/" },
    call: callContext(),
    autonomous: false,
    ask,
    openUrl,
  })
  expect(decision.action).toBe("accept")
  expect(openUrl).toHaveBeenCalledTimes(1)
  expect(openUrl).toHaveBeenCalledWith("https://example.com/")
})

test("decide url mode declines when openUrl throws", async () => {
  const ask = vi.fn(async () => [["Open"]])
  const openUrl = vi.fn(async () => {
    throw new Error("no browser")
  })
  const decision = await McpElicitation.decide({
    params: { mode: "url", message: "open", url: "https://example.com/" },
    call: callContext(),
    autonomous: false,
    ask,
    openUrl,
  })
  expect(decision.action).toBe("decline")
  if (decision.action === "decline") {
    expect(decision.reason).toContain("failed to open the URL")
  }
})

test("clientCapabilities advertises both form and url mode", () => {
  const caps = McpElicitation.clientCapabilities()
  expect(caps.elicitation).toEqual({ form: {}, url: {} })
})

// -------------------------------------------------------------------------
// Resolution categories and the redacted request summary (ADR-254)
// -------------------------------------------------------------------------

test("every decision carries a closed category", async () => {
  const ask = vi.fn(async () => [["x"]])
  const call = { sessionID: SessionID.make("ses_category") }
  const form = {
    mode: "form",
    message: "m",
    requestedSchema: { type: "object", properties: { a: { type: "string" } } },
  }
  expect((await McpElicitation.decide({ params: form, call, autonomous: true, ask })).category).toBe("autonomous")
  expect((await McpElicitation.decide({ params: form, call: undefined, autonomous: false, ask })).category).toBe(
    "no_active_call",
  )
  expect((await McpElicitation.decide({ params: "nope", call, autonomous: false, ask })).category).toBe(
    "invalid_request",
  )
  expect(
    (await McpElicitation.decide({ params: { mode: "carrier-pigeon" }, call, autonomous: false, ask })).category,
  ).toBe("invalid_request")
  const nested = { mode: "form", requestedSchema: { type: "object", properties: { a: { type: "object" } } } }
  expect((await McpElicitation.decide({ params: nested, call, autonomous: false, ask })).category).toBe(
    "unsupported_form",
  )
  expect(
    (
      await McpElicitation.decide({
        params: { mode: "url", url: "http://example.com/x" },
        call,
        autonomous: false,
        ask,
      })
    ).category,
  ).toBe("invalid_url")
  const failing = vi.fn(async () => {
    throw new Error("boom")
  })
  expect((await McpElicitation.decide({ params: form, call, autonomous: false, ask: failing })).category).toBe(
    "prompt_failed",
  )
})

test("summarizeRequest keeps names, counts and the URL host only", () => {
  const many = Object.fromEntries(
    Array.from({ length: 10 }, (_, index) => [
      `field_${index}_${"x".repeat(80)}`,
      { type: "string", default: "secret-default" },
    ]),
  )
  const form = McpElicitation.summarizeRequest({
    mode: "form",
    message: "token=abc",
    requestedSchema: { type: "object", properties: many },
  })
  expect(form.mode).toBe("form")
  expect(form.fieldCount).toBe(10)
  expect(form.fieldNames).toHaveLength(McpElicitation.MAX_EVENT_FIELD_NAMES)
  expect(form.fieldNames.every((name) => name.length <= 64)).toBe(true)
  expect(JSON.stringify(form)).not.toContain("secret-default")
  expect(JSON.stringify(form)).not.toContain("token=abc")

  const url = McpElicitation.summarizeRequest({ mode: "url", url: "https://auth.example.com/cb?state=s3cr3t#frag" })
  expect(url).toEqual({ mode: "url", fieldCount: 0, fieldNames: [], urlHost: "auth.example.com" })
  expect(McpElicitation.summarizeRequest({ mode: "url", url: "not a url" })).toEqual({
    mode: "url",
    fieldCount: 0,
    fieldNames: [],
  })
  expect(McpElicitation.summarizeRequest(null)).toEqual({ mode: "unknown", fieldCount: 0, fieldNames: [] })
})
