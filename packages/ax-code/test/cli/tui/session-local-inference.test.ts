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
            modelID: "qwen3.8-27b-axq-6bit",
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
            modelID: "qwen3-coder-next-axq-6bit",
            time: { created: 1_000, completed: 5_000 },
            tokens: { input: 2_000, output: 300 },
          },
        ],
        partsByMessage: {
          msg_1: [{ type: "text", time: { start: 2_000, end: 5_000 } }],
        },
      }),
    ).toEqual({
      modelID: "qwen3-coder-next-axq-6bit",
      prefillRate: "2.0k t/s",
      decodeRate: "100 t/s",
    })
  })

  test("computes per-step rates on multi-step turns, excluding tool execution time", () => {
    // Two steps: 10k prefill + 100 output tokens, a 30s tool run, then 15k
    // prefill + 100 output tokens. Message-level totals (25k in / 200 out)
    // divided by the whole 34s turn would report a nonsense ~6 t/s decode and
    // a 25k t/s prefill; the real rates are 100 t/s decode and ~17k t/s
    // prefill once tool time is excluded.
    expect(
      sidebarLocalInferenceView({
        messages: [
          {
            id: "msg_1",
            role: "assistant",
            providerID: "ax-engine",
            modelID: "qwen3-coder-next-axq-6bit",
            time: { created: 0, completed: 34_000 },
            tokens: { input: 25_000, output: 200 },
          },
        ],
        partsByMessage: {
          msg_1: [
            { type: "step-start" },
            { type: "text", time: { start: 1_000, end: 2_000 } },
            { type: "tool", state: { status: "completed", time: { start: 2_000, end: 32_000 } } },
            { type: "step-finish", tokens: { input: 10_000, output: 100 } },
            { type: "step-start" },
            { type: "text", time: { start: 32_500, end: 33_500 } },
            { type: "step-finish", tokens: { input: 15_000, output: 100 } },
          ],
        },
      }),
    ).toEqual({
      modelID: "qwen3-coder-next-axq-6bit",
      prefillRate: "17k t/s",
      decodeRate: "100 t/s",
    })
  })

  test("ignores the in-flight step so the decode rate stays stable while tools run", () => {
    expect(
      sidebarLocalInferenceView({
        messages: [
          {
            id: "msg_1",
            role: "assistant",
            providerID: "ax-engine",
            modelID: "qwen3.8-27b-axq-6bit",
            time: { created: 0 },
            tokens: { input: 10_000, output: 100 },
          },
        ],
        partsByMessage: {
          msg_1: [
            { type: "step-start" },
            { type: "text", time: { start: 1_000, end: 2_000 } },
            { type: "tool", state: { status: "completed", time: { start: 2_000, end: 5_000 } } },
            { type: "step-finish", tokens: { input: 10_000, output: 100 } },
            { type: "step-start" },
          ],
        },
        now: 60_000,
      }),
    ).toEqual({
      modelID: "qwen3.8-27b-axq-6bit",
      prefillRate: "10k t/s",
      decodeRate: "100 t/s",
    })
  })

  test("extends the decode window to tool start so tool-call tokens count as decode", () => {
    expect(
      sidebarLocalInferenceView({
        messages: [
          {
            id: "msg_1",
            role: "assistant",
            providerID: "ax-engine",
            modelID: "qwen3.8-27b-axq-6bit",
            time: { created: 0, completed: 3_000 },
            tokens: { input: 1_000, output: 50 },
          },
        ],
        partsByMessage: {
          msg_1: [
            { type: "step-start" },
            { type: "text", time: { start: 1_000, end: 1_500 } },
            { type: "tool", state: { status: "completed", time: { start: 2_000, end: 2_500 } } },
            { type: "step-finish", tokens: { input: 1_000, output: 50 } },
          ],
        },
      }),
    ).toEqual({
      modelID: "qwen3.8-27b-axq-6bit",
      prefillRate: "1.0k t/s",
      decodeRate: "50.0 t/s",
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
            modelID: "qwen3.8-27b-axq-6bit",
            time: { created: 1_000, completed: 3_000 },
            tokens: { input: 1_000, output: 100 },
          },
          {
            id: "msg_2",
            role: "assistant",
            providerID: "ax-engine",
            modelID: "qwen3-coder-next-axq-6bit",
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
      modelID: "qwen3-coder-next-axq-6bit",
      prefillRate: "600 t/s",
      decodeRate: "120 t/s",
    })
  })
})
