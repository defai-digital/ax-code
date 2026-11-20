import { existsSync, realpathSync } from "node:fs"
import { mkdtemp, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { describe, expect, test, vi } from "vitest"

const state = vi.hoisted(() => ({
  posted: [] as Array<Record<string, unknown>>,
  handler: undefined as ((event: { data: unknown }) => Promise<void>) | undefined,
}))

vi.mock("web-tree-sitter", () => {
  class Parser {
    static async init(): Promise<void> {}
    setLanguage(): void {}
    parse() {
      return { rootNode: {}, delete() {}, edit() {}, getChangedRanges: () => [] }
    }
    delete(): void {}
  }
  class Query {
    constructor(_language: unknown, _source: string) {}
    captures(): unknown[] {
      return []
    }
    delete(): void {}
  }
  class Tree {}
  const Language = { load: async () => ({}) }
  return { Parser, Query, Tree, Language }
})

vi.mock("../src/platform/worker.js", () => ({
  isWorkerRuntime: true,
  postWorkerMessage: (message: Record<string, unknown>) => {
    state.posted.push(message)
  },
  setWorkerMessageHandler: (fn: (event: { data: unknown }) => Promise<void>) => {
    state.handler = fn
  },
}))

vi.mock("../src/lib/tree-sitter/download-utils.js", () => ({
  DownloadUtils: {
    downloadOrLoad: async () => ({ content: Buffer.from("wasm") }),
    fetchHighlightQueries: async () => "(comment) @comment",
  },
}))

vi.mock("../src/platform/runtime.js", () => ({
  resolveBundledFilePath: async () => "/tmp/tree-sitter.wasm",
}))

import "../src/lib/tree-sitter/parser.worker.js"

const send = async (data: Record<string, unknown>): Promise<void> => {
  await state.handler!({ data })
}

async function inScratch<T>(fn: (scratch: string) => Promise<T>): Promise<T> {
  const scratch = realpathSync(await mkdtemp(path.join(os.tmpdir(), "ax-tui-r18-datapath-")))
  const prev = process.cwd()
  process.chdir(scratch)
  try {
    return await fn(scratch)
  } finally {
    process.chdir(prev)
    await rm(scratch, { recursive: true, force: true })
  }
}

describe("parser worker must reject empty data paths instead of writing to the CWD", () => {
  test("INIT with an empty dataPath reports an error and creates nothing", async () => {
    await inScratch(async (scratch) => {
      state.posted.length = 0
      await send({ type: "INIT", dataPath: "" })
      const response = state.posted.find((message) => message.type === "INIT_RESPONSE")
      expect(response).toBeDefined()
      expect(String(response!.error)).toMatch(/data path/i)
      expect(existsSync(path.join(scratch, "tree-sitter"))).toBe(false)
    })
  })

  test("UPDATE_DATA_PATH with blank dataPaths reports errors and creates nothing", async () => {
    await inScratch(async (scratch) => {
      for (const [index, dataPath] of ["", "   "].entries()) {
        state.posted.length = 0
        await send({ type: "UPDATE_DATA_PATH", dataPath, messageId: `dp-${index}` })
        const response = state.posted.find((message) => message.type === "UPDATE_DATA_PATH_RESPONSE")
        expect(response).toBeDefined()
        expect(response!.messageId).toBe(`dp-${index}`)
        expect(String(response!.error)).toMatch(/data path/i)
        expect(existsSync(path.join(scratch, "tree-sitter"))).toBe(false)
        expect(existsSync(path.join(scratch, "   "))).toBe(false)
      }
    })
  })

  test("UPDATE_DATA_PATH with a valid directory still creates the cache layout", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "ax-tui-r18-datapath-valid-"))
    try {
      state.posted.length = 0
      await send({ type: "UPDATE_DATA_PATH", dataPath: dir, messageId: "dp-valid" })
      const response = state.posted.find((message) => message.type === "UPDATE_DATA_PATH_RESPONSE")
      expect(response).toBeDefined()
      expect(response!.error).toBeUndefined()
      expect(existsSync(path.join(dir, "tree-sitter", "languages"))).toBe(true)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})
