import { describe, expect, spyOn, test } from "bun:test"
import { SessionGoal } from "../../src/session/goal"
import type { MessageV2 } from "../../src/session/message-v2"
import { addPromptGoalUsage } from "../../src/session/prompt-goal-usage"
import { MessageID, SessionID } from "../../src/session/schema"

function assistantMessage(): MessageV2.Assistant {
  return {
    id: MessageID.ascending(),
    sessionID: SessionID.descending(),
    parentID: MessageID.ascending(),
    role: "assistant",
    time: { created: 1, completed: 2 },
    modelID: "test-model" as any,
    providerID: "test" as any,
    mode: "build",
    agent: "build",
    path: { cwd: "/tmp/project", root: "/tmp/project" },
    tokens: {
      total: 10,
      input: 0,
      output: 10,
      reasoning: 0,
      cache: { read: 0, write: 0 },
    },
  }
}

describe("addPromptGoalUsage", () => {
  test("returns the updated goal when usage update succeeds", async () => {
    const sessionID = SessionID.descending()
    const goal: SessionGoal.Info = {
      sessionID,
      objective: "finish",
      status: "active",
      tokensUsed: 10,
      timeUsedSeconds: 1,
      time: { created: 1, updated: 2 },
    }
    const addUsage = spyOn(SessionGoal, "addUsage").mockResolvedValue(goal)
    try {
      await expect(addPromptGoalUsage({ sessionID, message: assistantMessage() })).resolves.toBe(goal)
    } finally {
      addUsage.mockRestore()
    }
  })

  test("swallows goal usage update failures", async () => {
    const sessionID = SessionID.descending()
    const addUsage = spyOn(SessionGoal, "addUsage").mockRejectedValue(new Error("db busy"))
    try {
      await expect(addPromptGoalUsage({ sessionID, message: assistantMessage() })).resolves.toBeUndefined()
    } finally {
      addUsage.mockRestore()
    }
  })
})
