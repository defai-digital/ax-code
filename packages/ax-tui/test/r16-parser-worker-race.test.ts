import { mkdtemp, rm } from "node:fs/promises"
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
const parserOptions = (filetype: string, wasm?: string) => ({
  filetype,
  wasm: wasm ?? `https://example.com/${filetype}.wasm`,
  queries: {
    highlights: [`https://example.com/${filetype}-highlights.scm`],
    injections: [`https://example.com/${filetype}-injections.scm`],
  },
})

beforeAll(async () => {
  fixture = await mkdtemp(path.join(os.tmpdir(), "ax-tui-r16-worker-"))
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

const flush = () => new Promise((resolve) => setTimeout(resolve, 0))

describe("parser worker cache invalidation must not race an in-flight load", () => {
  test("re-registering a filetype mid-load resolves the new parser, not the stale one", async () => {
    const downloads: string[] = []
    let resolveFirst: ((value: { content: Buffer }) => void) | undefined
    state.downloadOrLoadImpl = (source: unknown) => {
      downloads.push(String(source))
      if (downloads.length === 1) {
        return new Promise<{ content: Buffer }>((resolve) => {
          resolveFirst = resolve
        })
      }
      return { content: Buffer.from("wasm-v2") }
    }

    await send({ type: "ADD_FILETYPE_PARSER", filetypeParser: parserOptions("ft-race") })
    const preload = send({ type: "PRELOAD_PARSER", filetype: "ft-race", messageId: "r1" })
    await flush()
    await send({
      type: "ADD_FILETYPE_PARSER",
      filetypeParser: parserOptions("ft-race", "https://example.com/ft-race-v2.wasm"),
    })
    resolveFirst!({ content: Buffer.from("wasm-v1") })
    await preload

    expect(downloads).toEqual(["https://example.com/ft-race.wasm", "https://example.com/ft-race-v2.wasm"])
    expect(state.createdQueries).toHaveLength(4)
    expect(state.deletedQueries).toContain(state.createdQueries[0])
    expect(state.deletedQueries).toContain(state.createdQueries[1])
  })

  test("CLEAR_CACHE mid-load does not repopulate the cache with the stale parser", async () => {
    const downloads: string[] = []
    let resolveFirst: ((value: { content: Buffer }) => void) | undefined
    state.downloadOrLoadImpl = (source: unknown) => {
      downloads.push(String(source))
      if (downloads.length === 1) {
        return new Promise<{ content: Buffer }>((resolve) => {
          resolveFirst = resolve
        })
      }
      return { content: Buffer.from("wasm-again") }
    }

    await send({ type: "ADD_FILETYPE_PARSER", filetypeParser: parserOptions("ft-clear") })
    const preload = send({ type: "PRELOAD_PARSER", filetype: "ft-clear", messageId: "c1" })
    await flush()
    await send({ type: "CLEAR_CACHE", messageId: "c2" })
    resolveFirst!({ content: Buffer.from("wasm-stale") })
    await preload

    expect(downloads).toEqual(["https://example.com/ft-clear.wasm", "https://example.com/ft-clear.wasm"])
  })
})
