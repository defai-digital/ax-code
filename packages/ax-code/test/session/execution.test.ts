import fs from "node:fs"
import { afterEach, expect, test } from "vitest"
import { Instance } from "../../src/project/instance"
import { Session } from "../../src/session"
import { SessionPrompt } from "../../src/session/prompt"
import { SessionExecution } from "../../src/session/execution"
import { SessionExecutionContext } from "../../src/session/execution-context"
import { ForegroundOwnership } from "../../src/session/foreground-ownership"
import { Database } from "../../src/storage/db"
import { MessageID } from "../../src/session/schema"
import { ModelID, ProviderID } from "../../src/provider/schema"
import { tmpdir } from "../fixture/fixture"

afterEach(() => Instance.disposeAll())

test("competing prompts and shells reject before durable insertion, including other instances", async () => {
  await using tmp = await tmpdir({ git: true })
  await using peer = await tmpdir({ git: true })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const session = await Session.create({})
      await SessionExecution.withRun(session.id, async () => {
        const selection = { providerID: ProviderID.make("test"), modelID: ModelID.make("test") }
        await Instance.provide({
          directory: peer.path,
          fn: async () => {
            await expect(
              SessionPrompt.prompt({
                sessionID: session.id,
                model: selection,
                noReply: true,
                parts: [{ type: "text", text: "peer" }],
              }),
            ).rejects.toThrow(Session.BusyError)
            await expect(
              SessionPrompt.shell({ sessionID: session.id, agent: "build", model: selection, command: "echo peer" }),
            ).rejects.toThrow(Session.BusyError)
            expect(() => SessionPrompt.assertNotBusy(session.id)).toThrow(Session.BusyError)
          },
        })
        expect(await Session.messages({ sessionID: session.id })).toEqual([])
      })
      const file = ForegroundOwnership.paths(Database.Path, session.id)
      expect(fs.existsSync(file.journal)).toBe(false)
      expect(() => SessionPrompt.assertNotBusy(session.id)).not.toThrow()
    },
  })
})

test("timer-delayed successor keeps the same generation locked after predecessor cleanup", async () => {
  await using tmp = await tmpdir({ git: true })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const session = await Session.create({})
      let execute: () => Promise<void>
      let previous: SessionExecutionContext.Turn
      let generation: string
      await SessionExecution.withRun(session.id, async () => {
        previous = SessionExecutionContext.peek()!
        generation = previous.stamp.generation
        SessionExecution.prepareHandoff(session.id)
        execute = SessionExecution.bindSuccessor(session.id, async () => {
          expect(SessionExecutionContext.peek()?.stamp.generation).toBe(generation)
          await SessionExecution.withRun(session.id, async () => {
            await Session.updateMessage({
              id: MessageID.ascending(),
              sessionID: session.id,
              role: "user",
              agent: "build",
              model: { providerID: ProviderID.make("test"), modelID: ModelID.make("test") },
              time: { created: Date.now() },
            })
          })
        })
        expect(previous.active).toBe(false)
      })
      const file = ForegroundOwnership.paths(Database.Path, session.id)
      expect(fs.existsSync(file.journal)).toBe(true)
      await expect(SessionExecution.withRun(session.id, async () => {})).rejects.toThrow(Session.BusyError)
      await SessionExecutionContext.provide(previous!, async () => {
        await expect(
          Session.updateMessage({
            id: MessageID.ascending(),
            sessionID: session.id,
            role: "user",
            agent: "build",
            model: { providerID: ProviderID.make("test"), modelID: ModelID.make("test") },
            time: { created: Date.now() },
          }),
        ).rejects.toThrow(SessionExecutionContext.StaleWriteError)
      })
      await execute!()
      expect(fs.existsSync(file.journal)).toBe(false)
      expect(await Session.messages({ sessionID: session.id })).toHaveLength(1)
    },
  })
})

test("unfinished exception cleanup retains a journal and next explicit admission recovers before its body", async () => {
  await using tmp = await tmpdir({ git: true })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const session = await Session.create({})
      let originalGeneration: string
      await expect(
        SessionExecution.withRun(session.id, async () => {
          originalGeneration = SessionExecutionContext.peek()!.stamp.generation
          await Session.updateMessage({
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
            time: { created: Date.now() },
          })
          throw new Error("injected unfinished failure")
        }),
      ).rejects.toThrow("injected unfinished failure")
      const file = ForegroundOwnership.paths(Database.Path, session.id)
      expect(fs.existsSync(file.journal)).toBe(true)
      await SessionExecution.withRun(session.id, async () => {
        expect(SessionExecutionContext.peek()?.stamp.generation).not.toBe(originalGeneration)
        const messages = await Session.messages({ sessionID: session.id })
        expect(messages[0].info).toMatchObject({
          execution: { generation: originalGeneration },
          time: { completed: expect.any(Number) },
          error: { name: "MessageAbortedError", data: { metadata: { reason: "backend_restart" } } },
        })
      })
      expect(fs.existsSync(file.journal)).toBe(false)
      await expect(
        SessionExecution.withRun(session.id, async () => {
          throw new Error("clean error")
        }),
      ).rejects.toThrow("clean error")
      expect(fs.existsSync(file.journal)).toBe(false)
    },
  })
})

test("instance disposal cannot release ownership while the executor is still unwinding", async () => {
  await using tmp = await tmpdir({ git: true })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const session = await Session.create({})
      const cleanup = Promise.withResolvers<void>()
      const entered = Promise.withResolvers<void>()
      const owner = SessionExecution.withRun(session.id, async () => {
        entered.resolve()
        await cleanup.promise
      })
      await entered.promise
      try {
        await Instance.dispose()
        await expect(SessionExecution.withRun(session.id, async () => {})).rejects.toThrow(Session.BusyError)
      } finally {
        cleanup.resolve()
        await owner
      }
      await expect(SessionExecution.withRun(session.id, async () => {})).resolves.toBeUndefined()
    },
  })
})
