import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import { Bus } from "../../src/bus"
import { Instance } from "../../src/project/instance"
import { ModelID, ProviderID } from "../../src/provider/schema"
import { Session } from "../../src/session"
import { MessageV2 } from "../../src/session/message-v2"
import { MessageID, PartID, type SessionID } from "../../src/session/schema"
import { MessageTable, PartTable } from "../../src/session/session.sql"
import { SessionShard } from "../../src/session/shard"
import { Database, eq, sql } from "../../src/storage/db"
import { Shard } from "../../src/storage/shard"
import { tmpdir } from "../fixture/fixture"

function userMessage(sessionID: SessionID): MessageV2.User {
  return {
    id: MessageID.ascending(),
    sessionID,
    role: "user",
    time: { created: 1000 },
    agent: "build",
    model: { providerID: ProviderID.make("test"), modelID: ModelID.make("test") },
  }
}

function textPart(info: MessageV2.Info, text = "part"): MessageV2.TextPart {
  return { id: PartID.ascending(), sessionID: info.sessionID, messageID: info.id, type: "text", text }
}

async function withSession(fn: (info: MessageV2.User) => Promise<void>) {
  await using tmp = await tmpdir({ git: true })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => fn(userMessage((await Session.create({})).id)),
  })
}

function messageRow(info: MessageV2.Info) {
  return SessionShard.storeFor(info.sessionID).use((db) =>
    db.select().from(MessageTable).where(eq(MessageTable.id, info.id)).get(),
  )
}

function partRows(info: MessageV2.Info) {
  return SessionShard.storeFor(info.sessionID).use((db) =>
    db.select().from(PartTable).where(eq(PartTable.message_id, info.id)).all(),
  )
}

async function withFailingPartWrite(sessionID: SessionID, fn: () => Promise<void>) {
  const store = SessionShard.storeFor(sessionID, { write: true })
  store.use((db) =>
    db.run(sql`CREATE TEMP TRIGGER fail_part_write BEFORE INSERT ON part
      WHEN json_extract(NEW.data, '$.text') = 'fail-write'
      BEGIN SELECT RAISE(ABORT, 'injected part write failure'); END`),
  )
  try {
    await fn()
  } finally {
    store.use((db) => db.run(sql`DROP TRIGGER fail_part_write`))
  }
}

test("empty part batches do not need an instance or database", async () => {
  const parts: MessageV2.Part[] = []
  expect(await Session.updateParts(parts)).toBe(parts)
})

describe.each([false, true])("session writes with shards=%s", (sharded) => {
  beforeEach(() => vi.stubEnv("AX_CODE_SHARD_SESSIONS", sharded ? "1" : "0"))
  afterEach(() => vi.unstubAllEnvs())

  test("single and combined message upserts retain creation time and replace the payload", async () => {
    await withSession(async (info) => {
      expect(await Session.updateMessage(info)).toEqual(info)
      const updated = { ...info, time: { created: 2000 }, agent: "review" }
      expect(await Session.updateMessageWithParts(updated, [])).toEqual({ info: updated, parts: [] })
      expect(messageRow(info)).toMatchObject({
        time_created: 1000,
        data: { time: { created: 2000 }, agent: "review" },
      })
      await Session.updateMessage({ ...updated, agent: "build" })
      expect(messageRow(info)).toMatchObject({ time_created: 1000, data: { agent: "build" } })
    })
  })

  test("all part write paths preserve creation time and encode distinct JSON payloads", async () => {
    await withSession(async (info) => {
      await Session.updateMessage(info)
      const part = textPart(info, "initial")
      expect(await Session.updatePart(part)).toEqual(part)
      const store = SessionShard.storeFor(info.sessionID)
      store.use((db) =>
        db.update(PartTable).set({ time_created: 10, time_updated: 20 }).where(eq(PartTable.id, part.id)).run(),
      )
      const updated = { ...part, text: 'quoted "text"\n\\path', metadata: { nested: { values: [1, false, null] } } }
      const other = textPart(info, "other payload")
      await Session.updateParts([updated, other])
      expect(partRows(info)).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: part.id,
            time_created: 10,
            data: { type: "text", text: updated.text, metadata: updated.metadata },
          }),
          expect.objectContaining({ id: other.id, data: { type: "text", text: other.text } }),
        ]),
      )
      expect(partRows(info).find((row) => row.id === part.id)!.time_updated).toBeGreaterThan(20)
      await Session.updateMessageWithParts(info, [{ ...part, text: "combined" }])
      expect(partRows(info).find((row) => row.id === part.id)).toMatchObject({
        time_created: 10,
        data: { text: "combined" },
      })
      await Session.updatePart({ ...part, text: "single" })
      expect(partRows(info).find((row) => row.id === part.id)).toMatchObject({
        time_created: 10,
        data: { text: "single" },
      })
    })
  })

  test("duplicate part IDs keep input event order while the last payload wins", async () => {
    await withSession(async (info) => {
      await Session.updateMessage(info)
      const first = textPart(info, "first")
      const second = { ...first, text: "second" }
      const observed: MessageV2.Part[] = []
      const unsubscribe = Bus.subscribe(MessageV2.Event.PartUpdated, (event) => {
        observed.push(event.properties.part)
      })
      try {
        const parts = [first, second]
        expect(await Session.updateParts(parts)).toBe(parts)
        await vi.waitFor(() => expect(observed).toHaveLength(2))
        expect(observed).toEqual(parts)
        expect(partRows(info)).toEqual([
          expect.objectContaining({ id: first.id, data: { type: "text", text: "second" } }),
        ])
      } finally {
        unsubscribe()
      }
    })
  })

  test("combined writes commit all rows before awaiting message and then part subscribers", async () => {
    await withSession(async (info) => {
      const parts = [textPart(info, "one"), textPart(info, "two")]
      const events: string[] = []
      const snapshots: number[] = []
      let release!: () => void
      const gate = new Promise<void>((resolve) => {
        release = resolve
      })
      const unsubscribeMessage = Bus.subscribe(MessageV2.Event.Updated, async () => {
        events.push("message")
        snapshots.push(partRows(info).length)
        await gate
        events.push("message-finished")
      })
      const unsubscribePart = Bus.subscribe(MessageV2.Event.PartUpdated, (event) => {
        events.push(event.properties.part.id)
      })
      const pending = Session.updateMessageWithParts(info, parts)
      try {
        await vi.waitFor(() => expect(events).toEqual(["message"]))
        expect(snapshots).toEqual([2])
        expect(messageRow(info)?.id).toBe(info.id)
        release()
        expect(await pending).toEqual({ info, parts })
        expect(events).toEqual(["message", "message-finished", ...parts.map((part) => part.id)])
      } finally {
        release()
        await pending
        unsubscribeMessage()
        unsubscribePart()
      }
    })
  })

  test("mixed-session batches fail before the first 500-part chunk is written", async () => {
    await withSession(async (info) => {
      const other = userMessage((await Session.create({})).id)
      await Session.updateMessage(info)
      await Session.updateMessage(other)
      const parts = [...Array.from({ length: 500 }, () => textPart(info)), textPart(other)]
      const events: MessageV2.Part[] = []
      const unsubscribe = Bus.subscribe(MessageV2.Event.PartUpdated, (event) => {
        events.push(event.properties.part)
      })
      try {
        await expect(Session.updateParts(parts)).rejects.toMatchObject({ name: "SessionWriteScopeError" })
        expect(partRows(info)).toEqual([])
        expect(partRows(other)).toEqual([])
        expect(events).toEqual([])
      } finally {
        unsubscribe()
      }
    })
  })

  test.each(["session", "message"])(
    "combined writes reject mismatched %s ownership before inserting the message",
    async (scope) => {
      await withSession(async (info) => {
        const other = userMessage(scope === "session" ? (await Session.create({})).id : info.sessionID)
        await Session.updateMessage(other)
        const invalid = scope === "session" ? { ...textPart(info), sessionID: other.sessionID } : textPart(other)
        const events: string[] = []
        const unsubscribe = Bus.subscribeAll((event) => {
          events.push(event.type)
        })
        try {
          await expect(Session.updateMessageWithParts(info, [textPart(info), invalid])).rejects.toMatchObject({
            name: "SessionWriteScopeError",
          })
          expect(messageRow(info)).toBeUndefined()
          expect(partRows(info)).toEqual([])
          expect(partRows(other)).toEqual([])
          expect(events).toEqual([])
        } finally {
          unsubscribe()
        }
      })
    },
  )

  test("a SQL failure rolls back the combined message and parts without events", async () => {
    await withSession(async (info) => {
      const events: string[] = []
      const unsubscribe = Bus.subscribeAll((event) => {
        events.push(event.type)
      })
      try {
        await withFailingPartWrite(info.sessionID, async () => {
          await expect(
            Session.updateMessageWithParts(info, [textPart(info), textPart(info, "fail-write")]),
          ).rejects.toThrow()
          expect(messageRow(info)).toBeUndefined()
          expect(partRows(info)).toEqual([])
          expect(events).toEqual([])
        })
      } finally {
        unsubscribe()
      }
    })
  })

  test("a later chunk SQL failure retains only the first committed chunk and its events", async () => {
    await withSession(async (info) => {
      await Session.updateMessage(info)
      const committed = Array.from({ length: 500 }, () => textPart(info))
      const parts = [...committed, textPart(info), textPart(info, "fail-write")]
      const events: PartID[] = []
      const unsubscribe = Bus.subscribe(MessageV2.Event.PartUpdated, (event) => {
        events.push(event.properties.part.id)
      })
      try {
        await withFailingPartWrite(info.sessionID, async () => {
          await expect(Session.updateParts(parts)).rejects.toThrow()
          expect(partRows(info)).toHaveLength(500)
          await vi.waitFor(() => expect(events).toEqual(committed.map((part) => part.id)))
        })
      } finally {
        unsubscribe()
      }
    })
  })

  test("single and batch effects are discarded with an outer transaction rollback", async () => {
    await withSession(async (info) => {
      const store = SessionShard.storeFor(info.sessionID, { write: true })
      const events: string[] = []
      const pending: Promise<unknown>[] = []
      const unsubscribe = Bus.subscribeAll((event) => {
        events.push(event.type)
      })
      try {
        expect(() =>
          store.transaction(() => {
            pending.push(Session.updateMessage(info))
            pending.push(Session.updatePart(textPart(info)))
            pending.push(Session.updateParts([textPart(info)]))
            throw new Error("rollback")
          }),
        ).toThrow("rollback")
        await Promise.all(pending)
        expect(messageRow(info)).toBeUndefined()
        expect(partRows(info)).toEqual([])
        expect(events).toEqual([])
      } finally {
        unsubscribe()
      }
    })
  })

  test("writes remain readable after reopening a shard and do not leak into the registry", async () => {
    await withSession(async (info) => {
      const parts = [textPart(info, "first"), textPart(info, "second")]
      await Session.updateMessageWithParts(info, parts)
      if (sharded) Shard.close(Instance.project.id)
      await Session.updateParts(parts.map((part) => ({ ...part, text: "reopened" })))
      expect(partRows(info)).toEqual(
        expect.arrayContaining(
          parts.map((part) => expect.objectContaining({ id: part.id, data: { type: "text", text: "reopened" } })),
        ),
      )
      expect(partRows(info)).toHaveLength(parts.length)
      const registry = Database.use((db) => db.select().from(PartTable).where(eq(PartTable.message_id, info.id)).all())
      expect(registry).toHaveLength(sharded ? 0 : parts.length)
    })
  })

  test("routes valid writes by session across projects and rejects a mixed-project batch", async () => {
    await using first = await tmpdir({ git: true })
    await using second = await tmpdir({ git: true })
    const source = await Instance.provide({ directory: first.path, fn: () => Session.create({}) })
    await Instance.provide({
      directory: second.path,
      fn: async () => {
        const target = await Session.create({})
        expect(source.projectID).not.toBe(target.projectID)
        const sourceMessage = userMessage(source.id)
        const targetMessage = userMessage(target.id)
        const sourcePart = textPart(sourceMessage, "source")
        const targetPart = textPart(targetMessage, "target")
        await Session.updateMessageWithParts(sourceMessage, [sourcePart])
        await Session.updateMessageWithParts(targetMessage, [targetPart])
        await expect(
          Session.updateParts([
            { ...sourcePart, text: "invalid source update" },
            { ...targetPart, text: "invalid target update" },
          ]),
        ).rejects.toMatchObject({ name: "SessionWriteScopeError" })
        expect(partRows(sourceMessage)).toEqual([expect.objectContaining({ data: { type: "text", text: "source" } })])
        expect(partRows(targetMessage)).toEqual([expect.objectContaining({ data: { type: "text", text: "target" } })])
        await Session.updateParts([{ ...sourcePart, text: "valid source update" }])
        expect(partRows(sourceMessage)).toEqual([
          expect.objectContaining({ data: { type: "text", text: "valid source update" } }),
        ])
        if (sharded) {
          const misplaced = Shard.handle(target.projectID).use((db) =>
            db.select().from(PartTable).where(eq(PartTable.session_id, source.id)).all(),
          )
          expect(misplaced).toEqual([])
        }
      },
    })
  })
})
