import { afterEach, describe, expect, test } from "vitest"
import { Instance } from "../../src/project/instance"
import { createPromptRunState } from "../../src/session/prompt/prompt-run-state"
import { SessionID } from "../../src/session/schema"
import { tmpdir } from "../fixture/fixture"

afterEach(async () => {
  await Instance.disposeAll()
})

describe("prompt run state", () => {
  test("instance disposal rejects queued callbacks instead of leaving them pending", async () => {
    await using tmp = await tmpdir({ git: true })

    let mark!: () => void
    const settled = new Promise<void>((resolve) => (mark = resolve))
    let rejected: unknown
    let resolved = false

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const runState = createPromptRunState()
        const sessionID = SessionID.make("ses_dispose_callbacks")
        runState.start(sessionID)
        const enqueued = runState.enqueue(sessionID, {
          resolve: () => {
            resolved = true
            mark()
          },
          reject: (error) => {
            rejected = error
            mark()
          },
        })
        expect(enqueued).toBe(true)
        expect(runState.queuedCallbacks(sessionID)).toHaveLength(1)
      },
    })

    await Instance.disposeAll()
    await settled

    expect(resolved).toBe(false)
    expect(rejected).toBeInstanceOf(Error)
    expect((rejected as Error).message).toBe("Session ended")
  })
})
