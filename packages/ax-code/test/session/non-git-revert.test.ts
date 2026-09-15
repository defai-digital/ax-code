import { expect, test } from "vitest"
import fs from "node:fs/promises"
import path from "node:path"
import { Instance } from "../../src/project/instance"
import { Session } from "../../src/session"
import { SessionRevert } from "../../src/session/revert"
import { MessageID, PartID } from "../../src/session/schema"
import { ProviderID, ModelID } from "../../src/provider/schema"
import { Snapshot } from "../../src/snapshot"
import { tmpdir } from "../fixture/fixture"

test.each([
  { git: false, snapshot: true, captured: true },
  { git: true, snapshot: true, captured: true },
  { git: false, snapshot: false, captured: false },
  { git: false, snapshot: true, captured: false },
])(
  "session undo and redo honor recorded coverage ($git, $snapshot, $captured)",
  async ({ git, snapshot, captured }) => {
    await using tmp = await tmpdir({ git, config: { snapshot } })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const file = path.join(tmp.path, "TEST.txt")
        const original = Buffer.from("This is a test.\r\n/////////////")
        const edited = Buffer.concat([
          original,
          Buffer.from("\n\u4f60\u597d\uff01\nHello!\n\u3053\u3093\u306b\u3061\u306f\uff01\n"),
        ])
        await fs.writeFile(file, original)
        const session = await Session.create({})
        try {
          const user = await Session.updateMessage({
            id: MessageID.ascending(),
            sessionID: session.id,
            role: "user",
            agent: "build",
            model: { providerID: ProviderID.make("openai"), modelID: ModelID.make("gpt-4") },
            time: { created: Date.now() },
          })
          await Session.updatePart({
            id: PartID.ascending(),
            sessionID: session.id,
            messageID: user.id,
            type: "text",
            text: "Append three greeting lines",
          })
          const assistant = await Session.updateMessage({
            id: MessageID.ascending(),
            sessionID: session.id,
            role: "assistant",
            parentID: user.id,
            agent: "build",
            mode: "build",
            path: { cwd: tmp.path, root: tmp.path },
            modelID: ModelID.make("gpt-4"),
            providerID: ProviderID.make("openai"),
            tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
            time: { created: Date.now() },
            finish: "stop",
          })
          const before = captured ? await Snapshot.track() : undefined
          if (captured) expect(before).toBeTruthy()
          await Session.updatePart({
            id: PartID.ascending(),
            sessionID: session.id,
            messageID: assistant.id,
            type: "step-start",
            snapshot: before,
          })
          await fs.writeFile(file, edited)
          if (before) {
            const patch = await Snapshot.patch(before)
            await Session.updatePart({
              id: PartID.ascending(),
              sessionID: session.id,
              messageID: assistant.id,
              type: "patch",
              ...patch,
            })
          }

          const preview = await SessionRevert.preview({ sessionID: session.id, messageID: user.id })
          expect(preview.diffs.map((diff) => diff.file)).toEqual(captured ? ["TEST.txt"] : [])
          await SessionRevert.revert({ sessionID: session.id, messageID: user.id })
          expect(await fs.readFile(file)).toEqual(captured ? original : edited)
          expect((await Session.get(session.id)).revert?.messageID).toBe(user.id)
          expect((await Session.get(session.id)).summary?.files).toBe(captured ? 1 : 0)
          await SessionRevert.unrevert({ sessionID: session.id })
          expect(await fs.readFile(file)).toEqual(edited)
          expect((await Session.get(session.id)).revert).toBeUndefined()
          expect((await Session.messages({ sessionID: session.id })).map((message) => message.info.id)).toEqual([
            user.id,
            assistant.id,
          ])
        } finally {
          await Session.remove(session.id)
        }
      },
    })
  },
)
