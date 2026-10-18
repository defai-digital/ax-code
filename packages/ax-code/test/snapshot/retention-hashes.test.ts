import { describe, expect, test } from "vitest"
import { Instance } from "../../src/project/instance"
import { ModelID, ProviderID } from "../../src/provider/schema"
import { Session } from "../../src/session"
import { MessageV2 } from "../../src/session/message-v2"
import { MessageID, PartID, type SessionID } from "../../src/session/schema"
import { MessageTable, PartTable } from "../../src/session/session.sql"
import { SessionShard } from "../../src/session/shard"
import { retainedSnapshotHashes } from "../../src/snapshot/retention"
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

describe("retainedSnapshotHashes", () => {
  test("collects hashes from snapshot, step-start, step-finish, and patch parts", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({})
        const message = userMessage(session.id)
        const hashes = {
          snapshot: "a".repeat(40),
          stepStart: "b".repeat(40),
          stepFinish: "c".repeat(40),
          patch: "d".repeat(40),
        }
        const parts: MessageV2.Part[] = [
          {
            id: PartID.ascending(),
            sessionID: session.id,
            messageID: message.id,
            type: "snapshot",
            snapshot: hashes.snapshot,
          },
          {
            id: PartID.ascending(),
            sessionID: session.id,
            messageID: message.id,
            type: "step-start",
            snapshot: hashes.stepStart,
          },
          {
            id: PartID.ascending(),
            sessionID: session.id,
            messageID: message.id,
            type: "step-finish",
            snapshot: hashes.stepFinish,
            reason: "stop",
            tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
          },
          {
            id: PartID.ascending(),
            sessionID: session.id,
            messageID: message.id,
            type: "patch",
            hash: hashes.patch,
            files: [],
          },
          // Decoys: a payload without a snapshot hash and a malformed hash
          // must not be retained.
          { id: PartID.ascending(), sessionID: session.id, messageID: message.id, type: "text", text: "x" },
          {
            id: PartID.ascending(),
            sessionID: session.id,
            messageID: message.id,
            type: "snapshot",
            snapshot: "not-a-hash",
          },
        ]
        SessionShard.storeFor(session.id, { write: true }).transaction((db) => {
          const { id, sessionID, ...data } = message
          db.insert(MessageTable).values({ id, session_id: sessionID, time_created: message.time.created, data }).run()
          for (const part of parts) {
            const { id: partID, messageID, sessionID: partSessionID, ...partData } = part
            db.insert(PartTable)
              .values({
                id: partID,
                message_id: messageID,
                session_id: partSessionID,
                time_created: Date.now(),
                data: partData,
              })
              .run()
          }
        })
        const retained = retainedSnapshotHashes(Instance.project.id)
        expect([...retained].sort()).toEqual(Object.values(hashes).sort())
      },
    })
  })
})
