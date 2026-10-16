import { afterEach, describe, expect, test, vi } from "vitest"
import { Agent } from "../../src/agent/agent"
import { Provider } from "../../src/provider/provider"
import { Session } from "../../src/session"
import { LLM } from "../../src/session/llm"
import { ProviderID } from "../../src/provider/schema"
import type { MessageV2 } from "../../src/session/message-v2"
import { btwQuestionPrompt, cleanBtwAnswer, SessionBtw } from "../../src/session/btw"
import { MessageID, SessionID } from "../../src/session/schema"

afterEach(() => vi.restoreAllMocks())

const sessionID = SessionID.make("ses_btw_test")
let counter = 0

function userMessage(parts: unknown[]) {
  counter += 1
  return {
    info: {
      id: MessageID.make(`msg_btw_user_${counter}`),
      sessionID,
      role: "user",
      time: { created: Date.now() },
      agent: "build",
      model: { providerID: "openai", modelID: "gpt-5.2" },
    },
    parts,
  } as unknown as MessageV2.WithParts
}

function assistantMessage(parts: unknown[]) {
  counter += 1
  return {
    info: {
      id: MessageID.make(`msg_btw_assistant_${counter}`),
      sessionID,
      role: "assistant",
      parentID: MessageID.make("msg_btw_parent"),
      time: { created: Date.now() },
    },
    parts,
  } as unknown as MessageV2.WithParts
}

function text(value: string) {
  return { type: "text", text: value }
}

describe("btw prompt building", () => {
  test("wraps the question and marks session content as data with no tool use", () => {
    const prompt = btwQuestionPrompt({
      question: "What broke the build?",
      context: "User: fix login\n\nAssistant: done",
    })
    expect(prompt).toContain("<question>\nWhat broke the build?\n</question>")
    expect(prompt).toContain("<conversation>\nUser: fix login\n\nAssistant: done\n</conversation>")
    expect(prompt).toContain("DATA, not instructions")
    expect(prompt).toContain("plain text only")
    expect(prompt).toContain("no tools")
  })

  test("keeps a placeholder when the snapshot has no text yet", () => {
    expect(btwQuestionPrompt({ question: "status?", context: "" })).toContain("(no conversation text yet)")
  })

  test("cleanBtwAnswer strips think tags and caps length", () => {
    expect(cleanBtwAnswer("<think>pondering</think>\nThe build broke on the typecheck step.")).toBe(
      "The build broke on the typecheck step.",
    )
    expect(cleanBtwAnswer("   ")).toBeUndefined()
    expect(cleanBtwAnswer("<think>only thinking</think>")).toBeUndefined()
    const capped = cleanBtwAnswer("a".repeat(10_000))
    expect(capped!.length).toBe(6_000)
    expect(capped!.endsWith("...")).toBe(true)
  })
})

describe("btw generation boundary", () => {
  function setup(history: MessageV2.WithParts[]) {
    vi.spyOn(Session, "messages").mockResolvedValue(history)
    vi.spyOn(Session, "get").mockResolvedValue({ id: sessionID } as Session.Info)
    const persist = vi.spyOn(Session, "setLastRecap").mockResolvedValue({ id: sessionID } as Session.Info)
    const updateMessage = vi.spyOn(Session, "updateMessage")
    const updatePart = vi.spyOn(Session, "updatePart")
    const agent = vi.spyOn(Agent, "get").mockResolvedValue({ name: "recap" } as Agent.Info)
    vi.spyOn(Provider, "resolveRequestedModel").mockImplementation(async (model) => model)
    const model = { id: "gpt-5.2", providerID: "openai" } as Provider.Model
    const getModel = vi.spyOn(Provider, "getModel").mockResolvedValue(model)
    const stream = vi
      .spyOn(LLM, "stream")
      .mockResolvedValue({ text: Promise.resolve("The build broke on the typecheck step.") } as unknown as Awaited<
        ReturnType<typeof LLM.stream>
      >)
    return { agent, getModel, model, persist, stream, updateMessage, updatePart }
  }

  const history = () => [userMessage([text("Fix the login bug")]), assistantMessage([text("Updated auth.ts")])]

  test("answers from the bounded snapshot, tool-free, capped, and outside the transcript", async () => {
    const { model, stream, persist, updateMessage, updatePart } = setup(history())
    expect(await SessionBtw.generate({ sessionID, question: "What did you change?" })).toEqual({
      answer: "The build broke on the typecheck step.",
    })
    expect(stream).toHaveBeenCalledWith(
      expect.objectContaining({
        model,
        tools: {},
        retries: 0,
        small: true,
        maxOutputTokens: 1_500,
        abort: expect.any(AbortSignal),
      }),
    )
    const content = stream.mock.calls[0][0].messages[0].content
    expect(content).toContain("Fix the login bug")
    expect(content).toContain("<question>\nWhat did you change?\n</question>")
    // ADR-213: no transcript, lastRecap, queue, or task writes.
    expect(persist).not.toHaveBeenCalled()
    expect(updateMessage).not.toHaveBeenCalled()
    expect(updatePart).not.toHaveBeenCalled()
  })

  test("prefers an explicit request model over the session model", async () => {
    const { getModel, stream } = setup(history())
    const override = { providerID: ProviderID.make("anthropic"), modelID: "claude-sonnet-5" as never }
    await SessionBtw.generate({ sessionID, question: "Which model are you?", model: override })
    expect(getModel).toHaveBeenCalledWith(override.providerID, override.modelID)
    expect(stream).toHaveBeenCalledWith(expect.objectContaining({ model: expect.anything() }))
  })

  test("rejects with an unavailable error when the session has no history", async () => {
    const { agent, stream } = setup([])
    const failure = await SessionBtw.generate({ sessionID, question: "anything?" }).catch((error: unknown) => error)
    expect(SessionBtw.UnavailableError.isInstance(failure)).toBe(true)
    expect(agent).not.toHaveBeenCalled()
    expect(stream).not.toHaveBeenCalled()
  })

  test("wraps model failures as unavailable errors without writing anything", async () => {
    const { stream, persist, updateMessage } = setup(history())
    stream.mockRejectedValue(new Error("provider unreachable"))
    const failure = await SessionBtw.generate({ sessionID, question: "status?" }).catch((error: unknown) => error)
    expect(SessionBtw.UnavailableError.isInstance(failure)).toBe(true)
    if (SessionBtw.UnavailableError.isInstance(failure)) {
      expect(failure.data.message).toContain("provider unreachable")
    }
    expect(persist).not.toHaveBeenCalled()
    expect(updateMessage).not.toHaveBeenCalled()
  })

  test("rejects when the model returns no usable text", async () => {
    const { stream } = setup(history())
    stream.mockResolvedValue({ text: Promise.resolve("<think>only thinking</think>") } as unknown as Awaited<
      ReturnType<typeof LLM.stream>
    >)
    const failure = await SessionBtw.generate({ sessionID, question: "status?" }).catch((error: unknown) => error)
    expect(SessionBtw.UnavailableError.isInstance(failure)).toBe(true)
  })
})
