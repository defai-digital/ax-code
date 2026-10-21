import fs from "node:fs/promises"
import path from "node:path"
import { expect, test, vi } from "vitest"
import { Instance } from "../../src/project/instance"
import { Session } from "../../src/session"
import { SessionRevert } from "../../src/session/revert"
import { Snapshot } from "../../src/snapshot"
import { MessageID, PartID } from "../../src/session/schema"
import type { MessageV2 } from "../../src/session/message-v2"
import { tmpdir } from "../fixture/fixture"

test.skipIf(process.platform === "win32")(
  "a transcript-only revert still works when the snapshot cannot be captured",
  async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({})
        const messageID = MessageID.ascending()
        await Session.updateMessage({
          id: messageID,
          sessionID: session.id,
          role: "user",
          agent: "build",
          model: { providerID: "test", modelID: "test" },
          time: { created: Date.now() },
        } as MessageV2.User)
        await Session.updatePart({
          id: PartID.ascending(),
          messageID,
          sessionID: session.id,
          type: "text",
          text: "undo this transcript",
        } as MessageV2.TextPart)

        expect(await Snapshot.track()).toBeDefined()
        const blocked = path.join(tmp.path, "blocked.txt")
        await fs.writeFile(blocked, "unreadable")
        await fs.chmod(blocked, 0o000)
        try {
          // No patch parts means no file writes and no rollback baseline, so
          // the transcript undo must keep the fail-open snapshot behavior.
          const next = await SessionRevert.revert({ sessionID: session.id, messageID })
          expect(next.revert?.messageID).toBe(messageID)
        } finally {
          await fs.chmod(blocked, 0o644)
        }
      },
    })
  },
)

test.skipIf(process.platform === "win32")(
  "a revert that cannot capture its pre-revert snapshot leaves user edits intact",
  async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const file = path.join(tmp.path, "file.txt")
        await fs.writeFile(file, "before turn")
        const session = await Session.create({})
        const user = await Session.updateMessage({
          id: MessageID.ascending(),
          sessionID: session.id,
          role: "user",
          agent: "build",
          model: { providerID: "test", modelID: "test" },
          time: { created: Date.now() },
        } as MessageV2.User)
        const assistant = await Session.updateMessage({
          id: MessageID.ascending(),
          sessionID: session.id,
          role: "assistant",
          mode: "build",
          agent: "build",
          parentID: user.id,
          modelID: "test",
          providerID: "test",
          path: { cwd: tmp.path, root: tmp.path },
          tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
          time: { created: Date.now() },
        } as MessageV2.Assistant)
        const baseline = await Snapshot.track()
        expect(baseline).toBeDefined()
        await Session.updatePart({
          id: PartID.ascending(),
          messageID: assistant.id,
          sessionID: session.id,
          type: "step-start",
          snapshot: baseline!,
        } as MessageV2.StepStartPart)
        // The user edits the file after the turn's baseline but before the undo.
        await fs.writeFile(file, "user edit")
        await Session.updatePart({
          id: PartID.ascending(),
          messageID: assistant.id,
          sessionID: session.id,
          type: "patch",
          ...(await Snapshot.patch(baseline!)),
        } as MessageV2.PatchPart)

        // An unreadable untracked file fails git add while the diff still
        // succeeds, so the pre-revert capture falls back to the old baseline.
        const blocked = path.join(tmp.path, "blocked.txt")
        await fs.writeFile(blocked, "unreadable")
        await fs.chmod(blocked, 0o000)
        const revert = vi.spyOn(Snapshot, "revert")
        try {
          await expect(SessionRevert.revert({ sessionID: session.id, messageID: assistant.id })).rejects.toThrow(
            /Snapshot staging failed/,
          )
          expect(revert).not.toHaveBeenCalled()
          expect(await fs.readFile(file, "utf8")).toBe("user edit")
          expect((await Session.get(session.id)).revert).toBeUndefined()
          // Normal turns still fail open: a staging failure only drops undo
          // coverage, it does not stop the session.
          expect(await Snapshot.track()).toBe(baseline)
        } finally {
          await fs.chmod(blocked, 0o644)
          revert.mockRestore()
        }
      },
    })
  },
)

test.skipIf(process.platform === "win32")(
  "an unrevert that cannot capture its rollback snapshot leaves user edits intact",
  async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const file = path.join(tmp.path, "file.txt")
        await fs.writeFile(file, "before turn")
        const session = await Session.create({})
        const user = await Session.updateMessage({
          id: MessageID.ascending(),
          sessionID: session.id,
          role: "user",
          agent: "build",
          model: { providerID: "test", modelID: "test" },
          time: { created: Date.now() },
        } as MessageV2.User)
        const assistant = await Session.updateMessage({
          id: MessageID.ascending(),
          sessionID: session.id,
          role: "assistant",
          mode: "build",
          agent: "build",
          parentID: user.id,
          modelID: "test",
          providerID: "test",
          path: { cwd: tmp.path, root: tmp.path },
          tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
          time: { created: Date.now() },
        } as MessageV2.Assistant)
        const baseline = await Snapshot.track()
        expect(baseline).toBeDefined()
        await Session.updatePart({
          id: PartID.ascending(),
          messageID: assistant.id,
          sessionID: session.id,
          type: "step-start",
          snapshot: baseline!,
        } as MessageV2.StepStartPart)
        // The user edits the file after the turn's baseline but before the undo.
        await fs.writeFile(file, "user edit")
        await Session.updatePart({
          id: PartID.ascending(),
          messageID: assistant.id,
          sessionID: session.id,
          type: "patch",
          ...(await Snapshot.patch(baseline!)),
        } as MessageV2.PatchPart)

        await SessionRevert.revert({ sessionID: session.id, messageID: assistant.id })
        expect(await fs.readFile(file, "utf8")).toBe("before turn")
        await fs.writeFile(file, "user edit after undo")
        const blocked = path.join(tmp.path, "blocked.txt")
        await fs.writeFile(blocked, "unreadable")
        await fs.chmod(blocked, 0o000)
        const capture = Snapshot.track
        const track = vi.spyOn(Snapshot, "track").mockImplementation(async (options) => {
          try {
            return await capture(options)
          } finally {
            // The staging problem can disappear before restore starts. An
            // old fallback must never become the error-path rollback tree.
            await fs.chmod(blocked, 0o644)
          }
        })
        const clear = vi.spyOn(Session, "clearRevert").mockRejectedValue(new Error("Revert state write failed"))
        const revert = vi.spyOn(Snapshot, "revert")
        try {
          await expect(SessionRevert.unrevert({ sessionID: session.id })).rejects.toThrow(/Snapshot staging failed/)
          expect(revert).not.toHaveBeenCalled()
          expect(await fs.readFile(file, "utf8")).toBe("user edit after undo")
          expect((await Session.get(session.id)).revert).toBeDefined()
        } finally {
          await fs.chmod(blocked, 0o644)
          revert.mockRestore()
          track.mockRestore()
          clear.mockRestore()
        }
      },
    })
  },
)
