import { afterEach, describe, expect, test, vi } from "vitest"
import { NamedError } from "@ax-code/util/error"
import { Instance } from "../../src/project/instance"
import { ModelID, ProviderID } from "../../src/provider/schema"
import { EventQuery } from "../../src/replay/query"
import { Recorder } from "../../src/replay/recorder"
import { Session } from "../../src/session"
import { MessageV2 } from "../../src/session/message-v2"
import { SessionPrompt } from "../../src/session/prompt"
import { createStoppedAssistantTextResponse } from "../../src/session/prompt-assistant-response"
import { publishPromptFailure } from "../../src/session/prompt-loop-failure"
import type { PromptLoopEndReason } from "../../src/session/prompt-loop-recording"
import { MessageID, type SessionID } from "../../src/session/schema"
import { TaskQueue } from "../../src/session/task-queue"
import { TaskQueueExecutor } from "../../src/session/task-queue-executor"
import { tmpdir } from "../fixture/fixture"

afterEach(async () => {
  vi.restoreAllMocks()
  vi.useRealTimers()
  await Instance.disposeAll()
})

async function response(sessionID: SessionID, error?: MessageV2.Assistant["error"]) {
  return createStoppedAssistantTextResponse({
    sessionID,
    parent: {
      id: MessageID.ascending(),
      agent: "build",
      model: { providerID: ProviderID.make("test"), modelID: ModelID.make("test-model") },
    },
    text: "Test response",
    error,
  })
}

async function recordEnd(sessionID: SessionID, reason: PromptLoopEndReason) {
  Recorder.begin(sessionID)
  Recorder.emit({ type: "session.end", sessionID, reason, totalSteps: 1 })
  await Recorder.end(sessionID)
}

async function settle(sessionID: SessionID) {
  const item = await TaskQueue.enqueue({
    sessionID,
    kind: "prompt",
    title: "Count lines of code",
    payload: { text: "Count lines of code" },
  })
  await TaskQueueExecutor.start(item)
  // Wait for either terminal outcome so a regression reports the incorrect
  // completed state immediately instead of timing out waiting for failure.
  await vi.waitFor(async () => {
    expect((await TaskQueue.get(item.id)).status).toMatch(/^(completed|failed)$/)
  })
  return TaskQueue.get(item.id)
}

describe("task queue execution outcomes", () => {
  test("fails a stalled plain-text tool call with the published assistant error", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({})
        const message = "The model returned a tool call as plain text. No task action actually ran."
        vi.spyOn(SessionPrompt, "prompt").mockImplementation(async () => {
          const result = await response(session.id)
          result.parts[0].text = '<tool_call>{"function":"bash","arguments":{"command":"pwd"}}</tool_call>'
          await Session.updatePart(result.parts[0])
          await publishPromptFailure({ sessionID: session.id, assistant: result.info, message })
          await recordEnd(session.id, "stalled")
          return result
        })

        const item = await settle(session.id)
        expect(item.status).toBe("failed")
        expect(item.error).toBe(message)
        expect(item.time.completed).toBeDefined()
        const messages = await Session.messages({ sessionID: session.id })
        expect(messages.flatMap((entry) => entry.parts).filter((part) => part.type === "tool")).toEqual([])
      },
    })
  })

  test.each([undefined, "completed"] as const)(
    "fails a returned assistant error even with replay end reason %s",
    async (reason) => {
      await using tmp = await tmpdir({ git: true })
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const session = await Session.create({})
          vi.spyOn(SessionPrompt, "prompt").mockImplementation(async () => {
            if (reason) await recordEnd(session.id, reason)
            return response(
              session.id,
              new NamedError.Unknown({ message: "Model failed before completion." }).toObject(),
            )
          })

          const item = await settle(session.id)
          expect(item.status).toBe("failed")
          expect(item.error).toBe("Model failed before completion.")
        },
      })
    },
  )

  test("retains a named assistant failure without a message", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({})
        vi.spyOn(SessionPrompt, "prompt").mockImplementation(() =>
          response(session.id, new MessageV2.OutputLengthError({}).toObject()),
        )

        const item = await settle(session.id)
        expect(item.status).toBe("failed")
        expect(item.error).toBe("MessageOutputLengthError")
      },
    })
  })

  test.each([
    ["stalled", "Session stalled before completing the task"],
    ["step_limit", "Session reached its step limit before completing the task"],
    ["aborted", "Session was aborted before completing the task"],
    ["error", "Session ended with an error"],
  ] as const)("does not report a %s session as completed without an assistant error", async (reason, message) => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({})
        vi.spyOn(SessionPrompt, "prompt").mockImplementation(async () => {
          await recordEnd(session.id, reason)
          return response(session.id)
        })

        const item = await settle(session.id)
        expect(item.status).toBe("failed")
        expect(item.error).toBe(message)
      },
    })
  })

  test("does not fail a successful retry because of an earlier failed turn", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({})
        vi.spyOn(SessionPrompt, "prompt").mockImplementation(async () => {
          const earlier = await response(
            session.id,
            new NamedError.Unknown({ message: "Recovered failure" }).toObject(),
          )
          Recorder.begin(session.id)
          Recorder.emit({
            type: "error",
            sessionID: session.id,
            messageID: earlier.info.id,
            errorType: "UnknownError",
            message: "Recovered failure",
            stepIndex: 0,
          })
          Recorder.emit({ type: "session.end", sessionID: session.id, reason: "completed", totalSteps: 2 })
          await Recorder.end(session.id)
          return response(session.id)
        })

        const item = await settle(session.id)
        expect(item.status).toBe("completed")
        expect(item.error).toBeUndefined()
      },
    })
  })

  test("ignores a stalled replay event from before this queue execution", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({})
        vi.setSystemTime(new Date("2026-09-01T00:00:00Z"))
        await recordEnd(session.id, "stalled")
        vi.setSystemTime(new Date("2026-09-01T00:01:00Z"))
        vi.spyOn(SessionPrompt, "prompt").mockImplementation(() => response(session.id))

        const item = await settle(session.id)
        expect(item.status).toBe("completed")
        expect(item.error).toBeUndefined()
      },
    })
  })

  test("reads the terminal outcome beyond the full-session replay limit", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({})
        Recorder.begin(session.id)
        for (let stepIndex = 0; stepIndex < EventQuery.BY_SESSION_LIMIT; stepIndex++) {
          Recorder.emit({ type: "step.start", sessionID: session.id, stepIndex })
        }
        await Recorder.end(session.id)
        vi.spyOn(SessionPrompt, "prompt").mockImplementation(async () => {
          await recordEnd(session.id, "stalled")
          return response(session.id)
        })

        const item = await settle(session.id)
        expect(item.status).toBe("failed")
        expect(item.error).toBe("Session stalled before completing the task")
      },
    })
  })

  test("uses the matching replay error instead of another assistant's error", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({})
        vi.spyOn(SessionPrompt, "prompt").mockImplementation(async () => {
          const result = await response(session.id)
          Recorder.begin(session.id)
          for (const [messageID, message] of [
            [result.info.id, "Current turn failed"],
            [MessageID.ascending(), "Unrelated assistant failed"],
          ]) {
            Recorder.emit({
              type: "error",
              sessionID: session.id,
              messageID,
              errorType: "UnknownError",
              message,
              stepIndex: 0,
            })
          }
          Recorder.emit({ type: "session.end", sessionID: session.id, reason: "stalled", totalSteps: 1 })
          await Recorder.end(session.id)
          return result
        })

        const item = await settle(session.id)
        expect(item.status).toBe("failed")
        expect(item.error).toBe("Current turn failed")
      },
    })
  })
})
