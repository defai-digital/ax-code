import { afterEach, describe, expect, test } from "vitest"
import { tmpdir } from "../fixture/fixture"
import { Instance } from "../../src/project/instance"
import { Session } from "../../src/session"
import { MessageV2 } from "../../src/session/message-v2"
import { MessageID, PartID, type SessionID } from "../../src/session/schema"
import { SessionCompaction } from "../../src/session/compaction"
import { effectiveTokenTotal } from "../../src/session/compaction-budget"
import { ToolRegistry } from "../../src/tool/registry"
import { Provider } from "../../src/provider/provider"
import { ModelID, ProviderID } from "../../src/provider/schema"

afterEach(async () => {
  await Instance.disposeAll()
})

const PROVIDER_ID = "context-status-provider"
const MODEL_ID = "context-status-model"
const LIMIT = { context: 200_000, input: 100_000, output: 8_000 }

function project(config?: { contextTools?: boolean }) {
  return tmpdir({
    config: {
      ...(config?.contextTools ? { experimental: { context_tools: true } } : {}),
      provider: {
        [PROVIDER_ID]: {
          name: "Context Status Provider",
          npm: "cli",
          env: [],
          models: {
            [MODEL_ID]: {
              name: "Context Status Model",
              limit: LIMIT,
            },
          },
        },
      },
    } as any,
  })
}

const modelRef = {
  providerID: ProviderID.make(PROVIDER_ID),
  modelID: ModelID.make(MODEL_ID),
}

function toolContext(sessionID: SessionID, messages: MessageV2.WithParts[]) {
  return {
    sessionID,
    messageID: MessageID.ascending(),
    callID: "",
    agent: "build",
    abort: AbortSignal.any([]),
    messages,
    metadata: () => {},
    ask: async () => {},
    extra: {},
  } as any
}

const ASSISTANT_TOKENS = {
  input: 50_000,
  output: 1_000,
  reasoning: 0,
  cache: { read: 0, write: 0 },
}

async function seedConversation(sessionID: SessionID, directory: string) {
  const user = await Session.updateMessage({
    id: MessageID.ascending(),
    sessionID,
    role: "user",
    time: { created: Date.now() },
    agent: "build",
    model: modelRef,
  } as any)
  await Session.updateMessage({
    id: MessageID.ascending(),
    parentID: user.id,
    sessionID,
    role: "assistant",
    mode: "build",
    agent: "build",
    path: { cwd: directory, root: directory },
    tokens: ASSISTANT_TOKENS,
    modelID: modelRef.modelID,
    providerID: modelRef.providerID,
    time: { created: Date.now(), completed: Date.now() },
  } as MessageV2.Assistant)
}

describe("tool.context_status", () => {
  test("is absent from the tool list without experimental.context_tools", async () => {
    await using tmp = await project()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        expect(await ToolRegistry.ids()).not.toContain("context_status")
        const tools = await ToolRegistry.tools(modelRef)
        expect(tools.map((tool) => tool.id)).not.toContain("context_status")
      },
    })
  })

  test("is present with the flag and returns the compactor's budget numbers", async () => {
    await using tmp = await project({ contextTools: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const tools = await ToolRegistry.tools(modelRef)
        const tool = tools.find((candidate) => candidate.id === "context_status")
        expect(tool).toBeDefined()

        const session = await Session.create({})
        await seedConversation(session.id, tmp.path)
        const messages = await Session.messages({ sessionID: session.id })

        const result = await tool!.execute({}, toolContext(session.id, messages))

        const model = await Provider.getModel(modelRef.providerID, modelRef.modelID)
        const expected = await SessionCompaction.budget(model)
        expect(expected).toBeDefined()

        expect(result.metadata.cap).toBe(expected!.cap)
        expect(result.metadata.usable).toBe(expected!.usable)
        expect(result.metadata.used).toBe(effectiveTokenTotal(ASSISTANT_TOKENS))
        expect(result.metadata.headroom).toBe(expected!.usable - effectiveTokenTotal(ASSISTANT_TOKENS))

        const status = JSON.parse(result.output)
        expect(status).toEqual({
          cap: expected!.cap,
          usable: expected!.usable,
          used: effectiveTokenTotal(ASSISTANT_TOKENS),
          headroom: expected!.usable - effectiveTokenTotal(ASSISTANT_TOKENS),
        })
      },
    })
  })

  test("reports the latest step's usage, not the turn-cumulative message total", async () => {
    await using tmp = await project({ contextTools: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const tools = await ToolRegistry.tools(modelRef)
        const tool = tools.find((candidate) => candidate.id === "context_status")

        const session = await Session.create({})
        const user = await Session.updateMessage({
          id: MessageID.ascending(),
          sessionID: session.id,
          role: "user",
          time: { created: Date.now() },
          agent: "build",
          model: modelRef,
        } as any)
        const assistant = await Session.updateMessage({
          id: MessageID.ascending(),
          parentID: user.id,
          sessionID: session.id,
          role: "assistant",
          mode: "build",
          agent: "build",
          path: { cwd: tmp.path, root: tmp.path },
          // Three tool-calling steps at ~30k context each accumulate to 93k
          // on the message totals — over the 90k usable budget — while the
          // actual current context is only the latest step's 31k.
          tokens: { input: 90_000, output: 3_000, reasoning: 0, cache: { read: 0, write: 0 } },
          modelID: modelRef.modelID,
          providerID: modelRef.providerID,
          time: { created: Date.now(), completed: Date.now() },
        } as MessageV2.Assistant)
        const stepTokens = { input: 30_000, output: 1_000, reasoning: 0, cache: { read: 0, write: 0 } }
        for (const [index, reason] of ["tool-calls", "tool-calls", "stop"].entries()) {
          await Session.updatePart({
            id: PartID.ascending(),
            messageID: assistant.id,
            sessionID: session.id,
            type: "step-finish",
            reason,
            tokens: index === 2 ? stepTokens : { ...stepTokens, input: 29_000 + index * 500 },
          })
        }

        const messages = await Session.messages({ sessionID: session.id })
        const result = await tool!.execute({}, toolContext(session.id, messages))

        expect(result.metadata.used).toBe(effectiveTokenTotal(stepTokens))
        expect(result.metadata.used).not.toBe(93_000)
      },
    })
  })

  test("reports zero usage for a session without assistant responses", async () => {
    await using tmp = await project({ contextTools: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const tools = await ToolRegistry.tools(modelRef)
        const tool = tools.find((candidate) => candidate.id === "context_status")
        const session = await Session.create({})

        const result = await tool!.execute({}, toolContext(session.id, []))

        const model = await Provider.getModel(modelRef.providerID, modelRef.modelID)
        const expected = await SessionCompaction.budget(model)
        expect(result.metadata.used).toBe(0)
        expect(result.metadata.headroom).toBe(expected!.usable)
      },
    })
  })

  test("does not mutate session state", async () => {
    await using tmp = await project({ contextTools: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const tools = await ToolRegistry.tools(modelRef)
        const tool = tools.find((candidate) => candidate.id === "context_status")

        const session = await Session.create({})
        await seedConversation(session.id, tmp.path)
        const before = await Session.messages({ sessionID: session.id })
        const beforeSession = await Session.get(session.id)

        await tool!.execute({}, toolContext(session.id, before))

        const after = await Session.messages({ sessionID: session.id })
        const afterSession = await Session.get(session.id)
        expect(after).toEqual(before)
        expect(afterSession).toEqual(beforeSession)
      },
    })
  })
})
