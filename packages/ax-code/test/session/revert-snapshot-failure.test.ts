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
