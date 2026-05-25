import { describe, expect, test } from "bun:test"
import { beginPromptLoopRecording, finishPromptLoopRecording } from "../../src/session/prompt-loop-recording"
import { SessionID } from "../../src/session/schema"

describe("prompt loop recording", () => {
  test("begins recording through the injected recorder dependency", () => {
    const sessionID = SessionID.descending()
    const begun: string[] = []

    beginPromptLoopRecording(sessionID, {
      begin(id) {
        begun.push(id)
      },
    })

    expect(begun).toEqual([sessionID])
  })

  test("emits session end, closes recorder, and clears blast radius for completed primary loops", async () => {
    const sessionID = SessionID.descending()
    const calls: string[] = []
    const events: unknown[] = []

    await finishPromptLoopRecording(
      {
        sessionID,
        sessionStarted: true,
        isResumingActiveLoop: false,
        reason: "completed",
        totalSteps: 3,
      },
      {
        emit(event) {
          events.push(event)
          calls.push("emit")
        },
        async end(id) {
          expect(id).toBe(sessionID)
          calls.push("end")
        },
        resetBlastRadius(id) {
          expect(id).toBe(sessionID)
          calls.push("reset")
        },
      },
    )

    expect(events).toEqual([{ type: "session.end", sessionID, reason: "completed", totalSteps: 3 }])
    expect(calls).toEqual(["emit", "end", "reset"])
  })

  test("does not emit session end for resumed active loops", async () => {
    const sessionID = SessionID.descending()
    const events: unknown[] = []

    await finishPromptLoopRecording(
      {
        sessionID,
        sessionStarted: true,
        isResumingActiveLoop: true,
        reason: "completed",
        totalSteps: 3,
      },
      {
        emit(event) {
          events.push(event)
        },
        async end() {},
        resetBlastRadius() {},
      },
    )

    expect(events).toEqual([])
  })
})
