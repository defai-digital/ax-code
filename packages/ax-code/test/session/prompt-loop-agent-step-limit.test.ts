import { describe, expect, test } from "bun:test"
import { handlePromptLoopAgentStepLimit } from "../../src/session/prompt-loop-agent-step-limit"

describe("prompt loop agent step limit", () => {
  test("ignores non-autonomous, unbounded, and under-limit turns", () => {
    expect(
      handlePromptLoopAgentStepLimit({
        agentName: "build",
        step: 4,
        maxSteps: 5,
        autonomous: true,
        continuations: 0,
        maxContinuations: 3,
      }),
    ).toEqual({ action: "ignore" })

    expect(
      handlePromptLoopAgentStepLimit({
        agentName: "build",
        step: 5,
        maxSteps: 5,
        autonomous: false,
        continuations: 0,
        maxContinuations: 3,
      }),
    ).toEqual({ action: "ignore" })

    expect(
      handlePromptLoopAgentStepLimit({
        agentName: "build",
        step: 5,
        maxSteps: Infinity,
        autonomous: true,
        continuations: 0,
        maxContinuations: 3,
      }),
    ).toEqual({ action: "ignore" })
  })

  test("returns continuation text and log extras at a finite agent step limit", () => {
    const result = handlePromptLoopAgentStepLimit({
      agentName: "review",
      step: 5,
      maxSteps: 5,
      autonomous: true,
      continuations: 1,
      maxContinuations: 3,
    })

    expect(result.action).toBe("continue")
    if (result.action !== "continue") throw new Error("expected continuation")
    expect(result.text).toContain("review agent step limit")
    expect(result.text).toContain("auto-continuation 2/3")
    expect(result.logExtras).toEqual({ agent: "review", maxSteps: 5 })
  })

  test("ignores agent step limit after continuation budget is exhausted", () => {
    expect(
      handlePromptLoopAgentStepLimit({
        agentName: "review",
        step: 5,
        maxSteps: 5,
        autonomous: true,
        continuations: 3,
        maxContinuations: 3,
      }),
    ).toEqual({ action: "ignore" })
  })
})
