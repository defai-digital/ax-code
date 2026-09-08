import { describe, expect, test } from "vitest"
import { tmpdir } from "../fixture/fixture"
import { Instance } from "../../src/project/instance"
import { Session } from "../../src/session"
import { SessionUsage } from "../../src/session/usage"
import { MessageV2 } from "../../src/session/message-v2"
import { MessageID, PartID } from "../../src/session/schema"

async function seedConversation(input: {
  sessionID: string
  cwd: string
  providerID: string
  modelID: string
  tokens: { input: number; output: number; reasoning?: number; cache?: { read: number; write: number } }
  tools: string[]
}) {
  const user = await Session.updateMessage({
    id: MessageID.ascending(),
    sessionID: input.sessionID,
    role: "user",
    time: { created: Date.now() },
    agent: "build",
    model: { providerID: input.providerID, modelID: input.modelID },
  } as unknown as MessageV2.Info)
  const assistant = await Session.updateMessage({
    id: MessageID.ascending(),
    parentID: user.id,
    sessionID: input.sessionID,
    role: "assistant",
    mode: "build",
    agent: "build",
    path: { cwd: input.cwd, root: input.cwd },
    tokens: {
      input: input.tokens.input,
      output: input.tokens.output,
      reasoning: input.tokens.reasoning ?? 0,
      cache: input.tokens.cache ?? { read: 0, write: 0 },
    },
    modelID: input.modelID,
    providerID: input.providerID,
    time: { created: Date.now() },
  } as MessageV2.Assistant)
  for (const tool of input.tools) {
    await Session.updatePart({
      id: PartID.ascending(),
      sessionID: input.sessionID,
      messageID: assistant.id,
      type: "tool",
      tool,
      callID: `call-${tool}-${Math.random()}`,
      state: { status: "completed", input: {}, output: "", title: "", metadata: {}, time: { start: 0, end: 1 } },
    } as unknown as Parameters<typeof Session.updatePart>[0])
  }
}

describe("SessionUsage.load", () => {
  test("aggregates totals, models, tools, and per-session tokens", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const a = await Session.create({ title: "A" })
        await seedConversation({
          sessionID: a.id,
          cwd: tmp.path,
          providerID: "anthropic",
          modelID: "claude-sonnet-4",
          tokens: { input: 100, output: 50, reasoning: 10, cache: { read: 500, write: 40 } },
          tools: ["bash", "bash"],
        })
        const b = await Session.create({ title: "B" })
        await seedConversation({
          sessionID: b.id,
          cwd: tmp.path,
          providerID: "openai",
          modelID: "gpt-5",
          tokens: { input: 200, output: 100 },
          tools: ["edit"],
        })

        const usage = await SessionUsage.load({ projectID: Instance.project.id })

        expect(usage.sessions).toBe(2)
        expect(usage.messages).toBe(4)
        expect(usage.tokens).toEqual({
          input: 300,
          output: 150,
          reasoning: 10,
          cache: { read: 500, write: 40 },
        })
        expect(usage.totalTokens).toBe(1000)
        expect(usage.cacheShare).toBeCloseTo(500 / 800)
        expect(usage.models["anthropic/claude-sonnet-4"]).toEqual({ messages: 1, tokens: 700 })
        expect(usage.models["openai/gpt-5"]).toEqual({ messages: 1, tokens: 300 })
        expect(usage.tools).toEqual({ bash: 2, edit: 1 })
        expect(usage.perSession[a.id]).toBe(700)
        expect(usage.perSession[b.id]).toBe(300)
        expect(usage.perDay).toEqual([])
      },
    })
  })

  test("buckets the window into per-day activity with empty days included", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({ title: "Windowed" })
        await seedConversation({
          sessionID: session.id,
          cwd: tmp.path,
          providerID: "anthropic",
          modelID: "claude-sonnet-4",
          tokens: { input: 100, output: 50 },
          tools: [],
        })

        const usage = await SessionUsage.load({ days: 7, projectID: Instance.project.id })

        expect(usage.perDay).toHaveLength(7)
        const today = usage.perDay[usage.perDay.length - 1]
        expect(today.sessions).toBe(1)
        expect(today.tokens).toBe(150)
        expect(usage.perDay.slice(0, -1).every((day) => day.tokens === 0 && day.sessions === 0)).toBe(true)
        expect(usage.activeDays).toBe(1)
      },
    })
  })

  test("scopes to a single session when sessionID is given", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const a = await Session.create({ title: "Scoped A" })
        await seedConversation({
          sessionID: a.id,
          cwd: tmp.path,
          providerID: "anthropic",
          modelID: "claude-sonnet-4",
          tokens: { input: 100, output: 50 },
          tools: ["bash"],
        })
        const b = await Session.create({ title: "Scoped B" })
        await seedConversation({
          sessionID: b.id,
          cwd: tmp.path,
          providerID: "openai",
          modelID: "gpt-5",
          tokens: { input: 900, output: 900 },
          tools: ["edit"],
        })

        const usage = await SessionUsage.load({ sessionID: a.id })

        expect(usage.sessions).toBe(1)
        expect(usage.totalTokens).toBe(150)
        expect(usage.models["openai/gpt-5"]).toBeUndefined()
        expect(usage.tools).toEqual({ bash: 1 })
      },
    })
  })
})
