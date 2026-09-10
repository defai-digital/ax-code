import fs from "node:fs/promises"
import path from "node:path"
import { EventEmitter } from "node:events"
import { expect, test, vi } from "vitest"
import { Instance } from "../../src/project/instance"
import { Session } from "../../src/session"
import { SessionRevert } from "../../src/session/revert"
import { Snapshot } from "../../src/snapshot"
import { MessageID, PartID } from "../../src/session/schema"
import { ModelID, ProviderID } from "../../src/provider/schema"
import { createProcessWire } from "../../src/cli/cmd/tui/thread"
import { Rpc } from "../../src/util/rpc"
import { hiddenMessageIDs } from "../../src/cli/cmd/tui/routes/session/revert"
import { undoMessageID, redoMessageID } from "../../src/cli/cmd/tui/routes/session/messages"
import { capSyncedMessages } from "../../src/cli/cmd/tui/context/sync-session-store"
import { tmpdir } from "../fixture/fixture"

test("overlapping reverts serialize file and metadata updates", async () => {
  await using tmp = await tmpdir({ git: true })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const file = path.join(tmp.path, "state.txt")
      await fs.writeFile(file, "base")
      const session = await Session.create({})
      const turn = async (text: string) => {
        const user = await Session.updateMessage({
          id: MessageID.ascending(),
          role: "user",
          sessionID: session.id,
          agent: "default",
          model: { providerID: ProviderID.make("test"), modelID: ModelID.make("test") },
          time: { created: Date.now() },
        })
        const assistant = await Session.updateMessage({
          id: MessageID.ascending(),
          role: "assistant",
          sessionID: session.id,
          mode: "default",
          agent: "default",
          path: { cwd: tmp.path, root: tmp.path },
          tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
          modelID: ModelID.make("test"),
          providerID: ProviderID.make("test"),
          parentID: user.id,
          time: { created: Date.now() },
        })
        const hash = await Snapshot.track()
        expect(hash).toBeDefined()
        await Session.updatePart({
          id: PartID.ascending(),
          messageID: assistant.id,
          sessionID: session.id,
          type: "step-start",
          snapshot: hash!,
        })
        await fs.writeFile(file, text)
        await Session.updatePart({
          id: PartID.ascending(),
          messageID: assistant.id,
          sessionID: session.id,
          type: "patch",
          ...(await Snapshot.patch(hash!)),
        })
        return user
      }
      const one = await turn("one"),
        two = await turn("two")
      const entered = Promise.withResolvers<void>(),
        release = Promise.withResolvers<void>()
      const original = Session.setRevert
      let calls = 0
      const spy = vi.spyOn(Session, "setRevert").mockImplementation(async (input) => {
        if (++calls === 1) {
          entered.resolve()
          await release.promise
        }
        return original(input)
      })
      const first = SessionRevert.revert({ sessionID: session.id, messageID: one.id })
      try {
        await entered.promise
        expect(await fs.readFile(file, "utf8")).toBe("base")
        const second = SessionRevert.revert({ sessionID: session.id, messageID: two.id })
        const state = await Promise.race([
          second.then(() => "finished"),
          new Promise<string>((resolve) => setTimeout(() => resolve("waiting"), 200)),
        ])
        expect(state).toBe("waiting")
        expect(calls).toBe(1)
        expect(await fs.readFile(file, "utf8")).toBe("base")
        release.resolve()
        await Promise.all([first, second])
        expect((await Session.get(session.id)).revert?.messageID).toBe(two.id)
        expect(await fs.readFile(file, "utf8")).toBe("one")
        await SessionRevert.unrevert({ sessionID: session.id })
        expect(await fs.readFile(file, "utf8")).toBe("two")
      } finally {
        release.resolve()
        await first.catch(() => {})
        spy.mockRestore()
      }
    },
  })
}, 60_000)

test("closed stdout rejects pending RPC without requiring child exit", async () => {
  const child = new EventEmitter() as any
  for (const key of ["stdin", "stdout", "stderr"])
    child[key] = Object.assign(new EventEmitter(), { write() {}, setEncoding() {} })
  const wire = createProcessWire(child, "closed-stdout-audit")
  const client = Rpc.client<{ health(input: undefined): Promise<void> }>(wire)
  let settled = false
  const pending = client.call("health", undefined).then(
    () => {
      settled = true
    },
    () => {
      settled = true
    },
  )
  child.stdout.emit("end")
  child.stdout.emit("close")
  await Promise.resolve()
  expect(wire.wireClosed).toBe(true)
  expect(settled).toBe(true)
  child.emit("exit", 0)
  await pending
  expect(settled).toBe(true)
})

test("missing history boundary hides uncertain messages and refuses guessed undo/redo", () => {
  const full = Array.from({ length: 104 }, (_, i) => ({
    id: `message_${String(i).padStart(3, "0")}`,
    role: i % 2 ? "assistant" : "user",
  }))
  const boundary = full[2].id
  const capped = capSyncedMessages(full, 100)
  expect(capped.truncated).toBe(true)
  expect(hiddenMessageIDs(full, boundary).size).toBe(102)
  expect(hiddenMessageIDs(capped.messages!, boundary).size).toBe(100)
  expect(undoMessageID(capped.messages!, boundary)).toBeUndefined()
  expect(redoMessageID(capped.messages!, boundary)).toBeNull()
  expect(redoMessageID(full, boundary)).toBe(full[4].id)
  expect(hiddenMessageIDs(full, undefined).size).toBe(0)
})
