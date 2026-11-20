import { existsSync } from "node:fs"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from "vitest"

const state = vi.hoisted(() => ({
  posted: [] as Array<Record<string, unknown>>,
  handler: undefined as ((event: { data: unknown }) => Promise<void>) | undefined,
  createdQueries: [] as unknown[],
  deletedQueries: [] as unknown[],
  languageLoadImpl: (_arg: unknown): unknown => ({}),
  downloadOrLoadImpl: (..._args: unknown[]): unknown => ({ content: Buffer.from("wasm") }),
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
    constructor(_language: unknown, _source: string) {
      state.createdQueries.push(this)
    }
    captures(): unknown[] {
      return []
    }
    delete(): void {
      state.deletedQueries.push(this)
    }
  }
  class Tree {}
  const Language = { load: (arg: unknown) => state.languageLoadImpl(arg) }
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
    downloadOrLoad: (...args: unknown[]) => state.downloadOrLoadImpl(...args),
    fetchHighlightQueries: async () => "(comment) @comment",
  },
}))

vi.mock("../src/platform/runtime.js", () => ({
  resolveBundledFilePath: async () => "/tmp/tree-sitter.wasm",
}))

import "../src/lib/tree-sitter/parser.worker.js"

let fixture: string
const send = async (data: Record<string, unknown>): Promise<void> => {
  await state.handler!({ data })
}
const parserOptions = (filetype: string) => ({
  filetype,
  wasm: `https://example.com/${filetype}.wasm`,
  queries: {
    highlights: [`https://example.com/${filetype}-highlights.scm`],
    injections: [`https://example.com/${filetype}-injections.scm`],
  },
})

beforeAll(async () => {
  fixture = await mkdtemp(path.join(os.tmpdir(), "ax-tui-r15-worker-"))
  await send({ type: "INIT", dataPath: fixture })
})
afterAll(async () => {
  await rm(fixture, { recursive: true, force: true })
})
beforeEach(() => {
  state.posted.length = 0
  state.createdQueries.length = 0
  state.deletedQueries.length = 0
  state.languageLoadImpl = () => ({})
  state.downloadOrLoadImpl = () => ({ content: Buffer.from("wasm") })
})

describe("parser worker query lifecycle", () => {
  test("re-adding a filetype parser deletes replaced queries when no buffer uses them", async () => {
    await send({ type: "ADD_FILETYPE_PARSER", filetypeParser: parserOptions("ft-a") })
    await send({ type: "PRELOAD_PARSER", filetype: "ft-a", messageId: "a1" })
    const old = [...state.createdQueries]
    expect(old).toHaveLength(2)
    await send({ type: "ADD_FILETYPE_PARSER", filetypeParser: parserOptions("ft-a") })
    for (const query of old) expect(state.deletedQueries).toContain(query)
  })

  test("re-adding keeps queries referenced by a live buffer until it is disposed", async () => {
    await send({ type: "ADD_FILETYPE_PARSER", filetypeParser: parserOptions("ft-b") })
    await send({ type: "PRELOAD_PARSER", filetype: "ft-b", messageId: "b1" })
    const live = [...state.createdQueries]
    await send({
      type: "INITIALIZE_PARSER",
      bufferId: 10,
      version: 1,
      content: "x",
      filetype: "ft-b",
      messageId: "b2",
    })
    await send({ type: "ADD_FILETYPE_PARSER", filetypeParser: parserOptions("ft-b") })
    for (const query of live) expect(state.deletedQueries).not.toContain(query)
    await send({ type: "DISPOSE_BUFFER", bufferId: 10 })
    await send({ type: "ADD_FILETYPE_PARSER", filetypeParser: parserOptions("ft-b") })
    for (const query of live) expect(state.deletedQueries).toContain(query)
  })

  test("clearCache deletes unused queries but keeps live-buffer queries", async () => {
    await send({ type: "ADD_FILETYPE_PARSER", filetypeParser: parserOptions("ft-d") })
    await send({ type: "PRELOAD_PARSER", filetype: "ft-d", messageId: "d1" })
    const live = [...state.createdQueries]
    await send({
      type: "INITIALIZE_PARSER",
      bufferId: 20,
      version: 1,
      content: "x",
      filetype: "ft-d",
      messageId: "d2",
    })
    state.createdQueries.length = 0
    await send({ type: "ADD_FILETYPE_PARSER", filetypeParser: parserOptions("ft-e") })
    await send({ type: "PRELOAD_PARSER", filetype: "ft-e", messageId: "e1" })
    const unused = [...state.createdQueries]
    expect(unused).toHaveLength(2)
    await send({ type: "CLEAR_CACHE", messageId: "c1" })
    for (const query of unused) expect(state.deletedQueries).toContain(query)
    for (const query of live) expect(state.deletedQueries).not.toContain(query)
    await send({ type: "DISPOSE_BUFFER", bufferId: 20 })
    await send({ type: "CLEAR_CACHE", messageId: "c2" })
    for (const query of live) expect(state.deletedQueries).toContain(query)
  })
})

describe("parser worker poisoned wasm cache", () => {
  test("a failed Language.load removes the downloaded wasm cache file", async () => {
    const poisoned = path.join(fixture, "poisoned.wasm")
    await writeFile(poisoned, Buffer.from("not wasm"))
    state.downloadOrLoadImpl = () => ({ content: Buffer.from("not wasm"), filePath: poisoned })
    state.languageLoadImpl = () => {
      throw new Error("invalid wasm")
    }
    await send({ type: "ADD_FILETYPE_PARSER", filetypeParser: parserOptions("ft-bad") })
    await send({ type: "PRELOAD_PARSER", filetype: "ft-bad", messageId: "bad1" })
    expect(existsSync(poisoned)).toBe(false)
  })

  test("a failed Language.load keeps local-path sources untouched", async () => {
    const local = path.join(fixture, "local.wasm")
    await writeFile(local, Buffer.from("not wasm"))
    state.downloadOrLoadImpl = () => ({ content: Buffer.from("not wasm"), filePath: local })
    state.languageLoadImpl = () => {
      throw new Error("invalid wasm")
    }
    await send({
      type: "ADD_FILETYPE_PARSER",
      filetypeParser: { ...parserOptions("ft-local"), wasm: local },
    })
    await send({ type: "PRELOAD_PARSER", filetype: "ft-local", messageId: "loc1" })
    expect(existsSync(local)).toBe(true)
  })
})
