import { describe, expect, test } from "vitest"
import type { Message, Part } from "@ax-code/sdk/v2"

import { buildAssistantRetryPayload } from "./retryPayload"

const makeMessage = (id: string, role: string, extra: Record<string, unknown> = {}): Message =>
  ({ id, role, sessionID: "session-1", ...extra }) as unknown as Message

const textPart = (text: string, extra: Record<string, unknown> = {}): Part =>
  ({ id: `part-${text}`, type: "text", text, ...extra }) as unknown as Part

describe("buildAssistantRetryPayload", () => {
  test("builds a payload from the user message preceding the failed turn", () => {
    const payload = buildAssistantRetryPayload({
      messages: [
        makeMessage("u1", "user", { providerID: "openai", modelID: "gpt-5", agent: "build" }),
        makeMessage("a1", "assistant"),
      ],
      partsByMessage: { u1: [textPart("fix the bug")] },
      failedAssistantMessage: makeMessage("a1", "assistant"),
    })

    expect(payload).toEqual({ text: "fix the bug", providerID: "openai", modelID: "gpt-5", agent: "build" })
  })

  test("skips synthetic text parts so system reminders are not resent", () => {
    const payload = buildAssistantRetryPayload({
      messages: [makeMessage("u1", "user", { providerID: "p", modelID: "m" }), makeMessage("a1", "assistant")],
      partsByMessage: {
        u1: [textPart("real prompt"), textPart("hidden instruction", { synthetic: true })],
      },
      failedAssistantMessage: makeMessage("a1", "assistant"),
    })

    expect(payload?.text).toBe("real prompt")
  })

  test("finds the nearest user message when several turns exist", () => {
    const payload = buildAssistantRetryPayload({
      messages: [
        makeMessage("u1", "user", { providerID: "p1", modelID: "m1" }),
        makeMessage("a1", "assistant"),
        makeMessage("u2", "user", { providerID: "p2", modelID: "m2" }),
        makeMessage("a2", "assistant"),
      ],
      partsByMessage: { u1: [textPart("first")], u2: [textPart("second")] },
      failedAssistantMessage: makeMessage("a2", "assistant"),
    })

    expect(payload?.text).toBe("second")
    expect(payload?.providerID).toBe("p2")
  })

  test("falls back to the assistant message for model coordinates", () => {
    const payload = buildAssistantRetryPayload({
      messages: [makeMessage("u1", "user"), makeMessage("a1", "assistant", { providerID: "p", modelID: "m" })],
      partsByMessage: { u1: [textPart("hello")] },
      failedAssistantMessage: makeMessage("a1", "assistant", { providerID: "p", modelID: "m" }),
    })

    expect(payload).toEqual({ text: "hello", providerID: "p", modelID: "m" })
  })

  test("returns null when no user message precedes the failure", () => {
    expect(
      buildAssistantRetryPayload({
        messages: [makeMessage("a1", "assistant")],
        partsByMessage: {},
        failedAssistantMessage: makeMessage("a1", "assistant"),
      }),
    ).toBeNull()
  })

  test("returns null when the user message has no text", () => {
    expect(
      buildAssistantRetryPayload({
        messages: [makeMessage("u1", "user", { providerID: "p", modelID: "m" }), makeMessage("a1", "assistant")],
        partsByMessage: { u1: [] },
        failedAssistantMessage: makeMessage("a1", "assistant"),
      }),
    ).toBeNull()
  })

  test("returns null when model coordinates are missing everywhere", () => {
    expect(
      buildAssistantRetryPayload({
        messages: [makeMessage("u1", "user"), makeMessage("a1", "assistant")],
        partsByMessage: { u1: [textPart("hello")] },
        failedAssistantMessage: makeMessage("a1", "assistant"),
      }),
    ).toBeNull()
  })

  test("carries the user message variant so retry keeps the effort level", () => {
    const payload = buildAssistantRetryPayload({
      messages: [
        makeMessage("u1", "user", { providerID: "openai", modelID: "gpt-5", variant: "high" }),
        makeMessage("a1", "assistant"),
      ],
      partsByMessage: { u1: [textPart("fix the bug")] },
      failedAssistantMessage: makeMessage("a1", "assistant"),
    })

    expect(payload?.variant).toBe("high")
  })

  test("reads a nested model.variant from pre-1.4.0 histories", () => {
    const payload = buildAssistantRetryPayload({
      messages: [
        makeMessage("u1", "user", {
          providerID: "openai",
          modelID: "gpt-5",
          model: { providerID: "openai", modelID: "gpt-5", variant: "low" },
        }),
        makeMessage("a1", "assistant"),
      ],
      partsByMessage: { u1: [textPart("fix the bug")] },
      failedAssistantMessage: makeMessage("a1", "assistant"),
    })

    expect(payload?.variant).toBe("low")
  })

  test("falls back to the failed assistant message variant", () => {
    const payload = buildAssistantRetryPayload({
      messages: [
        makeMessage("u1", "user", { providerID: "p", modelID: "m" }),
        makeMessage("a1", "assistant", { providerID: "p", modelID: "m", variant: "medium" }),
      ],
      partsByMessage: { u1: [textPart("hello")] },
      failedAssistantMessage: makeMessage("a1", "assistant", { providerID: "p", modelID: "m", variant: "medium" }),
    })

    expect(payload?.variant).toBe("medium")
  })

  test("omits variant when neither message carried one", () => {
    const payload = buildAssistantRetryPayload({
      messages: [
        makeMessage("u1", "user", { providerID: "p", modelID: "m" }),
        makeMessage("a1", "assistant"),
      ],
      partsByMessage: { u1: [textPart("hello")] },
      failedAssistantMessage: makeMessage("a1", "assistant"),
    })

    expect(payload).toEqual({ text: "hello", providerID: "p", modelID: "m" })
  })
})
