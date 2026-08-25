import fs from "fs/promises"
import path from "path"
import { describe, expect, test, vi } from "vitest"
import { Instance } from "../../src/project/instance"
import { ModelID, ProviderID } from "../../src/provider/schema"
import { Session } from "../../src/session"
import type { MessageV2 } from "../../src/session/message-v2"
import { SessionPrompt } from "../../src/session/prompt"
import { SessionRevert } from "../../src/session/revert"
import { SessionRollback } from "../../src/session/rollback"
import { MessageID, PartID, type SessionID } from "../../src/session/schema"
import { Snapshot } from "../../src/snapshot"
import { Log } from "../../src/util/log"
import { tmpdir } from "../fixture/fixture"

Log.init({ print: false })

async function createAssistantMessage(sessionID: SessionID, directory: string) {
  const user = await Session.updateMessage({
    id: MessageID.ascending(),
    role: "user",
    sessionID,
    agent: "default",
    model: {
      providerID: ProviderID.make("test"),
      modelID: ModelID.make("test"),
    },
    time: { created: Date.now() },
  })
  const assistant: MessageV2.Assistant = {
    id: MessageID.ascending(),
    role: "assistant",
    sessionID,
    mode: "default",
    agent: "default",
    path: { cwd: directory, root: directory },
    tokens: {
      input: 0,
      output: 0,
      reasoning: 0,
      cache: { read: 0, write: 0 },
    },
    modelID: ModelID.make("test"),
    providerID: ProviderID.make("test"),
    parentID: user.id,
    time: { created: Date.now() },
  }
  await Session.updateMessage(assistant)
  return assistant
}

async function createBoundary(sessionID: SessionID, directory: string, snapshot: string) {
  const assistant = await createAssistantMessage(sessionID, directory)
  const part = await Session.updatePart({
    id: PartID.ascending(),
    messageID: assistant.id,
    sessionID,
    type: "step-start",
    snapshot,
  })
  return { sessionID, messageID: assistant.id, partID: part.id }
}

async function recordPatch(input: { sessionID: SessionID; directory: string; hash: string; files: string[] }) {
  const assistant = await createAssistantMessage(input.sessionID, input.directory)
  await Session.updatePart({
    id: PartID.ascending(),
    messageID: assistant.id,
    sessionID: input.sessionID,
    type: "patch",
    hash: input.hash,
    files: input.files,
  })
}

describe("descendant-aware rollback", () => {
  test("previews and reverts child-only changes while preserving the child transcript", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const parent = await Session.create({})
        const child = await Session.create({ parentID: parent.id })
        const boundarySnapshot = await Snapshot.track()
        expect(boundarySnapshot).toBeDefined()
        const target = await createBoundary(parent.id, tmp.path, boundarySnapshot!)

        const file = path.join(tmp.path, "child-only.txt")
        await fs.writeFile(file, "delegated change\n")
        await recordPatch({ sessionID: child.id, directory: tmp.path, hash: boundarySnapshot!, files: [file] })
        const childMessages = await Session.messages({ sessionID: child.id })

        const preview = await SessionRevert.preview(target)
        expect(await fs.readFile(file, "utf8")).toBe("delegated change\n")
        expect(preview.diffs).toMatchObject([
          {
            file: "child-only.txt",
            status: "added",
          },
        ])
        expect(preview.descendants).toEqual([{ sessionID: child.id, files: ["child-only.txt"] }])

        await SessionRollback.apply(target)
        await expect(fs.access(file)).rejects.toMatchObject({ code: "ENOENT" })
        expect(await Session.messages({ sessionID: child.id })).toEqual(childMessages)
      },
    })
  })

  test("uses the parent boundary snapshot when a child step spans the boundary", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const parent = await Session.create({})
        const child = await Session.create({ parentID: parent.id })
        const file = path.join(tmp.path, "shared.txt")
        await fs.writeFile(file, "initial\n")
        const childStepBaseline = await Snapshot.track()
        expect(childStepBaseline).toBeDefined()

        await fs.writeFile(file, "before parent boundary\n")
        const boundarySnapshot = await Snapshot.track()
        expect(boundarySnapshot).toBeDefined()
        const target = await createBoundary(parent.id, tmp.path, boundarySnapshot!)

        await fs.writeFile(file, "after parent boundary\n")
        await recordPatch({ sessionID: child.id, directory: tmp.path, hash: childStepBaseline!, files: [file] })

        const preview = await SessionRevert.preview(target)
        expect(preview.diffs[0]).toMatchObject({
          file: "shared.txt",
          before: "before parent boundary\n",
          after: "after parent boundary\n",
        })

        await SessionRollback.apply(target)
        expect(await fs.readFile(file, "utf8")).toBe("before parent boundary\n")
      },
    })
  })

  test("preserves root-only rollback behavior", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const parent = await Session.create({})
        const boundarySnapshot = await Snapshot.track()
        expect(boundarySnapshot).toBeDefined()
        const target = await createBoundary(parent.id, tmp.path, boundarySnapshot!)
        const file = path.join(tmp.path, "root-only.txt")
        await fs.writeFile(file, "root change\n")
        await recordPatch({ sessionID: parent.id, directory: tmp.path, hash: boundarySnapshot!, files: [file] })

        const preview = await SessionRevert.preview(target)
        expect(preview.diffs).toMatchObject([{ file: "root-only.txt", status: "added" }])
        expect(preview.descendants).toEqual([])

        await SessionRollback.apply(target)
        await expect(fs.access(file)).rejects.toMatchObject({ code: "ENOENT" })
      },
    })
  })

  test("cleans only the root transcript when session sharding is enabled", async () => {
    const previous = process.env.AX_CODE_SHARD_SESSIONS
    process.env.AX_CODE_SHARD_SESSIONS = "1"
    try {
      await using tmp = await tmpdir({ git: true })
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const parent = await Session.create({})
          const child = await Session.create({ parentID: parent.id })
          const boundarySnapshot = await Snapshot.track()
          expect(boundarySnapshot).toBeDefined()
          const target = await createBoundary(parent.id, tmp.path, boundarySnapshot!)
          const file = path.join(tmp.path, "sharded-child.txt")
          await fs.writeFile(file, "sharded delegated change\n")
          await recordPatch({ sessionID: child.id, directory: tmp.path, hash: boundarySnapshot!, files: [file] })
          const childMessages = await Session.messages({ sessionID: child.id })

          await SessionRollback.apply(target)

          expect(await Session.messages({ sessionID: parent.id })).toEqual([])
          expect(await Session.messages({ sessionID: child.id })).toEqual(childMessages)
          await expect(fs.access(file)).rejects.toMatchObject({ code: "ENOENT" })
        },
      })
    } finally {
      if (previous === undefined) delete process.env.AX_CODE_SHARD_SESSIONS
      else process.env.AX_CODE_SHARD_SESSIONS = previous
    }
  })

  test("traverses excluded directories to include nested same-directory descendants", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const isolatedDirectory = path.join(tmp.path, "isolated")
        await fs.mkdir(isolatedDirectory)
        const parent = await Session.create({})
        const isolated = await Session.createNext({ parentID: parent.id, directory: isolatedDirectory })
        const grandchild = await Session.createNext({ parentID: isolated.id, directory: tmp.path })
        const boundarySnapshot = await Snapshot.track()
        expect(boundarySnapshot).toBeDefined()
        const target = await createBoundary(parent.id, tmp.path, boundarySnapshot!)

        const nestedFile = path.join(tmp.path, "nested.txt")
        const isolatedFile = path.join(tmp.path, "isolated-change.txt")
        await fs.writeFile(nestedFile, "nested delegated change\n")
        await recordPatch({
          sessionID: grandchild.id,
          directory: tmp.path,
          hash: boundarySnapshot!,
          files: [nestedFile],
        })
        await fs.writeFile(isolatedFile, "isolated worktree change\n")
        await recordPatch({
          sessionID: isolated.id,
          directory: isolatedDirectory,
          hash: boundarySnapshot!,
          files: [isolatedFile],
        })

        const preview = await SessionRevert.preview(target)
        expect(preview.diffs.map((diff) => diff.file)).toEqual(["nested.txt"])
        expect(preview.descendants).toEqual([{ sessionID: grandchild.id, files: ["nested.txt"] }])

        await SessionRollback.apply(target)
        await expect(fs.access(nestedFile)).rejects.toMatchObject({ code: "ENOENT" })
        expect(await fs.readFile(isolatedFile, "utf8")).toBe("isolated worktree change\n")
      },
    })
  })

  test("reports descendant files relative to the worktree when the session starts in a subdirectory", async () => {
    await using tmp = await tmpdir({ git: true })
    const directory = path.join(tmp.path, "packages", "app")
    await fs.mkdir(directory, { recursive: true })
    await Instance.provide({
      directory,
      fn: async () => {
        const parent = await Session.create({})
        const child = await Session.create({ parentID: parent.id })
        const boundarySnapshot = await Snapshot.track()
        expect(boundarySnapshot).toBeDefined()
        const target = await createBoundary(parent.id, directory, boundarySnapshot!)
        const file = path.join(directory, "child.ts")
        await fs.writeFile(file, "export const child = true\n")
        await recordPatch({ sessionID: child.id, directory, hash: boundarySnapshot!, files: [file] })

        const preview = await SessionRevert.preview(target)

        expect(preview.diffs.map((diff) => diff.file)).toEqual(["packages/app/child.ts"])
        expect(preview.descendants).toEqual([{ sessionID: child.id, files: ["packages/app/child.ts"] }])
      },
    })
  })

  test("fails closed when an included descendant is busy", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const parent = await Session.create({})
        const child = await Session.create({ parentID: parent.id })
        const boundarySnapshot = await Snapshot.track()
        expect(boundarySnapshot).toBeDefined()
        const target = await createBoundary(parent.id, tmp.path, boundarySnapshot!)
        const assertSpy = vi.spyOn(SessionPrompt, "assertNotBusy").mockImplementation((sessionID) => {
          if (sessionID === child.id) throw new Session.BusyError(child.id)
        })

        try {
          await expect(SessionRevert.preview(target)).rejects.toBeInstanceOf(Session.BusyError)
          await expect(SessionRollback.apply(target)).rejects.toBeInstanceOf(Session.BusyError)
        } finally {
          assertSpy.mockRestore()
        }
      },
    })
  })
})
