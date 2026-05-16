import { describe, expect, test } from "bun:test"
import {
  DOUBLE_ESCAPE_CLEAR_MS,
  promptEscapeClearIntent,
} from "../../../src/cli/cmd/tui/component/prompt/view-model"

describe("prompt view model", () => {
  test("arms clear on the first escape when the prompt has draft text", () => {
    expect(
      promptEscapeClearIntent({
        keyName: "escape",
        hasDraft: true,
        now: 1_000,
      }),
    ).toEqual({
      action: "arm",
      nextEscapeAt: 1_000,
    })
  })

  test("clears draft text on a second escape within the confirmation window", () => {
    expect(
      promptEscapeClearIntent({
        keyName: "escape",
        hasDraft: true,
        previousEscapeAt: 1_000,
        now: 1_000 + DOUBLE_ESCAPE_CLEAR_MS,
      }),
    ).toEqual({ action: "clear" })
  })

  test("re-arms when the second escape arrives after the confirmation window", () => {
    expect(
      promptEscapeClearIntent({
        keyName: "escape",
        hasDraft: true,
        previousEscapeAt: 1_000,
        now: 1_001 + DOUBLE_ESCAPE_CLEAR_MS,
      }),
    ).toEqual({
      action: "arm",
      nextEscapeAt: 1_001 + DOUBLE_ESCAPE_CLEAR_MS,
    })
  })

  test("lets escape follow the standard flow when the prompt is empty", () => {
    expect(
      promptEscapeClearIntent({
        keyName: "escape",
        hasDraft: false,
        previousEscapeAt: 1_000,
        now: 1_500,
      }),
    ).toEqual({ action: "passthrough" })
  })

  test("resets the armed state on non-escape keys", () => {
    expect(
      promptEscapeClearIntent({
        keyName: "a",
        hasDraft: true,
        previousEscapeAt: 1_000,
        now: 1_500,
      }),
    ).toEqual({ action: "passthrough" })
  })
})
