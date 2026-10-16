import { describe, expect, test, vi } from "vitest"
import { SessionCompaction } from "../../src/session/compaction"
import { Session } from "../../src/session"
import { SessionProcessor } from "../../src/session/processor"
import { Instance } from "../../src/project/instance"
import { Log } from "../../src/util/log"
import { tmpdir } from "../fixture/fixture"
import { MessageV2 } from "../../src/session/message-v2"
import { ModelID, ProviderID } from "../../src/provider/schema"
import { Provider } from "../../src/provider/provider"
import { MessageID, PartID, SessionID } from "../../src/session/schema"

Log.init({ print: false })

const { renderPinnedContext, PINNED_CONTEXT_PURPOSE, PINNED_CONTEXT_HEADING } = SessionCompaction

const PIN = (messageID: MessageID, text: string): Session.Pin => ({ messageID, text })

describe("session.compaction.renderPinnedContext (ADR-226)", () => {
  test("returns undefined with no pins", () => {
    expect(renderPinnedContext([])).toBeUndefined()
  })

  test("heads the block as background context from the user, verbatim", () => {
    const text = renderPinnedContext([PIN(MessageID.ascending(), "Never touch the prod database.")])!
    expect(text).toContain(PINNED_CONTEXT_HEADING)
    expect(text).toContain("Never touch the prod database.")
    // Explicitly framed as not-a-new-task so a weak model does not restart it.
    expect(text).toContain("not as new requests")
  })

  test("caps the count at PIN_MAX_COUNT, keeping the newest and disclosing the rest", () => {
    const pins = Array.from({ length: Session.PIN_MAX_COUNT + 3 }, (_, i) => PIN(MessageID.ascending(), `pin ${i}`))
    const text = renderPinnedContext(pins)!
    expect(text).toContain(`pin ${Session.PIN_MAX_COUNT + 2}`)
    expect(text).not.toContain("pin 0\n")
    expect(text).toContain("3 older pinned messages omitted")
  })

  test("caps each pinned text at PIN_MAX_CHARS", () => {
    const text = renderPinnedContext([PIN(MessageID.ascending(), "a".repeat(Session.PIN_MAX_CHARS + 100))])!
    expect(text).toContain("a".repeat(Session.PIN_MAX_CHARS))
    expect(text).not.toContain("a".repeat(Session.PIN_MAX_CHARS + 1))
  })
})

describe("session.pins storage (ADR-226)", () => {
  test("setPin / removePin round-trip and dedupe by message", async () => {
    await using tmp = await tmpdir({ config: { username: "testuser" } })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({})
        const m1 = MessageID.ascending()
        const m2 = MessageID.ascending()
        await Session.setPin({ sessionID: session.id, messageID: m1, text: "keep me" })
        await Session.setPin({ sessionID: session.id, messageID: m1, text: "keep me v2" })
        let pins = (await Session.get(session.id)).pins ?? []
        expect(pins).toHaveLength(1)
        expect(pins[0]!.text).toBe("keep me v2")

        await Session.setPin({ sessionID: session.id, messageID: m2, text: "and me" })
        pins = (await Session.get(session.id)).pins ?? []
        expect(pins.map((pin) => pin.messageID)).toEqual([m1, m2])

        await Session.removePin({ sessionID: session.id, messageID: m1 })
        pins = (await Session.get(session.id)).pins ?? []
        expect(pins.map((pin) => pin.messageID)).toEqual([m2])
      },
    })
  })

  test("caps the stored text at PIN_MAX_CHARS and the count at PIN_MAX_COUNT", async () => {
    await using tmp = await tmpdir({ config: { username: "testuser" } })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({})
        await Session.setPin({
          sessionID: session.id,
          messageID: MessageID.ascending(),
          text: "x".repeat(Session.PIN_MAX_CHARS + 500),
        })
        for (let i = 0; i < Session.PIN_MAX_COUNT + 2; i++) {
          await Session.setPin({ sessionID: session.id, messageID: MessageID.ascending(), text: `pin ${i}` })
        }
        const pins = (await Session.get(session.id)).pins ?? []
        expect(pins).toHaveLength(Session.PIN_MAX_COUNT)
        // The long pin (oldest) was evicted; the newest cap-1 stay.
        expect(pins.at(-1)!.text).toBe(`pin ${Session.PIN_MAX_COUNT + 1}`)
      },
    })
  })

  test("prunePins drops pins whose message is gone", async () => {
    await using tmp = await tmpdir({ config: { username: "testuser" } })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({})
        const keep = MessageID.ascending()
        await Session.setPin({ sessionID: session.id, messageID: keep, text: "keep" })
        await Session.setPin({ sessionID: session.id, messageID: MessageID.ascending(), text: "gone" })
        await Session.prunePins(session.id, new Set([keep]))
        const pins = (await Session.get(session.id)).pins ?? []
        expect(pins.map((pin) => pin.messageID)).toEqual([keep])
      },
    })
  })

  test("a corrupt pins payload is dropped without hiding the session", async () => {
    await using tmp = await tmpdir({ config: { username: "testuser" } })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({})
        // Simulate a legacy/corrupt row: a valid session but a bogus pins blob.
        const { Database } = await import("../../src/storage/db")
        const { SessionTable } = await import("../../src/session/session.sql")
        const { eq } = await import("drizzle-orm")
        Database.use((db) => {
          db.update(SessionTable)
            .set({ pins: [{ nonsense: true }] as never })
            .where(eq(SessionTable.id, session.id))
            .run()
        })
        const reloaded = await Session.get(session.id)
        expect(reloaded.id).toBe(session.id)
        expect(reloaded.pins ?? []).toEqual([])
      },
    })
  })

  test("pins copy on fork with remapped message ids, signed=cutoff excluded", async () => {
    await using tmp = await tmpdir({ config: { username: "testuser" } })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const source = await Session.create({})
        const kept = await seedMessage(source.id, "keep me")
        const cut = await seedMessage(source.id, "revert me")
        await Session.setPin({ sessionID: source.id, messageID: kept, text: "keep me" })
        await Session.setPin({ sessionID: source.id, messageID: cut, text: "revert me" })

        // Fork at the cutoff: the pin on the cutoff message falls outside the
        // copied history and must be dropped; the kept pin is remapped.
        const fork = await Session.fork({ sessionID: source.id, messageID: cut })
        const pins = (await Session.get(fork.id)).pins ?? []
        expect(pins).toHaveLength(1)
        expect(pins[0]!.text).toBe("keep me")
        expect(pins[0]!.messageID).not.toBe(kept)
        // The remapped pin points at the copied message in the fork.
        const forkMessages = await Session.messages({ sessionID: fork.id })
        expect(forkMessages.some((m) => m.info.id === pins[0]!.messageID)).toBe(true)
      },
    })
  })
})

/** Seed a user message with one text part; returns the message id. */
async function seedMessage(sessionID: SessionID, text: string): Promise<MessageID> {
  const id = MessageID.ascending()
  await Session.updateMessage({
    id,
    sessionID,
    role: "user",
    time: { created: Date.now() },
    agent: "build",
    model: { providerID: ProviderID.make("test"), modelID: ModelID.make("test-model") },
    tools: {},
    mode: "build",
  } as never)
  await Session.updatePart({ id: PartID.ascending(), messageID: id, sessionID, type: "text", text } as never)
  return id
}

// --- compaction integration: pins land in the continued context -------------

function createModel(opts: { providerID: string; modelID: string }): Provider.Model {
  return {
    id: ModelID.make(opts.modelID),
    providerID: ProviderID.make(opts.providerID),
    name: `${opts.providerID}/${opts.modelID}`,
    limit: { context: 100_000, input: 80_000, output: 32_000 },
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

function withCompactionModelMocks<T>(fn: () => Promise<T>): Promise<T> {
  const small = createModel({ providerID: "test", modelID: "test-small" })
  const session = createModel({ providerID: "test", modelID: "test-model" })
  const smallSpy = vi.spyOn(Provider, "getSmallModel").mockResolvedValue(small)
  const models: Record<string, Provider.Model> = { "test/test-model": session, "test/test-small": small }
  const getModel = vi.spyOn(Provider, "getModel").mockImplementation(async (providerID, modelID) => {
    const model = models[`${providerID}/${modelID}`]
    if (!model) throw new Error(`model not found: ${providerID}/${modelID}`)
    return model
  })
  const processor = mockProcessor()
  return fn().finally(() => {
    processor.spy.mockRestore()
    smallSpy.mockRestore()
    getModel.mockRestore()
  })
}

async function seedUser(text: string) {
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
  await Session.updatePart({ id: PartID.ascending(), messageID: user.id, sessionID: session.id, type: "text", text })
  return { session, user }
}

async function summaryAssistant(sessionID: string) {
  const messages = await Session.messages({ sessionID: sessionID as never })
  const summary = messages
    .map((m) => m.info)
    .filter((info): info is MessageV2.Assistant => info.role === "assistant" && info.summary === true)
    .sort((a, b) => a.time.created - b.time.created)
    .at(-1)
  if (!summary) throw new Error("Expected a compaction summary assistant message")
  return summary
}

async function pinnedParts(messageID: MessageID) {
  const parts = await MessageV2.parts(messageID)
  return parts.filter((part) => part.type === "text" && part.metadata?.purpose === PINNED_CONTEXT_PURPOSE)
}

describe("session.compaction pinned context (ADR-226)", () => {
  test("pins are appended verbatim to the summary and survive filterCompacted", async () => {
    await using tmp = await tmpdir({ config: { username: "testuser" } })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        await withCompactionModelMocks(async () => {
          const { session, user } = await seedUser("do the thing")
          await Session.setPin({ sessionID: session.id, messageID: user.id, text: "Never touch the prod database." })

          await SessionCompaction.process({
            parentID: user.id,
            messages: await Session.messages({ sessionID: session.id }),
            sessionID: session.id,
            abort: new AbortController().signal,
            auto: true,
          })

          const summary = await summaryAssistant(session.id)
          const pinned = await pinnedParts(summary.id)
          expect(pinned).toHaveLength(1)
          expect(pinned[0]!.type === "text" ? pinned[0]!.text : "").toContain("Never touch the prod database.")

          // The block survives the history rewrite and reaches the next turn.
          const surviving = await MessageV2.filterCompacted(MessageV2.stream(session.id))
          const survivingParts = surviving.flatMap((m) => m.parts)
          expect(
            survivingParts.some((part) => part.type === "text" && part.metadata?.purpose === PINNED_CONTEXT_PURPOSE),
          ).toBe(true)
        })
      },
    })
  })

  test("appends nothing when the session has no pins", async () => {
    await using tmp = await tmpdir({ config: { username: "testuser" } })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        await withCompactionModelMocks(async () => {
          const { session, user } = await seedUser("no pins here")
          await SessionCompaction.process({
            parentID: user.id,
            messages: await Session.messages({ sessionID: session.id }),
            sessionID: session.id,
            abort: new AbortController().signal,
            auto: true,
          })
          const summary = await summaryAssistant(session.id)
          expect(await pinnedParts(summary.id)).toHaveLength(0)
        })
      },
    })
  })
})
