import fs from "node:fs"
import { expect, test } from "vitest"
import { Instance } from "../../src/project/instance"
import { Session } from "../../src/session"
import { SessionExecution } from "../../src/session/execution"
import { SessionExecutionContext } from "../../src/session/execution-context"
import { ForegroundOwnership } from "../../src/session/foreground-ownership"
import { Database } from "../../src/storage/db"
import { MessageID, PartID, SessionID } from "../../src/session/schema"
import { ModelID, ProviderID } from "../../src/provider/schema"
import type { MessageV2 } from "../../src/session/message-v2"
import { scanLoopMessages } from "../../src/session/prompt/prompt-loop-messages"
import { tmpdir } from "../fixture/fixture"

test("completed assistant with an unfinished tool retains a recoverable journal", async () => {
  await using tmp = await tmpdir({ git: true })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const session = await Session.create({ title: "Completed assistant crash boundary" })
      await SessionExecution.withRun(session.id, async () => {
        const message = await Session.updateMessage({
          id: MessageID.ascending(),
          sessionID: session.id,
          role: "assistant",
          parentID: MessageID.ascending(),
          agent: "build",
          mode: "build",
          path: { cwd: tmp.path, root: tmp.path },
          modelID: ModelID.make("test"),
          providerID: ProviderID.make("test"),
          tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
          time: { created: 1, completed: 2 },
        })
        await Session.updatePart({
          id: PartID.ascending(),
          sessionID: session.id,
          messageID: message.id,
          type: "tool",
          tool: "bash",
          callID: "unfinished",
          state: { status: "running", input: { command: "test" }, time: { start: 1 }, metadata: { output: "partial" } },
        })
      })
      expect(fs.existsSync(ForegroundOwnership.paths(Database.Path, session.id).journal)).toBe(true)
      await SessionExecution.withRun(session.id, async () => {
        const messages = await Session.messages({ sessionID: session.id })
        expect(messages[0].info).toMatchObject({
          time: { completed: 2 },
          error: { name: "MessageAbortedError", data: { metadata: { reason: "backend_restart" } } },
        })
        expect(messages[0].parts[0]).toMatchObject({
          state: { status: "error", metadata: { output: "partial", interruptionReason: "backend_restart" } },
        })
      })
    },
  })
})

test("independent delayed queue work clears a retired caller's execution context", async () => {
  await using tmp = await tmpdir({ git: true })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const parent = await Session.create({ title: "Parent" })
      const child = await Session.create({ title: "Child" })
      const done = Promise.withResolvers<void>()
      const admitted = Promise.withResolvers<void>()
      await SessionExecution.withRun(parent.id, async () => {
        const delayed = SessionExecution.bindSuccessor(child.id, async () => {
          await SessionExecution.withRun(child.id, async () => {
            expect(SessionExecutionContext.peek()?.sessionID).toBe(child.id)
          })
        })
        setTimeout(() => {
          void admitted.promise.then(delayed).then(done.resolve, done.reject)
        }, 0)
      })
      admitted.resolve()
      await expect(done.promise).resolves.toBeUndefined()
    },
  })
})

test("recovered task boundary cannot replay older subtask requests", () => {
  const sessionID = SessionID.descending()
  const selection = { modelID: ModelID.make("test"), providerID: ProviderID.make("test") }
  const user = (prompt: string): MessageV2.WithParts => {
    const id = MessageID.ascending()
    return {
      info: { role: "user", id, sessionID, agent: "build", model: selection, time: { created: Date.now() } },
      parts: [
        {
          id: PartID.ascending(),
          messageID: id,
          sessionID,
          type: "subtask",
          prompt,
          description: prompt,
          agent: "explore",
        },
      ],
    }
  }
  const oldUser = user("old task")
  const interrupted: MessageV2.WithParts = {
    info: {
      role: "assistant",
      id: MessageID.ascending(),
      sessionID,
      parentID: oldUser.info.id,
      agent: "build",
      mode: "build",
      path: { cwd: ".", root: "." },
      ...selection,
      tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
      time: { created: 1, completed: 2 },
      error: { name: "MessageAbortedError", data: { message: "Interrupted", metadata: { reason: "backend_restart" } } },
    },
    parts: [],
  }
  const newUser = user("new task")
  const scan = scanLoopMessages([oldUser, interrupted, newUser])
  expect(scan.tasks).toEqual(newUser.parts)
  expect(scan.lastUser?.id).toBe(newUser.info.id)
})

test("an abandoned successor reservation releases exactly once and cannot execute later", async () => {
  await using tmp = await tmpdir({ git: true })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const session = await Session.create({ title: "Abandoned scheduling" })
      let invoked = false
      let task: ReturnType<typeof SessionExecution.bindSuccessor>
      await SessionExecution.withRun(session.id, async () => {
        SessionExecution.prepareHandoff(session.id)
        task = SessionExecution.bindSuccessor(session.id, async () => {
          invoked = true
        })
        task.cancel()
        task.cancel()
      })
      expect(fs.existsSync(ForegroundOwnership.paths(Database.Path, session.id).journal)).toBe(false)
      await task!()
      expect(invoked).toBe(false)
      await expect(SessionExecution.withRun(session.id, async () => {})).resolves.toBeUndefined()
    },
  })
})
