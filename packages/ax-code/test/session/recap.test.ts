import { afterEach, describe, expect, test, vi } from "vitest"
import { Agent } from "../../src/agent/agent"
import { Provider } from "../../src/provider/provider"
import { Session } from "../../src/session"
import { LLM } from "../../src/session/llm"

import { AX_ENGINE_PROVIDER_ID } from "../../src/provider/ax-engine"
import { ProviderID } from "../../src/provider/schema"
import type { MessageV2 } from "../../src/session/message-v2"
import {
  cleanGeneratedRecap,
  lastTurnMessages,
  recapContextText,
  recapMessages,
  SessionRecap,
  shouldSkipAutomaticRecap,
  turnEndedWithAssistantError,
} from "../../src/session/recap"
import { MessageID, PartID, SessionID } from "../../src/session/schema"

afterEach(() => vi.restoreAllMocks())

const sessionID = SessionID.make("ses_recap_test")
let counter = 0

function userMessage(parts: unknown[], id?: string) {
  counter += 1
  return {
    info: {
      id: MessageID.make(id ?? `msg_recap_user_${counter}`),
      sessionID,
      role: "user",
      time: { created: Date.now() },
      agent: "build",
      model: { providerID: "openai", modelID: "gpt-5.2" },
    },
    parts,
  } as unknown as MessageV2.WithParts
}

function assistantMessage(parts: unknown[], id?: string, extra?: Record<string, unknown>) {
  counter += 1
  return {
    info: {
      id: MessageID.make(id ?? `msg_recap_assistant_${counter}`),
      sessionID,
      role: "assistant",
      parentID: MessageID.make("msg_recap_parent"),
      time: { created: Date.now() },
      ...extra,
    },
    parts,
  } as unknown as MessageV2.WithParts
}

function text(text: string, extra?: Record<string, unknown>) {
  return { type: "text", text, ...extra }
}

describe("session recap", () => {
  test("skips automatic recap for the managed ax-engine provider", () => {
    expect(shouldSkipAutomaticRecap({ providerID: ProviderID.make(AX_ENGINE_PROVIDER_ID) })).toBe(true)
    expect(shouldSkipAutomaticRecap({ providerID: ProviderID.make("groq") })).toBe(false)
  })

  test("skips recap when the last assistant turn ended with an error", () => {
    const user = userMessage([text("please commit")])
    const failed = assistantMessage([text("plain-text tool call")], undefined, {
      error: { name: "UnknownError", data: { message: "terminated" } },
    })
    expect(turnEndedWithAssistantError([user, failed])).toBe(true)
    expect(turnEndedWithAssistantError([user, assistantMessage([text("done")])])).toBe(false)
    expect(turnEndedWithAssistantError([user])).toBe(false)
  })

  test("lastTurnMessages returns the slice from the last real user message onward", () => {
    const first = userMessage([text("first question")], "msg_recap_first_user")
    const second = userMessage([text("second question")], "msg_recap_second_user")
    const reply = assistantMessage([text("done")])
    const turn = lastTurnMessages([first, assistantMessage([text("earlier")]), second, reply])
    expect(turn?.map((m) => m.info.id)).toEqual([second.info.id, reply.info.id])
  })

  test("lastTurnMessages skips fully synthetic user messages when locating the turn start", () => {
    const real = userMessage([text("real question")], "msg_recap_real_user")
    const reply = assistantMessage([text("done")], "msg_recap_real_reply")
    const synthetic = userMessage([text("synthetic", { synthetic: true })], "msg_recap_synthetic_user")
    const turn = lastTurnMessages([real, reply, synthetic])
    // The turn starts at the last REAL user message; later synthetic messages
    // remain part of the slice (recapContextText skips their parts).
    expect(turn?.map((m) => m.info.id)).toEqual([real.info.id, reply.info.id, synthetic.info.id])
  })

  test("lastTurnMessages returns undefined without a real user message", () => {
    expect(lastTurnMessages([])).toBeUndefined()
    expect(lastTurnMessages([assistantMessage([text("only assistant")])])).toBeUndefined()
    expect(lastTurnMessages([userMessage([text("synthetic", { synthetic: true })])])).toBeUndefined()
    expect(lastTurnMessages([userMessage([text("ignored", { ignored: true })])])).toBeUndefined()
    expect(lastTurnMessages([userMessage([{ type: "compaction", auto: true }])])).toBeUndefined()
  })

  test("conversation scope keeps eight recent real turns and default scope keeps one", () => {
    const turns = Array.from({ length: 10 }, (_, i) => [
      userMessage([text(`request ${i}`)]),
      assistantMessage([text(`result ${i}`)]),
    ])
    const history = turns.flat()
    expect(recapMessages(history, "turn")).toEqual(turns[9])
    expect(recapMessages(history, "conversation")).toEqual(turns.slice(2).flat())
    expect(recapMessages([], "conversation")).toEqual([])
  })

  test("does not recap reverted messages or parts and does not mutate history", () => {
    const request = userMessage([text("Fix login")])
    const boundary = PartID.make("prt_recap_boundary")
    const response = assistantMessage([text("Implemented"), text("Tests passed", { id: boundary })])
    const history = [request, response, userMessage([text("Push it")])]
    expect(recapMessages(history, "conversation", { messageID: response.info.id })).toEqual([request])
    const partial = recapMessages(history, "conversation", { messageID: response.info.id, partID: boundary })
    expect(recapContextText(partial)).toBe("User: Fix login\n\nAssistant: Implemented")
    expect(response.parts).toHaveLength(2)
    expect(history).toHaveLength(3)
  })

  test("recapContextText renders user and assistant text with role prefixes", () => {
    const turn = [
      userMessage([text("add dark mode")]),
      assistantMessage([text("Added a theme toggle."), text("Updated settings.")]),
    ]
    expect(recapContextText(turn)).toBe(
      "User: add dark mode\n\nAssistant: Added a theme toggle.\n\nAssistant: Updated settings.",
    )
  })

  test("recapContextText skips ignored, synthetic and non-text parts", () => {
    const turn = [
      userMessage([text("keep this"), text("ignored", { ignored: true }), { type: "reasoning", text: "hidden" }]),
      assistantMessage([text("synthetic", { synthetic: true }), text("visible output")]),
    ]
    expect(recapContextText(turn)).toBe("User: keep this\n\nAssistant: visible output")
  })

  test("recapContextText truncates oversized context", () => {
    const turn = [userMessage([text("x".repeat(20_000))])]
    const result = recapContextText(turn)
    expect(result.endsWith("[Recap context truncated]")).toBe(true)
    expect(result.length).toBeLessThan(20_000)
  })

  test("retains the latest request and final outcome within the full context budget", () => {
    const result = recapContextText([
      userMessage([text("Fix login. " + "request details ".repeat(1500))]),
      assistantMessage([text("Investigating. " + "progress ".repeat(3000) + "Tests failed; commit is blocked.")]),
    ])
    expect(result).toContain("User: Fix login.")
    expect(result).toContain("Tests failed; commit is blocked.")
    expect(result.length).toBeLessThanOrEqual(12_000)
  })

  test("excludes ignored assistant text and compaction summaries", () => {
    expect(
      recapContextText([
        userMessage([text("Fix login")]),
        assistantMessage([text("Tests passed", { ignored: true })]),
        assistantMessage([text("Old compressed state")], undefined, { summary: true }),
        assistantMessage([text("Tests failed")]),
      ]),
    ).toBe("User: Fix login\n\nAssistant: Tests failed")
  })

  test("cleanGeneratedRecap strips think tags, code fences and prefixes", () => {
    expect(cleanGeneratedRecap("<think>pondering</think>\nFixed the login bug.")).toBe("Fixed the login bug.")
    expect(cleanGeneratedRecap("```\nsome code\n```\nUpdated the parser.")).toBe("Updated the parser.")
    expect(cleanGeneratedRecap("Summary: Added tests.")).toBe("Added tests.")
    expect(cleanGeneratedRecap("recap: tweaked config")).toBe("tweaked config")
    expect(cleanGeneratedRecap("<think>only thinking</think>")).toBeUndefined()
    expect(cleanGeneratedRecap("   ")).toBeUndefined()
    expect(cleanGeneratedRecap("```\nonly a fence\n```")).toBeUndefined()
  })

  test("cleanGeneratedRecap caps length at 400 chars", () => {
    const long = "a".repeat(500)
    const cleaned = cleanGeneratedRecap(long)
    expect(cleaned).toBe("a".repeat(397) + "...")
    expect(cleaned!.length).toBe(400)
    expect(cleanGeneratedRecap("a".repeat(400))).toBe("a".repeat(400))
  })
})

describe("recap generation boundary", () => {
  function setup(history: MessageV2.WithParts[]) {
    vi.spyOn(Session, "messages").mockResolvedValue(history)
    vi.spyOn(Session, "get").mockResolvedValue({ id: sessionID } as Session.Info)
    const agent = vi.spyOn(Agent, "get").mockResolvedValue({ name: "recap" } as Agent.Info)
    vi.spyOn(Provider, "resolveRequestedModel").mockImplementation(async (model) => model)
    const model = { id: "small", providerID: "openai" } as Provider.Model
    vi.spyOn(Provider, "getSmallModel").mockResolvedValue(model)
    const stream = vi
      .spyOn(LLM, "stream")
      .mockResolvedValue({ text: Promise.resolve("Fixed login; tests passed.") } as unknown as Awaited<
        ReturnType<typeof LLM.stream>
      >)
    return { agent, model, stream }
  }

  test("conversation generation is bounded, tool-free, and outside the transcript", async () => {
    const history = [
      userMessage([text("Fix the login bug")]),
      assistantMessage([text("Updated auth.ts")]),
      userMessage([text("Run tests")]),
      assistantMessage([text("Tests passed")], undefined, { time: { created: 1, completed: 2 } }),
    ]
    const { model, stream } = setup(history)
    const write = vi.spyOn(Session, "updateMessage")
    expect(await SessionRecap.generate({ sessionID, scope: "conversation" })).toEqual({
      text: "Fixed login; tests passed.",
    })
    expect(stream).toHaveBeenCalledWith(
      expect.objectContaining({ model, tools: {}, retries: 0, small: true, abort: expect.any(AbortSignal) }),
    )
    const content = stream.mock.calls[0][0].messages[0].content
    expect(content).toContain("Fix the login bug")
    expect(content).toContain("Tests passed")
    expect(write).not.toHaveBeenCalled()
    stream.mockClear()
    await SessionRecap.generate({ sessionID })
    expect(stream.mock.calls[0][0].messages[0].content).not.toContain("Fix the login bug")
  })

  test.each(["empty", "user-only", "incomplete", "failed", "engine"])(
    "skips model calls for %s history",
    async (kind) => {
      const user = userMessage([text("Fix login")])
      if (kind === "engine" && user.info.role === "user")
        user.info.model.providerID = ProviderID.make(AX_ENGINE_PROVIDER_ID)
      const assistant = assistantMessage([text("Working")], undefined, {
        time: { created: 1, completed: kind === "incomplete" ? undefined : 2 },
        ...(kind === "failed" ? { error: { name: "UnknownError", data: { message: "failed" } } } : {}),
      })
      const { agent, stream } = setup(kind === "empty" ? [] : kind === "user-only" ? [user] : [user, assistant])
      expect(await SessionRecap.generate({ sessionID })).toBeUndefined()
      expect(agent).not.toHaveBeenCalled()
      expect(stream).not.toHaveBeenCalled()
    },
  )
})
