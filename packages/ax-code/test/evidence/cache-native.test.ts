import { afterEach, describe, expect, test, vi } from "vitest"
import { execFile } from "node:child_process"
import { promisify } from "node:util"
import { createRequire } from "node:module"
import path from "node:path"
import z from "zod"
import { NativeAddon } from "../../src/native/addon"
import { EvidenceCache } from "../../src/evidence/cache"
import { Instance } from "../../src/project/instance"
import { ReadTool } from "../../src/tool/read"
import { SessionID, MessageID } from "../../src/session/schema"
import { tmpdir } from "../fixture/fixture"
import fs from "node:fs/promises"

afterEach(async () => {
  await Instance.disposeAll()
  vi.unstubAllEnvs()
})

// Explicit qualification lane fails if the feature artifact is missing, rather than silently passing mocks.
describe.runIf(process.env.AX_TEST_EVIDENCE_NATIVE === "1")("RocksDB native evidence qualification", () => {
  test("native async persistence, second process lock, close and event-loop responsiveness", async () => {
    const open = NativeAddon.fs()?.openEvidenceStore
    expect(open).toBeTypeOf("function")
    await using tmp = await tmpdir()
    const directory = path.join(tmp.path, "db")
    const db = await open!(directory)
    try {
      let timerRan = false
      const timer = new Promise<void>((resolve) =>
        setTimeout(() => {
          timerRan = true
          resolve()
        }, 0),
      )
      await Promise.all(Array.from({ length: 12 }, (_, i) => db.put(EvidenceCache.key(i), "data".repeat(1000))))
      await timer
      expect(timerRan).toBe(true)
      expect(await db.get(EvidenceCache.key(0))).toBe("data".repeat(1000))
      const binding = createRequire(import.meta.url).resolve("@ax-code/fs")
      const child = await promisify(execFile)(process.execPath, [
        "-e",
        `
        const {openEvidenceStore}=require(process.argv[1]);
        openEvidenceStore(process.argv[2]).then(async db=>{await db.close();process.exitCode=2},()=>process.stdout.write("locked"));
      `,
        binding,
        directory,
      ])
      expect(child.stdout).toBe("locked")
    } finally {
      await db.close()
    }
    const reopened = await open!(directory)
    try {
      expect(await reopened.get(EvidenceCache.key(0))).toBe("data".repeat(1000))
    } finally {
      await reopened.close()
    }
  })

  test("actual read cache survives instance restart and a changed source cannot hit", async () => {
    vi.stubEnv("AX_CODE_EVIDENCE_CACHE", "rocksdb")
    await using tmp = await tmpdir({
      init: async (dir) => fs.writeFile(path.join(dir, "source.ts"), "export const one = 1\n"),
    })
    const ctx = {
      sessionID: SessionID.make("ses_native_cache"),
      messageID: MessageID.make("msg_native_cache"),
      callID: "native-cache",
      agent: "build",
      abort: new AbortController().signal,
      messages: [],
      metadata() {},
      ask: async () => {},
    }
    const read = await ReadTool.init()
    const args = { filePath: path.join(tmp.path, "source.ts") }
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        expect((await read.execute(args, ctx)).metadata).toMatchObject({ evidenceCache: "miss" })
        expect((await EvidenceCache.stats()).backend).toBe("rocksdb")
      },
    })
    await Instance.disposeAll()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        expect((await read.execute(args, ctx)).metadata).toMatchObject({ evidenceCache: "hit" })
        await fs.writeFile(args.filePath, "export const two = 2\n")
        const changed = await read.execute(args, ctx)
        expect(changed.metadata).toMatchObject({ evidenceCache: "miss" })
        expect(changed.output).toContain("two = 2")
        await EvidenceCache.put(EvidenceCache.key("native-contract"), { valid: true })
        expect(await EvidenceCache.get(EvidenceCache.key("native-contract"), z.object({ valid: z.boolean() }))).toEqual(
          { valid: true },
        )
      },
    })
  })
})
