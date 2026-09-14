import { afterEach, expect, test, vi } from "vitest"
import fs from "node:fs/promises"
import path from "node:path"
import { ReadTool } from "../../src/tool/read"
import { ReadRecipeTool } from "../../src/tool/read_recipe"
import { FileTime } from "../../src/file/time"
import { Instance } from "../../src/project/instance"
import { Session } from "../../src/session"
import { SessionID, MessageID } from "../../src/session/schema"
import { EvidenceCache } from "../../src/evidence/cache"
import { tmpdir } from "../fixture/fixture"

const ctx = {
  sessionID: SessionID.make("ses_evidence"),
  messageID: MessageID.make("msg_evidence"),
  callID: "read-evidence",
  agent: "build",
  abort: new AbortController().signal,
  messages: [],
  metadata() {},
  ask: async () => {},
}
afterEach(async () => {
  await Instance.disposeAll()
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
})

test("default reads reuse rendering but validate dirty same-mtime rewrites and ranges", async () => {
  vi.stubEnv("AX_CODE_EVIDENCE_CACHE", undefined)
  await using tmp = await tmpdir({
    init: async (dir) => fs.writeFile(path.join(dir, "source.ts"), "export const before = 1\nsecond\n"),
  })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const read = await ReadTool.init()
      const filePath = path.join(tmp.path, "source.ts")
      const args = { filePath, limit: 1 }
      const first = await read.execute(args, ctx)
      const second = await read.execute(args, ctx)
      expect(first.metadata).toMatchObject({ evidenceCache: "miss" })
      expect(second.metadata).toMatchObject({ evidenceCache: "hit" })
      expect(second.output).toBe(first.output)
      expect(second.output).toContain("total not counted")
      const before = await fs.stat(filePath)
      await fs.writeFile(filePath, "export const after_ = 2\nsecond\n")
      await fs.utimes(filePath, before.atime, before.mtime)
      const changed = await read.execute(args, ctx)
      expect(changed.metadata).toMatchObject({ evidenceCache: "miss" })
      expect(changed.output).toContain("after_ = 2")
      expect((await read.execute({ filePath, offset: 2, limit: 1 }, ctx)).metadata).toMatchObject({
        evidenceCache: "miss",
      })
      vi.stubEnv("AX_CODE_EVIDENCE_CACHE", "off")
      expect((await read.execute(args, ctx)).output).toBe(changed.output)
    },
  })
})

test("cache hits still ask permission and reject an escaped replacement symlink", async () => {
  vi.stubEnv("AX_CODE_EVIDENCE_CACHE", "memory")
  await using outside = await tmpdir({ init: async (dir) => fs.writeFile(path.join(dir, "outside.ts"), "outside") })
  await using tmp = await tmpdir({
    git: true,
    init: async (dir) => fs.writeFile(path.join(dir, "source.ts"), "inside"),
  })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const read = await ReadTool.init()
      const filePath = path.join(tmp.path, "source.ts")
      await read.execute({ filePath }, ctx)
      await expect(
        read.execute(
          { filePath },
          {
            ...ctx,
            ask: async () => {
              throw new Error("revoked")
            },
          },
        ),
      ).rejects.toThrow("revoked")
      await fs.unlink(filePath)
      await fs.symlink(path.join(outside.path, "outside.ts"), filePath)
      await expect(read.execute({ filePath }, ctx)).rejects.toThrow()
    },
  })
})

test("observed read stamp cannot admit an edit made after source observation", async () => {
  await using tmp = await tmpdir({ init: async (dir) => fs.writeFile(path.join(dir, "source.ts"), "before") })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const file = path.join(tmp.path, "source.ts")
      const stat = await fs.stat(file)
      await fs.writeFile(file, "after with different size")
      await FileTime.read(ctx.sessionID, file, {
        mtime: stat.mtime.getTime(),
        ctime: stat.ctime.getTime(),
        size: stat.size,
      })
      await expect(FileTime.assert(ctx.sessionID, file)).rejects.toThrow("modified since")
    },
  })
})

test("source changes during cache lookup reject the observed result", async () => {
  vi.stubEnv("AX_CODE_EVIDENCE_CACHE", "memory")
  await using tmp = await tmpdir({ init: async (dir) => fs.writeFile(path.join(dir, "source.ts"), "before") })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const read = await ReadTool.init()
      const filePath = path.join(tmp.path, "source.ts")
      await read.execute({ filePath }, ctx)
      const get = EvidenceCache.get
      vi.spyOn(EvidenceCache, "get").mockImplementation(async (key, schema) => {
        const cached = await get(key, schema)
        await fs.writeFile(filePath, "changed during lookup")
        return cached
      })
      await expect(read.execute({ filePath }, ctx)).rejects.toThrow("File changed while reading")
      await expect(FileTime.assert(ctx.sessionID, filePath)).rejects.toThrow("modified since")
    },
  })
})

test("cancellation during cache publication does not return a successful read", async () => {
  vi.stubEnv("AX_CODE_EVIDENCE_CACHE", "memory")
  await using tmp = await tmpdir({ init: async (dir) => fs.writeFile(path.join(dir, "source.ts"), "source") })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const controller = new AbortController()
      vi.spyOn(EvidenceCache, "put").mockImplementation(async () => {
        controller.abort(new Error("cancelled during cache publication"))
      })
      const read = await ReadTool.init()
      await expect(
        read.execute({ filePath: path.join(tmp.path, "source.ts") }, { ...ctx, abort: controller.signal }),
      ).rejects.toThrow("cancelled during cache publication")
    },
  })
})

test("one recipe uses real cached child reads and preserves full child records", async () => {
  vi.stubEnv("AX_CODE_EVIDENCE_CACHE", "memory")
  await using tmp = await tmpdir({
    init: async (dir) => fs.writeFile(path.join(dir, "source.ts"), "export const result = 1\n"),
  })
  const records = vi.spyOn(Session, "updatePart").mockImplementation(async (part) => part)
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const read = await ReadTool.init()
      const recipe = await ReadRecipeTool.init()
      const filePath = path.join(tmp.path, "source.ts")
      const result = await recipe.execute(
        {
          steps: [
            { id: "first", tool: "read", parameters: { filePath } },
            { id: "again", tool: "read", parameters: { filePath } },
          ],
        },
        {
          ...ctx,
          extra: {
            toolDispatcher: {
              ids: ["read"],
              concurrencySafe: () => true,
              execute: async ({ parameters }: { parameters: unknown }) =>
                read.execute(parameters as { filePath: string }, ctx),
            },
          },
        },
      )
      expect(result.metadata).toMatchObject({ calls: 2, recipeProjection: true })
      expect((await EvidenceCache.stats()).hits).toBe(1)
      expect(
        records.mock.calls.filter(([part]) => part.type === "tool" && part.state.status === "completed"),
      ).toHaveLength(2)
      expect(result.output).toContain("result = 1")
    },
  })
})
