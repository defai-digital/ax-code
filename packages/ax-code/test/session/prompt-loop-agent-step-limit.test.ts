import { describe, expect, test } from "vitest"
import { handlePromptLoopAgentStepLimit } from "../../src/session/prompt-loop-agent-step-limit"
import { SessionID } from "../../src/session/schema"

const noDeps = {
  warn: () => {},
  publishError: () => {},
}

describe("prompt loop agent step limit", () => {
  test("ignores non-autonomous, unbounded, and under-limit turns", () => {
    expect(
      handlePromptLoopAgentStepLimit(
        {
          sessionID: SessionID.descending(),
          agentName: "build",
          step: 4,
          maxSteps: 5,
          autonomous: true,
          continuations: 0,
          maxContinuations: 3,
        },
        noDeps,
      ),
    ).toEqual({ action: "ignore" })

    expect(
      handlePromptLoopAgentStepLimit(
        {
          sessionID: SessionID.descending(),
          agentName: "build",
          step: 5,
          maxSteps: 5,
          autonomous: false,
          continuations: 0,
          maxContinuations: 3,
        },
        noDeps,
      ),
    ).toEqual({ action: "ignore" })

    expect(
      handlePromptLoopAgentStepLimit(
        {
          sessionID: SessionID.descending(),
          agentName: "build",
          step: 5,
          maxSteps: Infinity,
          autonomous: true,
          continuations: 0,
          maxContinuations: 3,
        },
        noDeps,
      ),
    ).toEqual({ action: "ignore" })
  })

  test("returns continuation text and log extras at a finite agent step limit", () => {
    const result = handlePromptLoopAgentStepLimit(
      {
        sessionID: SessionID.descending(),
        agentName: "review",
        step: 5,
        maxSteps: 5,
        autonomous: true,
        continuations: 1,
        maxContinuations: 3,
      },
      noDeps,
    )

    expect(result.action).toBe("continue")
    if (result.action !== "continue") throw new Error("expected continuation")
    expect(result.text).toContain("review agent step limit")
    expect(result.text).toContain("auto-continuation 2/3")
    expect(result.logExtras).toEqual({ agent: "review", maxSteps: 5 })
  })

  test("stops with step_limit error when autonomous continuation budget is exhausted", () => {
    const warned: string[] = []
    const published: { message: string }[] = []
    const result = handlePromptLoopAgentStepLimit(
      {
        sessionID: SessionID.descending(),
        agentName: "review",
        step: 5,
        maxSteps: 5,
        autonomous: true,
        continuations: 3,
        maxContinuations: 3,
      },
      {
        warn: (message) => warned.push(message),
        publishError: (input) => published.push({ message: input.message }),
      },
    )
    expect(result.action).toBe("stop")
    if (result.action !== "stop") throw new Error("expected stop")
    expect(result.reason).toBe("step_limit")
    expect(result.errorCode).toBe("STEP_LIMIT")
    expect(result.message).toContain("5 steps")
    expect(result.message).toContain("3 continuations")
    // The stop must be surfaced, not silent: log + published error, like the
    // sibling global/total step-limit paths.
    expect(warned).toEqual(["agent step limit reached"])
    expect(published).toHaveLength(1)
    expect(published[0]?.message).toContain("per-agent step limit")
  })

  test("ignores agent step limit for non-autonomous sessions", () => {
    expect(
      handlePromptLoopAgentStepLimit(
        {
          sessionID: SessionID.descending(),
          agentName: "review",
          step: 5,
          maxSteps: 5,
          autonomous: false,
          continuations: 0,
          maxContinuations: 3,
        },
        noDeps,
      ),
    ).toEqual({ action: "ignore" })
  })
})
