import { mkdtemp, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from "vitest"

const state = vi.hoisted(() => ({
  posted: [] as Array<Record<string, unknown>>,
  handler: undefined as ((event: { data: unknown }) => Promise<void>) | undefined,
  injectionQueue: [] as Array<Array<{ name: string; node: unknown }>>,
  highlightQueue: [] as Array<Array<{ name: string; node: unknown }>>,
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
    private source: string
    constructor(_language: unknown, source: string) {
      this.source = source
    }
    captures(): Array<{ name: string; node: unknown }> {
      return this.source.includes("injection.content")
        ? (state.injectionQueue.shift() ?? [])
        : (state.highlightQueue.shift() ?? [])
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
    downloadOrLoad: (...args: unknown[]) => state.downloadOrLoadImpl(...args),
    fetchHighlightQueries: async (sources: string[]) =>
      sources[0].includes("injections") ? "(injection.content) @injection.content" : "(comment) @comment",
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

beforeAll(async () => {
  fixture = await mkdtemp(path.join(os.tmpdir(), "ax-tui-r19-init-race-"))
  await send({ type: "INIT", dataPath: fixture })
})
afterAll(async () => {
  await rm(fixture, { recursive: true, force: true })
})
beforeEach(() => {
  state.posted.length = 0
  state.injectionQueue.length = 0
  state.highlightQueue.length = 0
  state.downloadOrLoadImpl = () => ({ content: Buffer.from("wasm") })
})

const flush = () => new Promise((resolve) => setTimeout(resolve, 0))

function makeHighlightNode() {
  return {
    accesses: 0,
    id: 1,
    get startPosition() {
      this.accesses += 1
      return { row: 0, column: 0 }
    },
    get endPosition() {
      this.accesses += 1
      return { row: 0, column: 0 }
    },
  }
}

function makeInjectionNode() {
  return {
    type: "code_block",
    accesses: 0,
    startPosition: { row: 1, column: 0 },
    get startIndex() {
      this.accesses += 1
      return 10
    },
    get endIndex() {
      this.accesses += 1
      return 20
    },
  }
}

describe("parser worker initial highlights must not outlive the tree they were captured from", () => {
  test("an edit during the initial injection parser load drops the stale tree's highlights", async () => {
    let resolveJs: ((value: { content: Buffer }) => void) | undefined
    state.downloadOrLoadImpl = (source: unknown) =>
      String(source).includes("js.wasm")
        ? new Promise<{ content: Buffer }>((resolve) => {
            resolveJs = resolve
          })
        : { content: Buffer.from("wasm") }

    await send({
      type: "ADD_FILETYPE_PARSER",
      filetypeParser: {
        filetype: "md",
        wasm: "https://example.com/md.wasm",
        queries: {
          highlights: ["https://example.com/md-highlights.scm"],
          injections: ["https://example.com/md-injections.scm"],
        },
        injectionMapping: { nodeTypes: { code_block: "js" } },
      },
    })
    await send({
      type: "ADD_FILETYPE_PARSER",
      filetypeParser: {
        filetype: "js",
        wasm: "https://example.com/js.wasm",
        queries: { highlights: ["https://example.com/js-highlights.scm"] },
      },
    })

    const staleHighlightNode = makeHighlightNode()
    const injectionNode = makeInjectionNode()
    state.highlightQueue = [[{ name: "comment", node: staleHighlightNode }]]
    state.injectionQueue = [[{ name: "injection.content", node: injectionNode }]]

    const init = send({
      type: "INITIALIZE_PARSER",
      bufferId: 1,
      version: 0,
      content: "# hi\n",
      filetype: "md",
      messageId: "init-1",
    })
    await flush()
    const initResponse = state.posted.find((message) => message.type === "PARSER_INIT_RESPONSE")
    expect(initResponse?.hasParser).toBe(true)
    state.posted.length = 0

    state.highlightQueue = [[]]
    state.injectionQueue = [[]]
    await send({ type: "HANDLE_EDITS", bufferId: 1, version: 2, content: "# hi v2\n", edits: [] })
    resolveJs!({ content: Buffer.from("js-wasm") })
    await init

    expect(staleHighlightNode.accesses).toBe(0)
    expect(injectionNode.accesses).toBe(0)
    const highlights = state.posted.filter((message) => message.type === "HIGHLIGHT_RESPONSE")
    expect(highlights.some((message) => message.version === 0)).toBe(false)
    expect(highlights.some((message) => message.version === 2)).toBe(true)
  })
})
