import { describe, expect, test } from "vitest"
import { Instance } from "../../src/project/instance"
import { Session } from "../../src/session"
import { SessionUsage } from "../../src/session/usage"
import { MessageV2 } from "../../src/session/message-v2"
import { MessageID, type SessionID } from "../../src/session/schema"
import { tmpdir } from "../fixture/fixture"

function assistantMessage(
  sessionID: SessionID,
  model: { providerID: string; modelID: string },
  tokens: { input: number; output: number },
) {
  return {
    id: MessageID.ascending(),
    sessionID,
    role: "assistant",
    parentID: MessageID.ascending(),
    time: { created: Date.now() },
    agent: "build",
    providerID: model.providerID,
    modelID: model.modelID,
    mode: "",
    path: { cwd: "/tmp", root: "/tmp" },
    tokens: { ...tokens, reasoning: 0, cache: { read: 0, write: 0 } },
  } as unknown as MessageV2.Info
}

describe("session.usage cost estimation (ADR-084)", () => {
  test("prices priced models, excludes unpriced ones, and reports coverage", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({})
        await Session.updateMessage(
          assistantMessage(
            session.id,
            { providerID: "anthropic", modelID: "claude-sonnet-4-5" },
            { input: 1_000_000, output: 0 },
          ),
        )
        await Session.updateMessage(
          assistantMessage(
            session.id,
            { providerID: "anthropic", modelID: "claude-sonnet-4-5" },
            { input: 0, output: 1_000_000 },
          ),
        )
        await Session.updateMessage(
          assistantMessage(
            session.id,
            { providerID: "test", modelID: "mystery-model" },
            { input: 5_000_000, output: 5_000_000 },
          ),
        )

        const usage = await SessionUsage.load({ sessionID: session.id })
        // Priced: 1M input ($3) + 1M output ($15). The unpriced mystery model
        // contributes nothing to dollars and drags coverage to 2/3.
        expect(usage.cost.totalUsd).toBeCloseTo(3 + 15, 6)
        expect(usage.cost.coverage).toBeCloseTo(2 / 3, 6)
        expect(usage.models["anthropic/claude-sonnet-4-5"]?.costUsd).toBeCloseTo(18, 6)
        expect(usage.models["test/mystery-model"]?.costUsd).toBeUndefined()
      },
    })
  })

  test("no token data yields zero cost with undefined coverage", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({})
        const usage = await SessionUsage.load({ sessionID: session.id })
        expect(usage.cost).toEqual({ totalUsd: 0, coverage: undefined })
      },
    })
  })
})
