import { describe, test, expect } from "bun:test"
import { ContextTier } from "../../src/session/context-tier"
import { MessageV2 } from "../../src/session/message-v2"
import { MessageID, PartID, SessionID } from "../../src/session/schema"

function makeMessage(opts: {
  role: "user" | "assistant"
  parts?: MessageV2.Part[]
  summary?: boolean
}): MessageV2.WithParts {
  const id = MessageID.ascending()
  return {
    info: {
      id,
      role: opts.role,
      sessionID: SessionID.make("ses_test"),
      time: { created: Date.now() },
      summary: opts.summary ?? false,
    } as any,
    parts: opts.parts ?? [],
  } as MessageV2.WithParts
}

function makeToolPart(tool: string): MessageV2.ToolPart {
  return {
    id: PartID.ascending(),
    messageID: MessageID.ascending(),
    sessionID: SessionID.make("ses_test"),
    type: "tool",
    callID: `call_${Date.now()}`,
    tool,
    state: {
      status: "completed",
      title: "",
      input: {},
      output: "",
      metadata: {},
      time: { start: Date.now(), end: Date.now() },
    },
  }
}

describe("ContextTier", () => {
  describe("classify", () => {
    test("recent turns are Tier 1", () => {
      const messages = [
        makeMessage({ role: "user" }), // turn 1
        makeMessage({ role: "assistant" }),
        makeMessage({ role: "user" }), // turn 2 (recent)
        makeMessage({ role: "assistant" }),
        makeMessage({ role: "user" }), // turn 3 (recent)
        makeMessage({ role: "assistant" }),
      ]
      const classified = ContextTier.classify(messages, { recentTurns: 2, supportingTurns: 2 })
      // Last 2 user turns and their assistant responses should be Tier 1
      const last2 = classified.slice(-4)
      for (const c of last2) {
        expect(c.tier).toBe(1)
      }
    })

    test("supporting turns are Tier 2 by default", () => {
      const messages = [
        makeMessage({ role: "user" }), // turn 1
        makeMessage({ role: "assistant" }),
        makeMessage({ role: "user" }), // turn 2
        makeMessage({ role: "assistant" }),
        makeMessage({ role: "user" }), // turn 3 (supporting)
        makeMessage({ role: "assistant" }),
        makeMessage({ role: "user" }), // turn 4 (supporting)
        makeMessage({ role: "assistant" }),
        makeMessage({ role: "user" }), // turn 5 (recent)
        makeMessage({ role: "assistant" }),
      ]
      const classified = ContextTier.classify(messages, { recentTurns: 2, supportingTurns: 2 })
      // Supporting range should be Tier 2
      const supporting = classified.slice(2, 6)
      for (const c of supporting) {
        expect(c.tier).toBe(2)
      }
    })

    test("old content is Tier 3", () => {
      const messages = [
        makeMessage({ role: "user" }), // turn 1 (old)
        makeMessage({ role: "assistant" }),
        makeMessage({ role: "user" }), // turn 2
        makeMessage({ role: "assistant" }),
        makeMessage({ role: "user" }), // turn 3
        makeMessage({ role: "assistant" }),
        makeMessage({ role: "user" }), // turn 4 (recent)
        makeMessage({ role: "assistant" }),
        makeMessage({ role: "user" }), // turn 5 (recent)
        makeMessage({ role: "assistant" }),
      ]
      const classified = ContextTier.classify(messages, { recentTurns: 2, supportingTurns: 2 })
      // First message (beyond supporting range) should be Tier 3
      expect(classified[0].tier).toBe(3)
    })

    test("code intelligence results are Tier 2 even when old", () => {
      const messages = [
        makeMessage({
          role: "assistant",
          parts: [makeToolPart("code_intelligence")],
        }),
        makeMessage({ role: "user" }),
        makeMessage({ role: "user" }),
        makeMessage({ role: "assistant" }),
        makeMessage({ role: "user" }),
        makeMessage({ role: "assistant" }),
        makeMessage({ role: "user" }),
        makeMessage({ role: "assistant" }),
      ]
      const classified = ContextTier.classify(messages, { recentTurns: 2, supportingTurns: 2 })
      // Old code intelligence should be Tier 2, not Tier 3
      expect(classified[0].tier).toBe(2)
    })

    test("lsp results are Tier 2 even when old", () => {
      const messages = [
        makeMessage({
          role: "assistant",
          parts: [makeToolPart("lsp")],
        }),
        makeMessage({ role: "user" }),
        makeMessage({ role: "user" }),
        makeMessage({ role: "assistant" }),
        makeMessage({ role: "user" }),
        makeMessage({ role: "assistant" }),
        makeMessage({ role: "user" }),
        makeMessage({ role: "assistant" }),
      ]
      const classified = ContextTier.classify(messages, { recentTurns: 2, supportingTurns: 2 })
      expect(classified[0].tier).toBe(2)
    })

    test("file edit results are Tier 2 even when old", () => {
      const messages = [
        makeMessage({
          role: "assistant",
          parts: [makeToolPart("edit")],
        }),
        makeMessage({ role: "user" }),
        makeMessage({ role: "user" }),
        makeMessage({ role: "assistant" }),
        makeMessage({ role: "user" }),
        makeMessage({ role: "assistant" }),
        makeMessage({ role: "user" }),
        makeMessage({ role: "assistant" }),
      ]
      const classified = ContextTier.classify(messages, { recentTurns: 2, supportingTurns: 2 })
      expect(classified[0].tier).toBe(2)
    })

    test("compaction summaries are Tier 3", () => {
      const messages = [
        makeMessage({ role: "assistant", summary: true }),
        makeMessage({ role: "user" }),
        makeMessage({ role: "user" }),
        makeMessage({ role: "assistant" }),
        makeMessage({ role: "user" }),
        makeMessage({ role: "assistant" }),
        makeMessage({ role: "user" }),
        makeMessage({ role: "assistant" }),
      ]
      const classified = ContextTier.classify(messages, { recentTurns: 2, supportingTurns: 2 })
      expect(classified[0].tier).toBe(3)
    })
  })

  describe("distribution", () => {
    test("counts tier distribution correctly", () => {
      const classified = [
        { tier: 1, message: {} } as any,
        { tier: 1, message: {} } as any,
        { tier: 2, message: {} } as any,
        { tier: 3, message: {} } as any,
        { tier: 3, message: {} } as any,
      ]
      const dist = ContextTier.distribution(classified)
      expect(dist.tier1).toBe(2)
      expect(dist.tier2).toBe(1)
      expect(dist.tier3).toBe(2)
      expect(dist.total).toBe(5)
    })
  })
})
