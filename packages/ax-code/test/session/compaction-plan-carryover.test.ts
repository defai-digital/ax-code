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
import { MessageID } from "../../src/session/schema"
import { Todo } from "../../src/session/todo"

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

/** Scripted SessionProcessor: success by default, or a scripted provider failure. */
function mockProcessor(script: Array<"continue" | "fail"> = []) {
  let attempt = 0
  const spy = vi.spyOn(SessionProcessor, "create").mockImplementation((input) => {
    const step = script[attempt] ?? "continue"
    attempt += 1
    return {
      get message() {
        return input.assistantMessage
      },
      async process() {
        if (step === "fail") {
          input.assistantMessage.error = new MessageV2.APIError({
            message: "Service Unavailable",
            statusCode: 503,
            isRetryable: true,
          }).toObject()
          return "stop"
        }
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

function withCompactionModelMocks<T>(fn: () => Promise<T>, script: Array<"continue" | "fail"> = []): Promise<T> {
  const small = createModel({ providerID: "test", modelID: "test-small" })
  const session = createModel({ providerID: "test", modelID: "test-model" })
  const smallSpy = vi.spyOn(Provider, "getSmallModel").mockResolvedValue(small)
  const { getModel } = mockProviders({ "test/test-model": session, "test/test-small": small })
  const processor = mockProcessor(script)
  return fn().finally(() => {
    processor.spy.mockRestore()
    smallSpy.mockRestore()
    getModel.mockRestore()
  })
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
  if (user.role !== "user") throw new Error("Expected the seeded user message")
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

async function planParts(messageID: MessageID) {
  const parts = await MessageV2.parts(messageID)
  return parts.filter(
    (part) => part.type === "text" && part.metadata?.purpose === SessionCompaction.PLAN_CARRYOVER_PURPOSE,
  )
}

const TODO = (content: string, status: Todo.Info["status"]): Todo.Info => ({ content, status, priority: "medium" })

describe("session.compaction.renderPlanCarryover", () => {
  test("returns undefined for an empty list", () => {
    expect(SessionCompaction.renderPlanCarryover([])).toBeUndefined()
  })

  test("drops cancelled items, keeps active items and the completed tail", () => {
    const rendered = SessionCompaction.renderPlanCarryover([
      TODO("Shipped step", "completed"),
      TODO("Dropped step", "cancelled"),
      TODO("Current step", "in_progress"),
      TODO("Next step", "pending"),
    ])
    expect(rendered).toBeDefined()
    expect(rendered).toContain(SessionCompaction.PLAN_CARRYOVER_HEADING)
    expect(rendered).toContain("- [in_progress] Current step")
    expect(rendered).toContain("- [pending] Next step")
    expect(rendered).toContain("- [completed] Shipped step")
    expect(rendered).not.toContain("Dropped step")
  })

  test("keeps only the most recent completed items for continuity", () => {
    const rendered = SessionCompaction.renderPlanCarryover([
      TODO("Done 1", "completed"),
      TODO("Done 2", "completed"),
      TODO("Done 3", "completed"),
      TODO("Done 4", "completed"),
      TODO("Only active step", "pending"),
    ])
    expect(rendered).not.toContain("Done 1")
    expect(rendered).toContain("Done 4")
  })

  test("discloses omitted items once the cap is reached", () => {
    const todos = Array.from({ length: 60 }, (_, i) => TODO(`Step ${i}`, "pending"))
    const rendered = SessionCompaction.renderPlanCarryover(todos)
    expect(rendered).toContain("- [pending] Step 49")
    expect(rendered).not.toContain("- [pending] Step 50")
    expect(rendered).toContain("10 more items omitted")
  })

  test("omits the disclosure line at exactly the cap and adds it one item later", () => {
    const atCap = SessionCompaction.renderPlanCarryover(
      Array.from({ length: 50 }, (_, i) => TODO(`Step ${i}`, "pending")),
    )
    expect(atCap).not.toContain("more items omitted")
    const overCap = SessionCompaction.renderPlanCarryover(
      Array.from({ length: 51 }, (_, i) => TODO(`Step ${i}`, "pending")),
    )
    expect(overCap).toContain("1 more items omitted")
  })

  test("carries nothing when every item is finished", () => {
    expect(
      SessionCompaction.renderPlanCarryover([TODO("Done 1", "completed"), TODO("Done 2", "completed")]),
    ).toBeUndefined()
  })
})

describe("session.compaction plan carryover", () => {
  test("a successful compaction carries the live todo list on the summary message", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        await withCompactionModelMocks(async () => {
          const { session: s, user } = await seedSession()
          Todo.update({
            sessionID: s.id,
            todos: [TODO("Investigate regression", "in_progress"), TODO("Add coverage", "pending")],
          })

          const result = await SessionCompaction.process({
            parentID: user.id,
            messages: await Session.messages({ sessionID: s.id }),
            sessionID: s.id,
            abort: new AbortController().signal,
            auto: true,
          })

          expect(result).toBe("continue")
          const summary = await summaryAssistant(s.id)
          const carried = await planParts(summary.id)
          expect(carried).toHaveLength(1)
          const text = carried[0]?.type === "text" ? carried[0].text : ""
          expect(text).toContain(SessionCompaction.PLAN_CARRYOVER_HEADING)
          expect(text).toContain("- [in_progress] Investigate regression")
          expect(text).toContain("- [pending] Add coverage")
        })
      },
    })
  })

  test("carries the plan in a supervised (non-auto) compaction too", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        await withCompactionModelMocks(async () => {
          const { session: s, user } = await seedSession()
          Todo.update({ sessionID: s.id, todos: [TODO("Manual compact step", "pending")] })

          const result = await SessionCompaction.process({
            parentID: user.id,
            messages: await Session.messages({ sessionID: s.id }),
            sessionID: s.id,
            abort: new AbortController().signal,
            auto: false,
          })

          expect(result).toBe("continue")
          const summary = await summaryAssistant(s.id)
          expect(await planParts(summary.id)).toHaveLength(1)
        })
      },
    })
  })

  test("appends nothing when the session has no todos", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        await withCompactionModelMocks(async () => {
          const { session: s, user } = await seedSession()

          const result = await SessionCompaction.process({
            parentID: user.id,
            messages: await Session.messages({ sessionID: s.id }),
            sessionID: s.id,
            abort: new AbortController().signal,
            auto: true,
          })

          expect(result).toBe("continue")
          const summary = await summaryAssistant(s.id)
          expect(await planParts(summary.id)).toHaveLength(0)
        })
      },
    })
  })

  test("a todo read failure does not fail the compaction", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        await withCompactionModelMocks(async () => {
          const { session: s, user } = await seedSession()
          Todo.update({ sessionID: s.id, todos: [TODO("Unreadable step", "pending")] })
          const read = vi.spyOn(Todo, "get").mockImplementation(() => {
            throw new Error("todo table unavailable")
          })
          try {
            const result = await SessionCompaction.process({
              parentID: user.id,
              messages: await Session.messages({ sessionID: s.id }),
              sessionID: s.id,
              abort: new AbortController().signal,
              auto: true,
            })

            expect(result).toBe("continue")
            const summary = await summaryAssistant(s.id)
            expect(await planParts(summary.id)).toHaveLength(0)
          } finally {
            read.mockRestore()
          }
        })
      },
    })
  })

  test("appends at most once per summary message", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        await withCompactionModelMocks(async () => {
          const { session: s, user } = await seedSession()
          Todo.update({ sessionID: s.id, todos: [TODO("Idempotent step", "pending")] })

          await SessionCompaction.process({
            parentID: user.id,
            messages: await Session.messages({ sessionID: s.id }),
            sessionID: s.id,
            abort: new AbortController().signal,
            auto: true,
          })

          const summary = await summaryAssistant(s.id)
          expect(await SessionCompaction.appendPlanCarryover({ sessionID: s.id, messageID: summary.id })).toBe(false)
          expect(await planParts(summary.id)).toHaveLength(1)
        })
      },
    })
  })

  test("the carried plan survives filterCompacted for the next turn", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        await withCompactionModelMocks(async () => {
          const { session: s, user } = await seedSession()
          Todo.update({ sessionID: s.id, todos: [TODO("Survives the rewrite", "in_progress")] })

          await SessionCompaction.process({
            parentID: user.id,
            messages: await Session.messages({ sessionID: s.id }),
            sessionID: s.id,
            abort: new AbortController().signal,
            auto: true,
          })

          const surviving = await MessageV2.filterCompacted(MessageV2.stream(s.id))
          const carried = surviving.flatMap((message) =>
            message.parts.filter(
              (part) => part.type === "text" && part.metadata?.purpose === SessionCompaction.PLAN_CARRYOVER_PURPOSE,
            ),
          )
          expect(carried).toHaveLength(1)
        })
      },
    })
  })

  test("the carried plan reaches the next model request", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        await withCompactionModelMocks(async () => {
          const { session: s, user } = await seedSession()
          Todo.update({ sessionID: s.id, todos: [TODO("Reach the model", "in_progress")] })

          await SessionCompaction.process({
            parentID: user.id,
            messages: await Session.messages({ sessionID: s.id }),
            sessionID: s.id,
            abort: new AbortController().signal,
            auto: true,
          })

          const surviving = await MessageV2.filterCompacted(MessageV2.stream(s.id))
          const converted = await MessageV2.toModelMessages(
            surviving,
            createModel({ providerID: "test", modelID: "test-model" }),
          )
          // Request content is a provider-shaped union; normalize it to text.
          const text: string[] = []
          for (const message of converted) {
            if (!Array.isArray(message.content)) continue
            for (const part of message.content as Array<{ type: string; text?: string }>) {
              if (part.type === "text" && typeof part.text === "string") text.push(part.text)
            }
          }
          expect(text.join("\n")).toContain(SessionCompaction.PLAN_CARRYOVER_HEADING)
          expect(text.join("\n")).toContain("- [in_progress] Reach the model")
        })
      },
    })
  })

  test("a failed compaction carries nothing", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        await withCompactionModelMocks(async () => {
          const { session: s, user } = await seedSession()
          Todo.update({ sessionID: s.id, todos: [TODO("Never carried", "pending")] })

          const result = await SessionCompaction.process({
            parentID: user.id,
            messages: await Session.messages({ sessionID: s.id }),
            sessionID: s.id,
            abort: new AbortController().signal,
            auto: true,
          })

          expect(result).toBe("stop")
          const messages: MessageV2.WithParts[] = await Session.messages({ sessionID: s.id })
          const carried = messages.flatMap((message) =>
            message.parts.filter(
              (part) => part.type === "text" && part.metadata?.purpose === SessionCompaction.PLAN_CARRYOVER_PURPOSE,
            ),
          )
          expect(carried).toHaveLength(0)
        }, ["fail", "fail"])
      },
    })
  })

  test("an append failure does not fail the compaction", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        await withCompactionModelMocks(async () => {
          const { session: s, user } = await seedSession()
          Todo.update({ sessionID: s.id, todos: [TODO("Unwritable step", "pending")] })
          const write = vi.spyOn(Session, "updatePart").mockRejectedValue(new Error("part store unavailable"))
          try {
            const result = await SessionCompaction.process({
              parentID: user.id,
              messages: await Session.messages({ sessionID: s.id }),
              sessionID: s.id,
              abort: new AbortController().signal,
              auto: true,
            })

            expect(result).toBe("continue")
            const summary = await summaryAssistant(s.id)
            expect(await planParts(summary.id)).toHaveLength(0)
          } finally {
            write.mockRestore()
          }
        })
      },
    })
  })

  test("an unreadable part list skips the append instead of risking a duplicate", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const { session: s, user } = await seedSession()
        Todo.update({ sessionID: s.id, todos: [TODO("Unverifiable step", "pending")] })
        const summary = await Session.updateMessage({
          id: MessageID.ascending(),
          sessionID: s.id,
          parentID: user.id,
          role: "assistant",
          time: { created: Date.now(), completed: Date.now() },
          modelID: "test-model",
          providerID: "test",
          mode: "compaction",
          agent: "compaction",
          path: { cwd: tmp.path, root: tmp.path },
          tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
          summary: true,
        } as unknown as MessageV2.Assistant)

        const read = vi.spyOn(MessageV2, "parts").mockRejectedValue(new Error("part read unavailable"))
        try {
          expect(await SessionCompaction.appendPlanCarryover({ sessionID: s.id, messageID: summary.id })).toBe(false)
        } finally {
          read.mockRestore()
        }
        expect(await planParts(summary.id)).toHaveLength(0)
      },
    })
  })
})
