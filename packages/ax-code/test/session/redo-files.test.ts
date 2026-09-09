import fs from "node:fs/promises"
import path from "node:path"
import { expect, test, vi } from "vitest"
import { Instance } from "../../src/project/instance"
import { Session } from "../../src/session"
import { SessionRevert } from "../../src/session/revert"
import { Snapshot } from "../../src/snapshot"
import { MessageID, PartID } from "../../src/session/schema"
import { ModelID, ProviderID } from "../../src/provider/schema"
import { hiddenMessageIDs } from "../../src/cli/cmd/tui/routes/session/revert"
import { tmpdir } from "../fixture/fixture"

test("two undo levels and redo restore files and messages while preserving unrelated edits", async () => {
  await using tmp = await tmpdir({ git: true })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const file = (name: string) => path.join(tmp.path, name)
      const write = (name: string, text: string) => fs.writeFile(file(name), text)
      const read = (name: string) => fs.readFile(file(name), "utf8")
      await write("中文 文件.txt", "原始\r\n")
      await write("deleted.txt", "restore deletion\n")
      await write("untouched.txt", "local changes before session\n")
      const session = await Session.create({})
      const user = async () =>
        Session.updateMessage({
          id: MessageID.ascending(),
          role: "user",
          sessionID: session.id,
          agent: "default",
          model: { providerID: ProviderID.make("test"), modelID: ModelID.make("test") },
          time: { created: Date.now() },
        })
      const turn = async (mutate: () => Promise<void>) => {
        const u = await user()
        const a = await Session.updateMessage({
          id: MessageID.ascending(),
          role: "assistant",
          sessionID: session.id,
          mode: "default",
          agent: "default",
          path: { cwd: tmp.path, root: tmp.path },
          tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
          modelID: ModelID.make("test"),
          providerID: ProviderID.make("test"),
          parentID: u.id,
          time: { created: Date.now() },
        })
        const hash = await Snapshot.track()
        expect(hash).toBeDefined()
        await Session.updatePart({
          id: PartID.ascending(),
          messageID: a.id,
          sessionID: session.id,
          type: "step-start",
          snapshot: hash!,
        })
        await mutate()
        const patch = await Snapshot.patch(hash!)
        await Session.updatePart({
          id: PartID.ascending(),
          messageID: a.id,
          sessionID: session.id,
          type: "patch",
          ...patch,
        })
        return u
      }
      const one = await turn(async () => {
        await write("中文 文件.txt", "第一轮\r\n")
        await write("added.txt", "new\n")
        await fs.unlink(file("deleted.txt"))
      })
      const two = await turn(async () => {
        await write("中文 文件.txt", "第二轮\r\n")
        await write("second.txt", "second\n")
      })
      const originalMessages = await Session.messages({ sessionID: session.id })
      expect(originalMessages).toHaveLength(4)
      const undo = (messageID: typeof one.id) => SessionRevert.revert({ sessionID: session.id, messageID })
      await expect(undo(MessageID.ascending())).rejects.toThrow("not found")
      expect(await read("中文 文件.txt")).toBe("第二轮\r\n")
      await undo(two.id)
      expect(await read("中文 文件.txt")).toBe("第一轮\r\n")
      await expect(fs.access(file("second.txt"))).rejects.toMatchObject({ code: "ENOENT" })
      expect(await read("added.txt")).toBe("new\n")
      await undo(one.id)
      expect(await read("中文 文件.txt")).toBe("原始\r\n")
      expect(await read("deleted.txt")).toBe("restore deletion\n")
      await expect(fs.access(file("added.txt"))).rejects.toMatchObject({ code: "ENOENT" })
      expect(await read("untouched.txt")).toBe("local changes before session\n")
      expect(await Session.messages({ sessionID: session.id })).toEqual(originalMessages)
      expect(
        hiddenMessageIDs(
          originalMessages.map((m) => m.info),
          one.id,
        ).size,
      ).toBe(4)
      await write("untouched.txt", "manual edit after undo\n")
      await write("manual.txt", "new manual file\n")
      const preview = await SessionRevert.preview({ sessionID: session.id, messageID: two.id })
      expect(preview.diffs.map((d) => d.file)).toEqual(expect.arrayContaining(["added.txt", "deleted.txt"]))
      await expect(fs.access(file("added.txt"))).rejects.toMatchObject({ code: "ENOENT" })
      await undo(two.id)
      expect(await read("中文 文件.txt")).toBe("第一轮\r\n")
      expect
        .soft(await read("added.txt").catch(() => "MISSING"), "partial redo must restore the first turn's added file")
        .toBe("new\n")
      expect
        .soft(
          await fs.access(file("deleted.txt")).then(
            () => "EXISTS",
            () => "MISSING",
          ),
          "partial redo must reapply the first turn's deletion",
        )
        .toBe("MISSING")
      expect((await Session.get(session.id)).revert?.messageID).toBe(two.id)
      expect(
        hiddenMessageIDs(
          originalMessages.map((m) => m.info),
          two.id,
        ).size,
      ).toBe(2)
      const clear = vi.spyOn(Session, "clearRevert").mockRejectedValueOnce(new Error("metadata unavailable"))
      try {
        await expect(SessionRevert.unrevert({ sessionID: session.id })).rejects.toThrow("metadata unavailable")
        expect(await read("中文 文件.txt")).toBe("第一轮\r\n")
        await expect(fs.access(file("second.txt"))).rejects.toMatchObject({ code: "ENOENT" })
        expect((await Session.get(session.id)).revert?.messageID).toBe(two.id)
      } finally {
        clear.mockRestore()
      }
      await SessionRevert.unrevert({ sessionID: session.id })
      expect(await read("中文 文件.txt")).toBe("第二轮\r\n")
      expect(await read("second.txt")).toBe("second\n")
      expect(await read("added.txt")).toBe("new\n")
      expect(await read("untouched.txt")).toBe("manual edit after undo\n")
      expect(await read("manual.txt")).toBe("new manual file\n")
      expect
        .soft(
          await fs.access(file("deleted.txt")).then(
            () => "EXISTS",
            () => "MISSING",
          ),
          "full redo must reapply the original deletion",
        )
        .toBe("MISSING")
      expect((await Session.get(session.id)).revert).toBeUndefined()
      expect(await Session.messages({ sessionID: session.id })).toEqual(originalMessages)
      // Full redo directly from the earliest boundary must restore deletions
      // too, without relying on the intermediate partial redo above.
      await undo(one.id)
      expect(await read("deleted.txt")).toBe("restore deletion\n")
      await SessionRevert.unrevert({ sessionID: session.id })
      await expect(fs.access(file("deleted.txt"))).rejects.toMatchObject({ code: "ENOENT" })
      expect(await read("added.txt")).toBe("new\n")
      expect(await read("untouched.txt")).toBe("manual edit after undo\n")
      const reverted = await undo(two.id)
      await SessionRevert.cleanup(reverted)
      expect((await Session.messages({ sessionID: session.id })).map((m) => m.info.id)).toEqual(
        originalMessages.slice(0, 2).map((m) => m.info.id),
      )
      expect((await Session.get(session.id)).revert).toBeUndefined()
      await user()
      expect(await Session.messages({ sessionID: session.id })).toHaveLength(3)
      expect(await read("中文 文件.txt")).toBe("第一轮\r\n")
    },
  })
}, 60_000)
