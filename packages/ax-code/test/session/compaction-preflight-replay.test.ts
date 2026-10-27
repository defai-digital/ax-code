import { describe, expect, test, vi } from "vitest"
import { SessionCompaction } from "../../src/session/compaction"
import { SessionProcessor } from "../../src/session/processor"
import { Instance } from "../../src/project/instance"
import { Log } from "../../src/util/log"
import { tmpdir } from "../fixture/fixture"
import { Session } from "../../src/session"
import { MessageV2 } from "../../src/session/message-v2"
import { ModelID, ProviderID } from "../../src/provider/schema"
import { Provider } from "../../src/provider/provider"
import { MessageID, PartID, type SessionID } from "../../src/session/schema"

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

/** Scripted SessionProcessor: succeeds without touching a provider. */
function mockProcessor() {
  const spy = vi.spyOn(SessionProcessor, "create").mockImplementation((input) => {
    return {
      get message() {
        return input.assistantMessage
      },
      async process() {
        return "continue"
      },
    } as unknown as SessionProcessor.Info
  })
  return { spy }
}

function mockProviders(models: Record<string, Provider.Model>) {
  const getModel = vi.spyOn(Provider, "getModel").mockImplementation(async (providerID, modelID) => {
    const model = models[`${providerID}/${modelID}`]
    if (!model) throw new Error(`model not found: ${providerID}/${modelID}`)
    return model
  })
  return { getModel }
}

function withCompactionModelMocks<T>(fn: () => Promise<T>): Promise<T> {
  const small = createModel({ providerID: "test", modelID: "test-small" })
  const session = createModel({ providerID: "test", modelID: "test-model" })
  const smallSpy = vi.spyOn(Provider, "getSmallModel").mockResolvedValue(small)
  const { getModel } = mockProviders({ "test/test-model": session, "test/test-small": small })
  const processor = mockProcessor()
  return fn().finally(() => {
    processor.spy.mockRestore()
    smallSpy.mockRestore()
    getModel.mockRestore()
  })
}

const userModel = () => ({ providerID: ProviderID.make("test"), modelID: ModelID.make("test-model") })

async function createUserTurn(sessionID: SessionID, text: string) {
  const user = await Session.updateMessage({
    id: MessageID.ascending(),
    sessionID,
    role: "user",
    time: { created: Date.now() },
    agent: "build",
    model: userModel(),
    tools: {},
    mode: "build",
  } as MessageV2.User)
  await Session.updatePart({
    id: PartID.ascending(),
    messageID: user.id,
    sessionID,
    type: "text",
    text,
    time: { start: Date.now(), end: Date.now() },
  })
  return user
}

/** A fully answered exchange: user turn plus a finished assistant response. */
async function createAnsweredTurn(sessionID: SessionID, text: string) {
  const user = await createUserTurn(sessionID, text)
  const assistant = await Session.updateMessage({
    id: MessageID.ascending(),
    parentID: user.id,
    sessionID,
    role: "assistant",
    mode: "build",
    agent: "build",
    path: { cwd: "/", root: "/" },
    finish: "stop",
    tokens: { input: 1_000, output: 1_000, reasoning: 0, cache: { read: 0, write: 0 } },
    modelID: ModelID.make("test-model"),
    providerID: ProviderID.make("test"),
    time: { created: Date.now(), completed: Date.now() },
  } as MessageV2.Assistant)
  await Session.updatePart({
    id: PartID.ascending(),
    messageID: assistant.id,
    sessionID,
    type: "text",
    text: "Acknowledged.",
    time: { start: Date.now(), end: Date.now() },
  })
  return { user, assistant }
}

/**
 * Schedule a compaction marker exactly like the prompt loop does and return
 * the inputs processPendingCompaction would pass to SessionCompaction.process.
 */
async function scheduleCompaction(input: {
  sessionID: SessionID
  triggerReason: "prompt_preflight" | "provider_usage" | "context_overflow_error"
  overflow?: boolean
}) {
  await SessionCompaction.create({
    sessionID: input.sessionID,
    agent: "build",
    model: userModel(),
    auto: true,
    overflow: input.overflow,
    triggerReason: input.triggerReason,
  })
  const messages = await Session.messages({ sessionID: input.sessionID })
  const parent = messages.at(-1)
  if (!parent) throw new Error("Expected the compaction marker message")
  return { messages, parentID: parent.info.id }
}

/** The continued context the next prompt-loop step sees, plus its post-summary tail. */
async function continuedContext(sessionID: SessionID) {
  const surviving = await MessageV2.filterCompacted(MessageV2.stream(sessionID))
  const summaryIdx = surviving.findIndex((m) => m.info.role === "assistant" && m.info.summary === true)
  if (summaryIdx === -1) throw new Error("Expected the compaction summary in the continued context")
  return { surviving, afterSummary: surviving.slice(summaryIdx + 1) }
}

function userTextParts(messages: MessageV2.WithParts[]) {
  return messages
    .filter((m) => m.info.role === "user")
    .flatMap((m) => m.parts)
    .filter((part): part is MessageV2.TextPart => part.type === "text")
}

const PENDING_PROMPT = "Unanswered: fix the login bug in src/auth.ts before the 7.31 release"
const ANSWERED_PROMPT = "Answered: summarize the migration plan"
const CONTINUE_MARKER = "Continue if you have next steps"

describe("session.compaction preflight replay", () => {
  test("a prompt-preflight compaction replays the unanswered user turn verbatim after the summary", async () => {
    // `username` keeps Config.loadState off os.userInfo(), which throws ENOENT
    // in sandboxes without a passwd entry for the current uid.
    await using tmp = await tmpdir({ config: { username: "test" } })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        await withCompactionModelMocks(async () => {
          const session = await Session.create({})
          // An answered exchange, then the new prompt that tripped preflight.
          await createAnsweredTurn(session.id, ANSWERED_PROMPT)
          await createUserTurn(session.id, PENDING_PROMPT)
          const { messages, parentID } = await scheduleCompaction({
            sessionID: session.id,
            triggerReason: "prompt_preflight",
          })

          const result = await SessionCompaction.process({
            parentID,
            messages,
            sessionID: session.id,
            abort: new AbortController().signal,
            auto: true,
            triggerReason: "prompt_preflight",
          })

          expect(result).toBe("continue")
          const { surviving, afterSummary } = await continuedContext(session.id)
          const texts = userTextParts(afterSummary)

          // The user's exact words must reach the next model request verbatim,
          // not only as the summarizer's paraphrase inside the summary.
          const replayed = texts.filter((part) => part.text.includes(PENDING_PROMPT))
          expect(replayed).toHaveLength(1)
          expect(replayed[0]?.synthetic).toBeFalsy()

          // The preflight path answered nothing yet, so the generic synthetic
          // continue text must not be the only thing the model sees.
          expect(texts.some((part) => part.text.includes(CONTINUE_MARKER))).toBe(false)

          // The replay is a fresh message after the summary; the original
          // unanswered message stays before the marker and is cut by
          // filterCompacted like the rest of the compacted history.
          const replayIDs = afterSummary
            .filter(
              (m) => m.info.role === "user" && m.parts.some((p) => p.type === "text" && p.text === PENDING_PROMPT),
            )
            .map((m) => m.info.id)
          expect(replayIDs).toHaveLength(1)
          expect(surviving.some((m) => m.info.role === "user" && m.parts.some((p) => p.type === "compaction"))).toBe(
            true,
          )
        })
      },
    })
  })

  test("an auto compaction with a keep window sends the unanswered turn exactly once", async () => {
    await using tmp = await tmpdir({ config: { username: "test" } })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        await withCompactionModelMocks(async () => {
          const session = await Session.create({})
          await createAnsweredTurn(session.id, ANSWERED_PROMPT)
          await createUserTurn(session.id, PENDING_PROMPT)
          await SessionCompaction.create({
            sessionID: session.id,
            agent: "build",
            model: userModel(),
            auto: true,
            keep: 1,
            triggerReason: "manual",
          })
          const messages = await Session.messages({ sessionID: session.id })
          const parentID = messages.at(-1)!.info.id

          const result = await SessionCompaction.process({
            parentID,
            messages,
            sessionID: session.id,
            abort: new AbortController().signal,
            auto: true,
            keep: 1,
            triggerReason: "manual",
          })

          expect(result).toBe("continue")
          const { surviving } = await continuedContext(session.id)
          // The keep window already carries the turn verbatim; a replay on top
          // would send the same words twice.
          expect(userTextParts(surviving).filter((part) => part.text.includes(PENDING_PROMPT))).toHaveLength(1)
        })
      },
    })
  })

  test("a usage compaction after a finished turn does not replay the answered user message", async () => {
    await using tmp = await tmpdir({ config: { username: "test" } })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        await withCompactionModelMocks(async () => {
          const session = await Session.create({})
          // provider_usage compaction fires after the turn finished, so the
          // newest real user turn before the marker was answered.
          await createAnsweredTurn(session.id, ANSWERED_PROMPT)
          const { messages, parentID } = await scheduleCompaction({
            sessionID: session.id,
            triggerReason: "provider_usage",
          })

          const result = await SessionCompaction.process({
            parentID,
            messages,
            sessionID: session.id,
            abort: new AbortController().signal,
            auto: true,
            triggerReason: "provider_usage",
          })

          expect(result).toBe("continue")
          const { afterSummary } = await continuedContext(session.id)
          const texts = userTextParts(afterSummary)

          // Answered turns are covered by the summary; the synthetic continue
          // remains the post-compaction turn, and the exact words are not
          // re-sent as a fresh user message.
          expect(texts.some((part) => part.text.includes(CONTINUE_MARKER))).toBe(true)
          expect(texts.some((part) => part.text.includes(ANSWERED_PROMPT))).toBe(false)
        })
      },
    })
  })

  test("an overflow compaction still replays the unanswered turn exactly once", async () => {
    await using tmp = await tmpdir({ config: { username: "test" } })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        await withCompactionModelMocks(async () => {
          const session = await Session.create({})
          await createAnsweredTurn(session.id, ANSWERED_PROMPT)
          await createUserTurn(session.id, PENDING_PROMPT)
          const { messages, parentID } = await scheduleCompaction({
            sessionID: session.id,
            triggerReason: "context_overflow_error",
            overflow: true,
          })

          const result = await SessionCompaction.process({
            parentID,
            messages,
            sessionID: session.id,
            abort: new AbortController().signal,
            auto: true,
            overflow: true,
            triggerReason: "context_overflow_error",
          })

          expect(result).toBe("continue")
          const { afterSummary } = await continuedContext(session.id)
          const texts = userTextParts(afterSummary)

          // Exactly one verbatim replay and no synthetic continue alongside.
          expect(texts.filter((part) => part.text.includes(PENDING_PROMPT))).toHaveLength(1)
          expect(texts.some((part) => part.text.includes(CONTINUE_MARKER))).toBe(false)
        })
      },
    })
  })
})
