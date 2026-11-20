import { mkdtemp, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from "vitest"

const state = vi.hoisted(() => ({
  posted: [] as Array<Record<string, unknown>>,
  handler: undefined as ((event: { data: unknown }) => Promise<void>) | undefined,
  createdQueries: [] as unknown[],
  deletedQueries: [] as unknown[],
  createdParsers: [] as unknown[],
  deletedParsers: [] as unknown[],
  downloadOrLoadImpl: (..._args: unknown[]): unknown => ({ content: Buffer.from("wasm") }),
}))

vi.mock("web-tree-sitter", () => {
  class Parser {
    deleted = false
    constructor() {
      state.createdParsers.push(this)
    }
    static async init(): Promise<void> {}
    setLanguage(): void {}
    parse() {
      if (this.deleted) throw new Error("use-after-free: parse on a deleted parser")
      return { rootNode: {}, delete() {}, edit() {}, getChangedRanges: () => [] }
    }
    delete(): void {
      this.deleted = true
      state.deletedParsers.push(this)
    }
  }
  class Query {
    deleted = false
    constructor(_language: unknown, _source: string) {
      state.createdQueries.push(this)
    }
    captures(): unknown[] {
      if (this.deleted) throw new Error("use-after-free: captures on a deleted query")
      return []
    }
    delete(): void {
      this.deleted = true
      state.deletedQueries.push(this)
    }
  }
  class Tree {}
  const Language = { load: () => ({}) }
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
  fixture = await mkdtemp(path.join(os.tmpdir(), "ax-tui-r17-joiner-"))
  await send({ type: "INIT", dataPath: fixture })
})
afterAll(async () => {
  await rm(fixture, { recursive: true, force: true })
})
beforeEach(() => {
  state.posted.length = 0
  state.createdQueries.length = 0
  state.deletedQueries.length = 0
  state.createdParsers.length = 0
  state.deletedParsers.length = 0
  state.downloadOrLoadImpl = () => ({ content: Buffer.from("wasm") })
})

const flush = () => new Promise((resolve) => setTimeout(resolve, 0))

const gatedFirstDownload = () => {
  const downloads: string[] = []
  const gate: { resolve?: (value: { content: Buffer }) => void } = {}
  state.downloadOrLoadImpl = (source: unknown) => {
    downloads.push(String(source))
    if (downloads.length === 1) {
      return new Promise<{ content: Buffer }>((resolve) => {
        gate.resolve = resolve
      })
    }
    return { content: Buffer.from("wasm-v2") }
  }
  return { downloads, gate }
}

describe("parser worker in-flight loads must not hand freed results to joiners", () => {
  test("a second buffer joining an invalidated load highlights with live queries", async () => {
    const { downloads, gate } = gatedFirstDownload()

    await send({ type: "ADD_FILETYPE_PARSER", filetypeParser: parserOptions("ft-join") })
    const owner = send({
      type: "INITIALIZE_PARSER",
      bufferId: 1,
      version: 1,
      content: "owner",
      filetype: "ft-join",
      messageId: "o1",
    })
    await flush()
    const joiner = send({
      type: "INITIALIZE_PARSER",
      bufferId: 2,
      version: 1,
      content: "joiner",
      filetype: "ft-join",
      messageId: "j1",
    })
    await flush()
    await send({
      type: "ADD_FILETYPE_PARSER",
      filetypeParser: parserOptions("ft-join", "https://example.com/ft-join-v2.wasm"),
    })
    gate.resolve!({ content: Buffer.from("wasm-v1") })
    await Promise.all([owner, joiner])
    await flush()

    expect(downloads).toEqual(["https://example.com/ft-join.wasm", "https://example.com/ft-join-v2.wasm"])
    const initResponses = state.posted.filter((message) => message.type === "PARSER_INIT_RESPONSE")
    expect(initResponses).toHaveLength(2)
    expect(initResponses.every((message) => message.hasParser === true)).toBe(true)
    expect(state.posted.filter((message) => message.type === "ERROR")).toEqual([])
    const highlights = state.posted.filter((message) => message.type === "HIGHLIGHT_RESPONSE")
    expect(highlights.map((message) => message.bufferId).sort()).toEqual([1, 2])

    await send({ type: "DISPOSE_BUFFER", bufferId: 1 })
    await send({ type: "DISPOSE_BUFFER", bufferId: 2 })
    expect(state.createdQueries).toHaveLength(4)
    expect(state.deletedQueries).toEqual([state.createdQueries[0], state.createdQueries[1]])
  })

  test("a second one-shot highlight joining an invalidated reusable load parses with a live parser", async () => {
    const { gate } = gatedFirstDownload()

    await send({ type: "ADD_FILETYPE_PARSER", filetypeParser: parserOptions("ft-reuse") })
    const owner = send({ type: "ONESHOT_HIGHLIGHT", content: "owner", filetype: "ft-reuse", messageId: "o2" })
    await flush()
    const joiner = send({ type: "ONESHOT_HIGHLIGHT", content: "joiner", filetype: "ft-reuse", messageId: "j2" })
    await flush()
    await send({
      type: "ADD_FILETYPE_PARSER",
      filetypeParser: parserOptions("ft-reuse", "https://example.com/ft-reuse-v2.wasm"),
    })
    gate.resolve!({ content: Buffer.from("wasm-v1") })
    await Promise.all([owner, joiner])
    await flush()

    const responses = state.posted.filter((message) => message.type === "ONESHOT_HIGHLIGHT_RESPONSE")
    expect(responses).toHaveLength(2)
    expect(responses.every((message) => message.hasParser === true)).toBe(true)
    expect(state.posted.filter((message) => message.type === "ERROR")).toEqual([])
    expect(state.deletedParsers).toHaveLength(1)
  })
})