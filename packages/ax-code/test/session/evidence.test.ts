import { afterEach, expect, test } from "vitest"
import { Instance } from "../../src/project/instance"
import { Session } from "../../src/session"
import { MessageV2 } from "../../src/session/message-v2"
import { SessionEvidence } from "../../src/session/evidence"
import { MessageID, PartID, type SessionID } from "../../src/session/schema"
import { ModelID, ProviderID } from "../../src/provider/schema"
import { tmpdir } from "../fixture/fixture"

afterEach(() => Instance.disposeAll())

async function message(sessionID: SessionID, text: string, extra: Partial<MessageV2.TextPart> = {}) {
  const info: MessageV2.User = {
    id: MessageID.ascending(),
    sessionID,
    role: "user",
    time: { created: Date.now() },
    agent: "build",
    model: { providerID: ProviderID.make("test"), modelID: ModelID.make("test") },
  }
  const part: MessageV2.TextPart = {
    id: PartID.ascending(),
    messageID: info.id,
    sessionID,
    type: "text",
    text,
    ...extra,
  }
  await Session.updateMessageWithParts(info, [part])
  return { info, parts: [part] }
}

test("recovers canonical pre-compaction evidence without exposing sibling sessions or hidden content", async () => {
  await using tmp = await tmpdir({ git: true })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const session = await Session.create({})
      const other = await Session.create({})
      const original = await message(session.id, "Original constraint: preserve API version 7")
      await message(session.id, "ignored constraint", { ignored: true })
      await message(session.id, "synthetic constraint", { synthetic: true })
      await message(other.id, "private constraint")
      await Session.updatePart({
        id: PartID.ascending(),
        sessionID: session.id,
        messageID: original.info.id,
        type: "reasoning",
        text: "hidden constraint",
        time: { start: 0, end: 1 },
      })
      const found = await SessionEvidence.recover(session.id, { query: "constraint" })
      expect(found.entries).toHaveLength(1)
      expect(found.entries[0]).toMatchObject({
        messageID: original.info.id,
        text: "Original constraint: preserve API version 7",
      })
      expect(
        (await SessionEvidence.recover(session.id, { messageID: (await message(other.id, "secret")).info.id })).entries,
      ).toEqual([])
      expect(SessionEvidence.recoveryPointer([original])).toContain(original.info.id)
    },
  })
})

test("respects message and part revert boundaries, and fails closed on a missing boundary", async () => {
  await using tmp = await tmpdir({ git: true })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const session = await Session.create({})
      const keep = await message(session.id, "keep")
      const boundary = await message(session.id, "retracted")
      await message(session.id, "later")
      await Session.setRevert({ sessionID: session.id, revert: { messageID: boundary.info.id } })
      expect((await SessionEvidence.recover(session.id, {})).entries.map((entry) => entry.text)).toEqual(["keep"])
      const tail = { ...boundary.parts[0], id: PartID.ascending(), text: "retracted part" }
      await Session.updatePart(tail)
      await Session.setRevert({ sessionID: session.id, revert: { messageID: boundary.info.id, partID: tail.id } })
      expect((await SessionEvidence.recover(session.id, {})).entries.map((entry) => entry.text)).toEqual([
        "retracted",
        "keep",
      ])
      await Session.setRevert({ sessionID: session.id, revert: { messageID: MessageID.ascending() } })
      await expect(SessionEvidence.recover(session.id, {})).rejects.toThrow("boundary")
      expect(keep.info.sessionID).toBe(session.id)
    },
  })
})

test("paginates without duplicate evidence and bounds excerpts while redacting credential assignments", async () => {
  await using tmp = await tmpdir({ git: true })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const session = await Session.create({})
      await message(session.id, "oldest")
      await message(session.id, "middle")
      await message(session.id, "token=example-sensitive-value " + "x".repeat(20_000))
      const first = await SessionEvidence.recover(session.id, { limit: 1 })
      expect(first.entries[0].text).not.toContain("example-sensitive-value")
      expect(first.entries[0].text.length).toBeLessThanOrEqual(3_000)
      expect(first.entries[0].truncated).toBe(true)
      expect(first.more).toBe(true)
      const second = await SessionEvidence.recover(session.id, { before: first.before, limit: 1 })
      expect(second.entries[0].text).toBe("middle")
      const third = await SessionEvidence.recover(session.id, { before: second.before, limit: 1 })
      expect(third.entries[0].text).toBe("oldest")
      expect(third.more).toBe(false)
      await expect(SessionEvidence.recover(session.id, { before: "garbage" })).rejects.toThrow()
      await expect(SessionEvidence.recover(session.id, { limit: 100 })).rejects.toThrow()
    },
  })
})

test("fork recovery only sees copied history under the fork's own identifiers", async () => {
  await using tmp = await tmpdir({ git: true })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const parent = await Session.create({})
      const original = await message(parent.id, "shared fact")
      const cut = await message(parent.id, "parent-only fact")
      const child = await Session.fork({ sessionID: parent.id, messageID: cut.info.id })
      const found = await SessionEvidence.recover(child.id, {})
      expect(found.entries.map((entry) => entry.text)).toEqual(["shared fact"])
      expect(found.entries[0].messageID).not.toBe(original.info.id)
    },
  })
})
