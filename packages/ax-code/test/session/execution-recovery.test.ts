import { randomUUID } from "node:crypto"
import { expect, test } from "vitest"
import { Instance } from "../../src/project/instance"
import { Session } from "../../src/session"
import { SessionExecutionContext } from "../../src/session/execution-context"
import { SessionExecutionRecovery } from "../../src/session/execution-recovery"
import { SessionShard } from "../../src/session/shard"
import { MessageTable, PartTable } from "../../src/session/session.sql"
import { eq } from "../../src/storage/db"
import { MessageID, PartID } from "../../src/session/schema"
import type { SessionID } from "../../src/session/schema"
import type { MessageV2 } from "../../src/session/message-v2"
import { ModelID, ProviderID } from "../../src/provider/schema"
import { tmpdir } from "../fixture/fixture"

function assistant(sessionID: SessionID, parentID: MessageID): MessageV2.Assistant {
  return {
    id: MessageID.ascending(),
    sessionID,
    role: "assistant",
    parentID,
    agent: "build",
    mode: "build",
    path: { cwd: Instance.directory, root: Instance.worktree },
    modelID: ModelID.make("test"),
    providerID: ProviderID.make("test"),
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    time: { created: Date.now() },
  }
}

test.each([false, true])(
  "recovery terminalizes only the dead generation atomically and preserves partial evidence (sharded=%s)",
  async (sharded) => {
    const prior = process.env.AX_CODE_SHARD_SESSIONS
    process.env.AX_CODE_SHARD_SESSIONS = sharded ? "1" : "0"
    await using tmp = await tmpdir({ git: true })
    try {
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const session = await Session.create({})
          const user = await Session.updateMessage({
            id: MessageID.ascending(),
            sessionID: session.id,
            role: "user",
            agent: "build",
            model: { providerID: ProviderID.make("test"), modelID: ModelID.make("test") },
            time: { created: Date.now() },
          })
          const stamp: SessionExecutionContext.Stamp = { version: 1, generation: randomUUID() }
          const dead = await SessionExecutionContext.provide({ sessionID: session.id, stamp, active: true }, () =>
            Session.updateMessage(assistant(session.id, user.id)),
          )
          expect(dead.role === "assistant" && dead.execution).toEqual(stamp)
          const legacy = await Session.updateMessage(assistant(session.id, user.id))
          const otherStamp: SessionExecutionContext.Stamp = { version: 1, generation: randomUUID() }
          const other = await SessionExecutionContext.provide(
            { sessionID: session.id, stamp: otherStamp, active: true },
            () => Session.updateMessage(assistant(session.id, user.id)),
          )
          const running = await Session.updatePart({
            id: PartID.ascending(),
            sessionID: session.id,
            messageID: dead.id,
            type: "tool",
            tool: "bash",
            callID: "running",
            state: {
              status: "running",
              input: { command: "slow-test" },
              time: { start: 123 },
              metadata: { output: "partial output", nested: { retained: true } },
            },
          })
          const pending = await Session.updatePart({
            id: PartID.ascending(),
            sessionID: session.id,
            messageID: dead.id,
            type: "tool",
            tool: "read",
            callID: "pending",
            state: { status: "pending", input: { path: "file.txt" }, raw: "partial args" },
          })
          const text = await Session.updatePart({
            id: PartID.ascending(),
            sessionID: session.id,
            messageID: dead.id,
            type: "text",
            text: "partial text\n",
            time: { start: 124 },
          })
          const reasoning = await Session.updatePart({
            id: PartID.ascending(),
            sessionID: session.id,
            messageID: dead.id,
            type: "reasoning",
            text: "partial reasoning",
            time: { start: 125 },
          })
          const store = SessionShard.storeFor(session.id)
          const before = store.use((db) =>
            db.select().from(PartTable).where(eq(PartTable.session_id, session.id)).all(),
          )
          // Corrupt the last selected row: earlier valid rows must not be partially
          // terminalized when validation fails halfway through the batch.
          store.use((db) =>
            db
              .update(PartTable)
              .set({ data: { type: "reasoning", text: 4 } as never })
              .where(eq(PartTable.id, reasoning.id))
              .run(),
          )
          expect(() => SessionExecutionRecovery.recover(session.id, stamp.generation)).toThrow()
          expect(SessionExecutionRecovery.hasUnfinished(session.id, stamp.generation)).toBe(true)
          const unchanged = await Session.messages({ sessionID: session.id })
          expect(unchanged.find((item) => item.info.id === dead.id)?.info.time).toEqual(dead.time)
          expect(
            store.use((db) => db.select().from(PartTable).where(eq(PartTable.id, running.id)).get())?.data,
          ).toEqual(before.find((row) => row.id === running.id)?.data)
          const { id: _id, sessionID: _sid, messageID: _mid, ...validReasoning } = reasoning
          store.use((db) =>
            db.update(PartTable).set({ data: validReasoning }).where(eq(PartTable.id, reasoning.id)).run(),
          )
          expect(SessionExecutionRecovery.recover(session.id, stamp.generation)).toBe(1)
          expect(SessionExecutionRecovery.recover(session.id, stamp.generation)).toBe(0)
          expect(SessionExecutionRecovery.hasUnfinished(session.id, stamp.generation)).toBe(false)
          const messages = await Session.messages({ sessionID: session.id })
          const recovered = messages.find((item) => item.info.id === dead.id)!
          expect(recovered.info).toMatchObject({
            time: { completed: expect.any(Number) },
            execution: stamp,
            error: { name: "MessageAbortedError", data: { metadata: { reason: "backend_restart" } } },
          })
          expect(recovered.parts.find((part) => part.id === running.id)).toMatchObject({
            state: {
              status: "error",
              input: { command: "slow-test" },
              time: { start: 123, end: expect.any(Number) },
              metadata: {
                output: "partial output",
                nested: { retained: true },
                interruptionReason: "backend_restart",
                sideEffects: "unknown",
                childProcessOutcome: "unknown",
              },
            },
          })
          expect(recovered.parts.find((part) => part.id === pending.id)).toMatchObject({
            state: { status: "error", input: { path: "file.txt" } },
          })
          expect(recovered.parts.find((part) => part.id === text.id)).toMatchObject({
            text: "partial text\n",
            time: { start: 124, end: expect.any(Number) },
          })
          expect(recovered.parts.find((part) => part.id === reasoning.id)).toMatchObject({
            text: "partial reasoning",
            time: { start: 125, end: expect.any(Number) },
          })
          expect(recovered.parts.some((part) => part.type === "patch" || part.type === "step-finish")).toBe(false)
          expect(messages.find((item) => item.info.id === legacy.id)?.info).toEqual(legacy)
          expect(messages.find((item) => item.info.id === other.id)?.info).toEqual(other)
          await Session.remove(session.id)
        },
      })
    } finally {
      if (prior === undefined) delete process.env.AX_CODE_SHARD_SESSIONS
      else process.env.AX_CODE_SHARD_SESSIONS = prior
    }
  },
)

test("canonical insertion stamps the caller and historical updates cannot reassign ownership", async () => {
  await using tmp = await tmpdir({ git: true })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const session = await Session.create({})
      const input = assistant(session.id, MessageID.ascending())
      const legacy = await Session.updateMessage(input)
      const stamp: SessionExecutionContext.Stamp = { version: 1, generation: randomUUID() }
      const turn: SessionExecutionContext.Turn = { sessionID: session.id, stamp, active: true }
      await SessionExecutionContext.provide(turn, async () => {
        expect(await Session.updateMessage(legacy)).not.toHaveProperty("execution", stamp)
        const fresh = assistant(session.id, legacy.id)
        const stored = await Session.updateMessageWithParts(fresh, [])
        expect(stored.info.role === "assistant" && stored.info.execution).toEqual(stamp)
        const forged = { ...stored.info, execution: { version: 1 as const, generation: randomUUID() } }
        expect((await Session.updateMessage(forged)).role === "assistant").toBe(true)
        const row = SessionShard.storeFor(session.id).use((db) =>
          db.select().from(MessageTable).where(eq(MessageTable.id, fresh.id)).get(),
        )
        expect(row?.data.role === "assistant" && row.data.execution).toEqual(stamp)
        turn.active = false
        await expect(Session.updateMessage(fresh)).rejects.toThrow(SessionExecutionContext.StaleWriteError)
        await expect(Session.updateMessageWithParts(fresh, [])).rejects.toThrow(SessionExecutionContext.StaleWriteError)
        await expect(
          Session.updatePart({
            id: PartID.ascending(),
            sessionID: session.id,
            messageID: fresh.id,
            type: "text",
            text: "late",
          }),
        ).rejects.toThrow(SessionExecutionContext.StaleWriteError)
        await expect(Session.updateParts([])).rejects.toThrow(SessionExecutionContext.StaleWriteError)
        await expect(Session.removeMessage({ sessionID: session.id, messageID: fresh.id })).rejects.toThrow(
          SessionExecutionContext.StaleWriteError,
        )
        await expect(
          Session.removePart({ sessionID: session.id, messageID: fresh.id, partID: PartID.ascending() }),
        ).rejects.toThrow(SessionExecutionContext.StaleWriteError)
        await expect(
          Session.updatePartDelta({
            sessionID: session.id,
            messageID: fresh.id,
            partID: PartID.ascending(),
            field: "text",
            delta: "late",
          }),
        ).rejects.toThrow(SessionExecutionContext.StaleWriteError)
      })
      await Session.remove(session.id)
    },
  })
})
