import { describe, expect, spyOn, test } from "bun:test"
import path from "path"
import { Session } from "../../src/session"
import { Bus } from "../../src/bus"
import { Log } from "../../src/util/log"
import { Instance } from "../../src/project/instance"
import { MessageV2 } from "../../src/session/message-v2"
import { MessageID, PartID } from "../../src/session/schema"
import { Database, eq } from "../../src/storage/db"
import { SessionTable } from "../../src/session/session.sql"
import { SessionShareTable } from "../../src/share/share.sql"

const projectRoot = path.join(__dirname, "../..")
Log.init({ print: false })

describe("session.started event", () => {
  test("should emit session.started event when session is created", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        let eventReceived = false
        let receivedInfo: Session.Info | undefined

        const unsub = Bus.subscribe(Session.Event.Created, (event) => {
          eventReceived = true
          receivedInfo = event.properties.info as Session.Info
        })

        const session = await Session.create({})

        await new Promise((resolve) => setTimeout(resolve, 100))

        unsub()

        expect(eventReceived).toBe(true)
        expect(receivedInfo).toBeDefined()
        expect(receivedInfo?.id).toBe(session.id)
        expect(receivedInfo?.projectID).toBe(session.projectID)
        expect(receivedInfo?.directory).toBe(session.directory)
        expect(receivedInfo?.title).toBe(session.title)

        await Session.remove(session.id)
      },
    })
  })

  test("session.create emits Created event without redundant Updated", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        const events: string[] = []

        const unsubStarted = Bus.subscribe(Session.Event.Created, () => {
          events.push("started")
        })

        const unsubUpdated = Bus.subscribe(Session.Event.Updated, () => {
          events.push("updated")
        })

        const session = await Session.create({})

        await new Promise((resolve) => setTimeout(resolve, 100))

        unsubStarted()
        unsubUpdated()

        expect(events).toContain("started")
        expect(events).not.toContain("updated")

        await Session.remove(session.id)
      },
    })
  })
})

describe("step-finish token propagation via Bus event", () => {
  test(
    "non-zero tokens propagate through PartUpdated event",
    async () => {
      await Instance.provide({
        directory: projectRoot,
        fn: async () => {
          const session = await Session.create({})

          const messageID = MessageID.ascending()
          await Session.updateMessage({
            id: messageID,
            sessionID: session.id,
            role: "user",
            time: { created: Date.now() },
            agent: "user",
            model: { providerID: "test", modelID: "test" },
            tools: {},
            mode: "",
          } as unknown as MessageV2.Info)

          let received: MessageV2.Part | undefined
          const unsub = Bus.subscribe(MessageV2.Event.PartUpdated, (event) => {
            received = event.properties.part
          })

          const tokens = {
            total: 1500,
            input: 500,
            output: 800,
            reasoning: 200,
            cache: { read: 100, write: 50 },
          }

          const partInput = {
            id: PartID.ascending(),
            messageID,
            sessionID: session.id,
            type: "step-finish" as const,
            reason: "stop",
            tokens,
          }

          await Session.updatePart(partInput)

          await new Promise((resolve) => setTimeout(resolve, 100))

          expect(received).toBeDefined()
          expect(received!.type).toBe("step-finish")
          const finish = received as MessageV2.StepFinishPart
          expect(finish.tokens.input).toBe(500)
          expect(finish.tokens.output).toBe(800)
          expect(finish.tokens.reasoning).toBe(200)
          expect(finish.tokens.total).toBe(1500)
          expect(finish.tokens.cache.read).toBe(100)
          expect(finish.tokens.cache.write).toBe(50)
          expect(received).not.toBe(partInput)

          unsub()
          await Session.remove(session.id)
        },
      })
    },
    { timeout: 30000 },
  )
})

describe("session.updatePartDelta", () => {
  test("rejects missing parts", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        const session = await Session.create({})
        await expect(
          Session.updatePartDelta({
            sessionID: session.id,
            messageID: MessageID.ascending(),
            partID: PartID.ascending(),
            field: "text",
            delta: "hello",
          }),
        ).rejects.toThrow("NotFoundError")
        await Session.remove(session.id)
      },
    })
  })
})

describe("session.setArchived", () => {
  test("updates time.updated when archiving", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        const session = await Session.create({})
        const archivedAt = 50_000
        const updatedAt = 40_000
        const nowSpy = spyOn(Date, "now").mockReturnValue(updatedAt)

        try {
          const before = await Session.get(session.id)
          await Session.setArchived({ sessionID: session.id, time: archivedAt })
          const after = await Session.get(session.id)

          expect(after.time.archived).toBe(archivedAt)
          expect(after.time.updated).toBe(updatedAt)
          expect(after.time.updated).not.toBe(before.time.updated)
        } finally {
          nowSpy.mockRestore()
          await Session.remove(session.id)
        }
      },
    })
  })
})

describe("session.remove", () => {
  test("removes descendant shares", async () => {
    const originalFetch = globalThis.fetch
    globalThis.fetch = (async () => new Response("", { status: 200 })) as unknown as typeof fetch

    try {
      await Instance.provide({
        directory: projectRoot,
        fn: async () => {
          const parent = await Session.create({})
          const child = await Session.create({ parentID: parent.id })

          Database.use((db) => {
            db.insert(SessionShareTable)
              .values([
                { session_id: parent.id, id: "shr_parent", secret: "sec_parent", url: "https://example.com/parent" },
                { session_id: child.id, id: "shr_child", secret: "sec_child", url: "https://example.com/child" },
              ])
              .run()
            db.update(SessionTable)
              .set({ share_url: "https://example.com/parent" })
              .where(eq(SessionTable.id, parent.id))
              .run()
            db.update(SessionTable)
              .set({ share_url: "https://example.com/child" })
              .where(eq(SessionTable.id, child.id))
              .run()
          })

          await Session.remove(parent.id)

          const shares = Database.use((db) => db.select().from(SessionShareTable).all())
          expect(shares).toHaveLength(0)
        },
      })
    } finally {
      globalThis.fetch = originalFetch
    }
  })
})
