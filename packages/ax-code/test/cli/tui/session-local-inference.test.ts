import { describe, expect, test } from "vitest"
import { sidebarLocalInferenceView } from "../../../src/cli/cmd/tui/routes/session/sidebar-local-inference-view-model"

describe("sidebarLocalInferenceView", () => {
  test("returns undefined for non ax-engine messages", () => {
    expect(
      sidebarLocalInferenceView({
        messages: [
          {
            id: "msg_1",
            role: "assistant",
            providerID: "google",
            modelID: "gemini",
            time: { created: 1_000, completed: 3_000 },
            tokens: { input: 1_000, output: 200 },
          },
        ],
        partsByMessage: {
          msg_1: [{ type: "text", time: { start: 2_000, end: 3_000 } }],
        },
      }),
    ).toBeUndefined()
  })

  test("returns undefined before first output timing is available", () => {
    expect(
      sidebarLocalInferenceView({
        messages: [
          {
            id: "msg_1",
            role: "assistant",
            providerID: "ax-engine",
            modelID: "qwen3.6-27b-6bit",
            time: { created: 1_000 },
            tokens: { input: 1_000, output: 0 },
          },
        ],
        partsByMessage: {},
        now: 2_000,
      }),
    ).toBeUndefined()
  })

  test("formats ax-engine prefill and decode rates from the latest assistant turn", () => {
    expect(
      sidebarLocalInferenceView({
        messages: [
          {
            id: "msg_1",
            role: "assistant",
            providerID: "ax-engine",
            modelID: "gemma-4-12b",
            time: { created: 1_000, completed: 5_000 },
            tokens: { input: 2_000, output: 300 },
          },
        ],
        partsByMessage: {
          msg_1: [{ type: "text", time: { start: 2_000, end: 5_000 } }],
        },
      }),
    ).toEqual({
      modelID: "gemma-4-12b",
      prefillRate: "2.0k t/s",
      decodeRate: "100 t/s",
    })
  })

  test("uses the latest ax-engine assistant turn", () => {
    expect(
      sidebarLocalInferenceView({
        messages: [
          {
            id: "msg_1",
            role: "assistant",
            providerID: "ax-engine",
            modelID: "gemma-4-12b",
            time: { created: 1_000, completed: 3_000 },
            tokens: { input: 1_000, output: 100 },
          },
          {
            id: "msg_2",
            role: "assistant",
            providerID: "ax-engine",
            modelID: "glm-4.7-flash",
            time: { created: 10_000, completed: 13_000 },
            tokens: { input: 600, output: 240 },
          },
        ],
        partsByMessage: {
          msg_1: [{ type: "text", time: { start: 2_000, end: 3_000 } }],
          msg_2: [{ type: "reasoning", time: { start: 11_000, end: 13_000 } }],
        },
      }),
    ).toMatchObject({
      modelID: "glm-4.7-flash",
      prefillRate: "600 t/s",
      decodeRate: "120 t/s",
    })
  })
})
