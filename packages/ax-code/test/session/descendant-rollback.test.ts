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
import { Storage } from "../../src/storage/storage"
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

        const rolledBack = await SessionRollback.apply(target)
        expect(await fs.readFile(file, "utf8")).toBe("before parent boundary\n")
        expect(rolledBack.summary).toMatchObject({ files: 1, additions: 1, deletions: 1 })
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

        const rolledBack = await SessionRollback.apply(target)
        await expect(fs.access(file)).rejects.toMatchObject({ code: "ENOENT" })
        expect(rolledBack.summary).toMatchObject({ files: 1, additions: 1, deletions: 0 })
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

  test("orders same-millisecond message and part boundaries by monotonic id payload", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({})
        const now = vi.spyOn(Date, "now").mockReturnValue(1_900_000_000_000)
        try {
          const initial = await Snapshot.track()
          expect(initial).toBeDefined()
          const beforeFile = path.join(tmp.path, "before-boundary.txt")
          await fs.writeFile(beforeFile, "keep this change\n")
          await recordPatch({ sessionID: session.id, directory: tmp.path, hash: initial!, files: [beforeFile] })

          const boundarySnapshot = await Snapshot.track()
          expect(boundarySnapshot).toBeDefined()
          const boundary = await createAssistantMessage(session.id, tmp.path)
          await Session.updatePart({
            id: PartID.ascending(),
            messageID: boundary.id,
            sessionID: session.id,
            type: "text",
            text: "Keep changes before this message",
          })

          const afterFile = path.join(tmp.path, "after-boundary.txt")
          await fs.writeFile(afterFile, "revert this change\n")
          await recordPatch({
            sessionID: session.id,
            directory: tmp.path,
            hash: boundarySnapshot!,
            files: [afterFile],
          })

          const preview = await SessionRevert.preview({ sessionID: session.id, messageID: boundary.id })

          expect(preview.diffs.map((diff) => diff.file)).toEqual(["after-boundary.txt"])
        } finally {
          now.mockRestore()
        }
      },
    })
  })

  test("supports whole-message rollback when the boundary message has no parts", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({})
        const baseline = await Snapshot.track()
        expect(baseline).toBeDefined()
        const boundary = await createAssistantMessage(session.id, tmp.path)
        const file = path.join(tmp.path, "after-empty-message.txt")
        await fs.writeFile(file, "revert this change\n")
        await recordPatch({ sessionID: session.id, directory: tmp.path, hash: baseline!, files: [file] })

        const target = { sessionID: session.id, messageID: boundary.id }
        const preview = await SessionRevert.preview(target)
        expect(preview.diffs.map((diff) => diff.file)).toEqual(["after-empty-message.txt"])

        await SessionRollback.apply(target)
        await expect(fs.access(file)).rejects.toMatchObject({ code: "ENOENT" })
      },
    })
  })

  test("keeps a completed revert recoverable when the diff cache write fails", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({})
        const baseline = await Snapshot.track()
        expect(baseline).toBeDefined()
        const target = await createBoundary(session.id, tmp.path, baseline!)
        const file = path.join(tmp.path, "recoverable.txt")
        await fs.writeFile(file, "recover me\n")
        await recordPatch({ sessionID: session.id, directory: tmp.path, hash: baseline!, files: [file] })
        const storageWrite = vi.spyOn(Storage, "write").mockRejectedValue(new Error("diff cache unavailable"))

        try {
          const reverted = await SessionRevert.revert(target)
          expect(reverted.revert?.snapshot).toBeDefined()
          await expect(fs.access(file)).rejects.toMatchObject({ code: "ENOENT" })

          await SessionRevert.unrevert({ sessionID: session.id })
          expect(await fs.readFile(file, "utf8")).toBe("recover me\n")
        } finally {
          storageWrite.mockRestore()
        }
      },
    })
  })

  test("restores the worktree when persisting revert metadata fails", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({})
        const baseline = await Snapshot.track()
        expect(baseline).toBeDefined()
        const target = await createBoundary(session.id, tmp.path, baseline!)
        const file = path.join(tmp.path, "metadata-failure.txt")
        await fs.writeFile(file, "keep after failure\n")
        await recordPatch({ sessionID: session.id, directory: tmp.path, hash: baseline!, files: [file] })
        const setRevert = vi.spyOn(Session, "setRevert").mockRejectedValue(new Error("metadata unavailable"))

        try {
          await expect(SessionRevert.revert(target)).rejects.toThrow("metadata unavailable")
          expect(await fs.readFile(file, "utf8")).toBe("keep after failure\n")
          expect((await Session.get(session.id)).revert).toBeUndefined()
        } finally {
          setRevert.mockRestore()
        }
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
