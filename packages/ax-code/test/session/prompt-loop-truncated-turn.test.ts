import { describe, expect, test } from "vitest"
import type { MessageV2 } from "../../src/session/message-v2"
import {
  handlePromptLoopTruncatedTurn,
  isLargeTruncatedCodePaste,
  isRepeatedTruncatedModelOutput,
  truncatedModelOutputPrefix,
  truncatedTurnRecoveryEngaged,
} from "../../src/session/prompt/prompt-loop-truncated-turn"
import { MessageID, SessionID } from "../../src/session/schema"

function assistant(id = MessageID.ascending()) {
  return { id } as MessageV2.Assistant
}

describe("truncatedTurnRecoveryEngaged", () => {
  test("engages for a clean truncated turn in either session mode", () => {
    // Recovery is mode-independent: a supervised finish=length turn gets the
    // same bounded recovery as an autonomous one.
    expect(truncatedTurnRecoveryEngaged({ truncatedModelTurn: true, messageError: false })).toBe(true)
  })

  test("never engages on an errored turn — provider errors own their retry path", () => {
    expect(truncatedTurnRecoveryEngaged({ truncatedModelTurn: true, messageError: true })).toBe(false)
  })

  test("does not engage for turns that ended for other reasons", () => {
    expect(truncatedTurnRecoveryEngaged({ truncatedModelTurn: false, messageError: false })).toBe(false)
    expect(truncatedTurnRecoveryEngaged({ truncatedModelTurn: false, messageError: true })).toBe(false)
  })
})

describe("prompt loop truncated model turn", () => {
  test("detects large truncated in-chat code pastes", () => {
    const fence =
      "Here is a complete Python script that wraps 7-Zip:\n\n```python\n" +
      "def compress(src, dest):\n    subprocess.run(['7z', 'a', dest, src], check=True)\n\n".repeat(50) +
      "```\n"
    expect(fence.length).toBeGreaterThan(1500)
    expect(isLargeTruncatedCodePaste(fence)).toBe(true)
    expect(isLargeTruncatedCodePaste("short answer")).toBe(false)
    expect(isLargeTruncatedCodePaste("```\nok\n```")).toBe(false)

    const unfenced = [
      "import os",
      "import sys",
      "from pathlib import Path",
      "def main():",
      "class App:",
      "const x = 1",
      "export function run() {}",
      "function helper() {}",
      "package main",
      "#include <stdio.h>",
      ...Array.from({ length: 120 }, () => "    value = value + 1  # pad the dump so length exceeds the threshold"),
    ].join("\n")
    expect(unfenced.length).toBeGreaterThan(1500)
    expect(isLargeTruncatedCodePaste(unfenced)).toBe(true)
  })

  test("detects only repeated substantial normalized output prefixes", () => {
    const repeated = "The Journal of Modern African Studies has additional publication details. ".repeat(8)

    expect(
      isRepeatedTruncatedModelOutput({
        previousOutputPrefix: truncatedModelOutputPrefix(repeated),
        currentOutputPrefix: truncatedModelOutputPrefix(repeated.replaceAll(" ", "\n\t")),
      }),
    ).toBe(true)
    expect(
      isRepeatedTruncatedModelOutput({
        previousOutputPrefix: truncatedModelOutputPrefix(repeated),
        currentOutputPrefix: truncatedModelOutputPrefix(`Different response from the provider. ${repeated}`),
      }),
    ).toBe(false)
    expect(
      isRepeatedTruncatedModelOutput({
        previousOutputPrefix: truncatedModelOutputPrefix("short repeated output"),
        currentOutputPrefix: truncatedModelOutputPrefix("short repeated output"),
      }),
    ).toBe(false)
  })

  test("resets retry state when the model turn is not truncated", async () => {
    const warnings: unknown[] = []
    const failures: unknown[] = []

    const result = await handlePromptLoopTruncatedTurn(
      {
        sessionID: SessionID.descending(),
        assistant: assistant(),
        truncatedModelTurn: false,
        truncatedModelTurnRetries: 1,
        maxTruncatedModelTurnRetries: 1,
        pendingCount: 2,
      },
      {
        warn(message, fields) {
          warnings.push({ message, fields })
        },
        async publishFailure(input) {
          failures.push(input)
        },
      },
    )

    expect(result).toEqual({
      action: "ignore",
      truncatedModelTurnRetries: 0,
    })
    expect(warnings).toEqual([])
    expect(failures).toEqual([])
  })

  test("returns retry text and logs recovery for the first truncated model turn", async () => {
    const warnings: { message: string; fields: Record<string, unknown> }[] = []
    const sessionID = SessionID.descending()

    const result = await handlePromptLoopTruncatedTurn(
      {
        sessionID,
        assistant: assistant(),
        truncatedModelTurn: true,
        truncatedModelTurnRetries: 0,
        maxTruncatedModelTurnRetries: 1,
        pendingCount: 3,
      },
      {
        warn(message, fields) {
          warnings.push({ message, fields })
        },
      },
    )

    expect(result.action).toBe("recover")
    if (result.action !== "recover") throw new Error("expected recovery")
    expect(result.truncatedModelTurnRetries).toBe(1)
    expect(result.text).toContain("truncated-turn recovery 1/1")
    expect(warnings).toEqual([
      {
        message: "autonomous truncated model turn recovery",
        fields: {
          command: "session.prompt.loop",
          status: "retry",
          errorCode: "TRUNCATED_MODEL_TURN",
          sessionID,
          attempt: 1,
          maxAttempts: 1,
          pendingCount: 3,
        },
      },
    ])
  })

  test("publishes failure and stops when truncated model turn retries are exhausted", async () => {
    const warnings: { message: string; fields: Record<string, unknown> }[] = []
    const failures: { sessionID: SessionID; assistant: MessageV2.Assistant; message: string }[] = []
    const sessionID = SessionID.descending()
    const message = assistant()

    const result = await handlePromptLoopTruncatedTurn(
      {
        sessionID,
        assistant: message,
        truncatedModelTurn: true,
        truncatedModelTurnRetries: 1,
        maxTruncatedModelTurnRetries: 1,
        pendingCount: 2,
      },
      {
        warn(message, fields) {
          warnings.push({ message, fields })
        },
        async publishFailure(input) {
          failures.push(input)
        },
      },
    )

    expect(result).toEqual({
      action: "stop",
      reason: "stalled",
      truncatedModelTurnRetries: 1,
    })
    expect(warnings).toEqual([
      {
        message: "autonomous stopped after repeated truncated model turn",
        fields: {
          command: "session.prompt.loop",
          status: "stopped",
          errorCode: "TRUNCATED_MODEL_TURN",
          sessionID,
          attempts: 1,
          maxAttempts: 1,
          pendingCount: 2,
        },
      },
    ])
    expect(failures).toHaveLength(1)
    expect(failures[0]?.sessionID).toBe(sessionID)
    expect(failures[0]?.assistant).toBe(message)
    expect(failures[0]?.message).toContain("truncated model turn")
  })

  test("publishes a provider-state diagnostic and stops a repeated truncation retry early", async () => {
    const warnings: { message: string; fields: Record<string, unknown> }[] = []
    const failures: { sessionID: SessionID; assistant: MessageV2.Assistant; message: string }[] = []
    const sessionID = SessionID.descending()
    const message = assistant()
    const repeated = "The Journal of Modern African Studies has additional publication details. ".repeat(8)

    const result = await handlePromptLoopTruncatedTurn(
      {
        sessionID,
        assistant: message,
        truncatedModelTurn: true,
        truncatedModelTurnRetries: 1,
        maxTruncatedModelTurnRetries: 3,
        pendingCount: 0,
        previousOutputPrefix: truncatedModelOutputPrefix(repeated),
        currentOutputPrefix: truncatedModelOutputPrefix(repeated),
      },
      {
        warn(message, fields) {
          warnings.push({ message, fields })
        },
        async publishFailure(input) {
          failures.push(input)
        },
      },
    )

    expect(result).toEqual({
      action: "stop",
      reason: "stalled",
      truncatedModelTurnRetries: 1,
    })
    expect(warnings).toEqual([
      {
        message: "autonomous stopped after repeated truncated model output",
        fields: {
          command: "session.prompt.loop",
          status: "stopped",
          errorCode: "REPEATED_TRUNCATED_MODEL_TURN",
          sessionID,
          attempts: 1,
          maxAttempts: 3,
          pendingCount: 0,
        },
      },
    ])
    expect(failures).toHaveLength(1)
    expect(failures[0]?.assistant).toBe(message)
    expect(failures[0]?.message).toContain("stale provider or local model runtime state")
  })
})

describe("prompt loop truncated model turn in supervised mode", () => {
  test("recovers with neutral continuation wording instead of autonomous phrasing", async () => {
    const warnings: { message: string; fields: Record<string, unknown> }[] = []
    const sessionID = SessionID.descending()

    const result = await handlePromptLoopTruncatedTurn(
      {
        sessionID,
        assistant: assistant(),
        truncatedModelTurn: true,
        truncatedModelTurnRetries: 0,
        maxTruncatedModelTurnRetries: 2,
        pendingCount: 0,
        mode: "supervised",
      },
      {
        warn(message, fields) {
          warnings.push({ message, fields })
        },
      },
    )

    expect(result.action).toBe("recover")
    if (result.action !== "recover") throw new Error("expected recovery")
    expect(result.truncatedModelTurnRetries).toBe(1)
    expect(result.text).toContain("finish=length")
    expect(result.text).toContain("exact point where the text stopped")
    expect(result.text).toContain("Do not repeat")
    expect(result.text).toContain("continuation attempt 1/2")
    expect(result.text).not.toMatch(/autonomous/i)
    expect(warnings).toEqual([
      {
        message: "supervised truncated model turn recovery",
        fields: {
          command: "session.prompt.loop",
          status: "retry",
          errorCode: "TRUNCATED_MODEL_TURN",
          sessionID,
          attempt: 1,
          maxAttempts: 2,
          pendingCount: 0,
        },
      },
    ])
  })

  test("stops with a mode-neutral failure when the retry budget is exhausted", async () => {
    const warnings: { message: string; fields: Record<string, unknown> }[] = []
    const failures: { sessionID: SessionID; assistant: MessageV2.Assistant; message: string }[] = []
    const sessionID = SessionID.descending()

    const result = await handlePromptLoopTruncatedTurn(
      {
        sessionID,
        assistant: assistant(),
        truncatedModelTurn: true,
        truncatedModelTurnRetries: 2,
        maxTruncatedModelTurnRetries: 2,
        pendingCount: 1,
        mode: "supervised",
      },
      {
        warn(message, fields) {
          warnings.push({ message, fields })
        },
        async publishFailure(input) {
          failures.push(input)
        },
      },
    )

    expect(result).toEqual({
      action: "stop",
      reason: "stalled",
      truncatedModelTurnRetries: 2,
    })
    expect(warnings).toEqual([
      {
        message: "supervised stopped after repeated truncated model turn",
        fields: {
          command: "session.prompt.loop",
          status: "stopped",
          errorCode: "TRUNCATED_MODEL_TURN",
          sessionID,
          attempts: 2,
          maxAttempts: 2,
          pendingCount: 1,
        },
      },
    ])
    expect(failures).toHaveLength(1)
    expect(failures[0]?.message).toContain("finish=length")
    expect(failures[0]?.message).toContain("continuation retry budget is exhausted")
    expect(failures[0]?.message).toContain("should not be treated as complete")
    expect(failures[0]?.message).not.toContain("Autonomous mode")
  })

  test("stops early with a mode-neutral diagnostic when the output prefix repeats", async () => {
    const warnings: { message: string; fields: Record<string, unknown> }[] = []
    const failures: { sessionID: SessionID; assistant: MessageV2.Assistant; message: string }[] = []
    const sessionID = SessionID.descending()
    const repeated = "The Journal of Modern African Studies has additional publication details. ".repeat(8)

    const result = await handlePromptLoopTruncatedTurn(
      {
        sessionID,
        assistant: assistant(),
        truncatedModelTurn: true,
        truncatedModelTurnRetries: 1,
        maxTruncatedModelTurnRetries: 3,
        pendingCount: 0,
        previousOutputPrefix: truncatedModelOutputPrefix(repeated),
        currentOutputPrefix: truncatedModelOutputPrefix(repeated),
        mode: "supervised",
      },
      {
        warn(message, fields) {
          warnings.push({ message, fields })
        },
        async publishFailure(input) {
          failures.push(input)
        },
      },
    )

    expect(result).toEqual({
      action: "stop",
      reason: "stalled",
      truncatedModelTurnRetries: 1,
    })
    expect(warnings).toEqual([
      {
        message: "supervised stopped after repeated truncated model output",
        fields: {
          command: "session.prompt.loop",
          status: "stopped",
          errorCode: "REPEATED_TRUNCATED_MODEL_TURN",
          sessionID,
          attempts: 1,
          maxAttempts: 3,
          pendingCount: 0,
        },
      },
    ])
    expect(failures).toHaveLength(1)
    expect(failures[0]?.message).toContain("repeated the same substantial output")
    expect(failures[0]?.message).toContain("restart the local model runtime")
    expect(failures[0]?.message).not.toContain("Autonomous mode")
  })

  test("the default mode keeps the autonomous recovery wording byte-identical", async () => {
    const warnings: string[] = []

    const result = await handlePromptLoopTruncatedTurn(
      {
        sessionID: SessionID.descending(),
        assistant: assistant(),
        truncatedModelTurn: true,
        truncatedModelTurnRetries: 0,
        maxTruncatedModelTurnRetries: 2,
        pendingCount: 0,
      },
      {
        warn(message) {
          warnings.push(message)
        },
      },
    )

    expect(result.action).toBe("recover")
    if (result.action !== "recover") throw new Error("expected recovery")
    expect(result.text).toContain("truncated-turn recovery 1/2")
    expect(result.text).toContain("autonomous model turn")
    expect(warnings).toEqual(["autonomous truncated model turn recovery"])
  })
})
