import { describe, expect, test } from "vitest"
import type { MessageV2 } from "../../src/session/message-v2"
import { isMissingAnswer, projectCurrentLoopControls } from "../../src/session/prompt/prompt-missing-answer"

const parts = (value: unknown) => value as MessageV2.Part[]

describe("missing answer", () => {
  test("reasoning, whitespace and runtime notices do not constitute an answer", () => {
    expect(isMissingAnswer(parts([{ type: "reasoning", text: "<tool_call>fake</tool_call>" }]))).toBe(true)
    expect(
      isMissingAnswer(
        parts([
          { type: "text", text: " \n" },
          { type: "text", text: "fallback notice", synthetic: true },
        ]),
      ),
    ).toBe(true)
    expect(isMissingAnswer(parts([{ type: "text", text: "ignored", ignored: true }]))).toBe(true)
    expect(isMissingAnswer([])).toBe(true)
  })
  test("never retries tool turns, visible answers or file output", () => {
    for (const status of ["completed", "error", "running", "pending"]) {
      expect(isMissingAnswer(parts([{ type: "tool", state: { status } }]))).toBe(false)
    }
    expect(isMissingAnswer(parts([{ type: "text", text: "Done." }]))).toBe(false)
    expect(isMissingAnswer(parts([{ type: "file" }]))).toBe(false)
  })
})

describe("checkpoint request projection", () => {
  const checkpoint = "Agent-loop checkpoint: Tools are disabled for your next turn."
  function message(id: string, text: string, synthetic = false): MessageV2.WithParts {
    return { info: { id, role: "user" }, parts: [{ type: "text", text, synthetic }] } as MessageV2.WithParts
  }
  test("expires legacy synthetic checkpoints after a new user turn without mutating history", () => {
    const old = message("old", checkpoint, true)
    const current = message("current", "continue")
    expect(projectCurrentLoopControls([old, current])).toEqual([current])
    expect(old.parts).toHaveLength(1)
    expect(old.parts[0]).toMatchObject({ text: checkpoint })
  })
  test("preserves the active checkpoint, real user text and unrelated synthetic instructions", () => {
    const real = message("real", checkpoint)
    const unrelated = message("other", "Permission was denied.", true)
    const active = message("active", checkpoint, true)
    expect(projectCurrentLoopControls([real, unrelated, active])).toEqual([real, unrelated, active])
  })
  test("retains other parts of mixed historical messages", () => {
    const mixed = message("mixed", checkpoint, true)
    mixed.parts.push(...parts([{ type: "text", text: "Keep this instruction." }]))
    const current = message("current", "continue")
    const projected = projectCurrentLoopControls([mixed, current])
    expect(projected[0].parts).toEqual([{ type: "text", text: "Keep this instruction." }])
    expect(mixed.parts).toHaveLength(2)
  })
})
