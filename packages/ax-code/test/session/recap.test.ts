import { describe, expect, test } from "vitest"

import { AX_ENGINE_PROVIDER_ID } from "../../src/provider/ax-engine"
import { ProviderID } from "../../src/provider/schema"
import type { MessageV2 } from "../../src/session/message-v2"
import {
  cleanGeneratedRecap,
  lastTurnMessages,
  recapContextText,
  shouldSkipAutomaticRecap,
} from "../../src/session/recap"
import { MessageID, SessionID } from "../../src/session/schema"

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

function assistantMessage(parts: unknown[], id?: string) {
  counter += 1
  return {
    info: {
      id: MessageID.make(id ?? `msg_recap_assistant_${counter}`),
      sessionID,
      role: "assistant",
      parentID: MessageID.make("msg_recap_parent"),
      time: { created: Date.now() },
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
