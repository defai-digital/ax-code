import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import path from "path"
import { Config } from "../../src/config/config"
import { Instance } from "../../src/project/instance"
import { LSP } from "../../src/lsp"
import { completeness, dedupeAndLimit, envelope, isRelevant, queryClients } from "../../src/lsp/workspace-symbol"
import { tmpdir } from "../fixture/fixture"
import { Log } from "../../src/util/log"

beforeEach(async () => {
  await Log.init({ print: false })
})

let configSpy: ReturnType<typeof spyOn> | undefined

afterEach(() => {
  configSpy?.mockRestore()
  configSpy = undefined
})

describe("LSP.workspaceSymbol", () => {
  function symbol(input: { name: string; kind: number; line?: number }) {
    const line = input.line ?? 0
    return {
      name: input.name,
      kind: input.kind,
      location: {
        uri: "file:///repo/a.ts",
        range: {
          start: { line, character: 0 },
          end: { line, character: 1 },
        },
      },
    }
  }

  test("workspace symbol helpers keep relevant code symbols", () => {
    expect(isRelevant(symbol({ name: "Thing", kind: 5 }))).toBe(true)
    expect(isRelevant(symbol({ name: "run", kind: 12 }))).toBe(true)
    expect(isRelevant(symbol({ name: "field", kind: 8 }))).toBe(false)
    expect(isRelevant(symbol({ name: "string", kind: 15 }))).toBe(false)
  })

  test("workspace symbol helpers dedupe by location and respect the result limit", () => {
    const first = symbol({ name: "Thing", kind: 5, line: 1 })
    const duplicate = symbol({ name: "Thing", kind: 5, line: 1 })
    const second = symbol({ name: "Other", kind: 12, line: 2 })

    expect(dedupeAndLimit([first, duplicate, second], 10)).toEqual([first, second])
    expect(dedupeAndLimit([first, second], 1)).toEqual([first])
  })

  test("workspace symbol helpers derive completeness and degraded status", () => {
    expect(completeness({ participatingServerIDs: [], failures: 0 })).toEqual({
      completeness: "empty",
      degraded: true,
    })
    expect(completeness({ participatingServerIDs: ["ts"], failures: 0 })).toEqual({
      completeness: "full",
      degraded: false,
    })
    expect(completeness({ participatingServerIDs: ["ts"], failures: 1 })).toEqual({
      completeness: "partial",
      degraded: true,
    })
  })

  test("workspace symbol query ignores MethodNotFound clients", async () => {
    const result = await queryClients({
      clients: [
        {
          serverID: "eslint",
          connection: {
            sendRequest: async () => {
              throw { code: -32601 }
            },
          },
        } as never,
      ],
      query: "Demo",
      timeoutMs: 100,
      limit: 10,
    })

    expect(result.ok).toBe(true)
    expect(result.envelope.symbols).toEqual([])
    expect(result.envelope.serverIDs).toEqual([])
    expect(result.envelope.completeness).toBe("empty")
    expect(result.envelope.degraded).toBe(true)
  })

  test("workspace symbol query reports partial results when a participating client fails", async () => {
    const first = symbol({ name: "Thing", kind: 5, line: 1 })
    const result = await queryClients({
      clients: [
        {
          serverID: "typescript",
          connection: {
            sendRequest: async () => [first],
          },
        } as never,
        {
          serverID: "gopls",
          connection: {
            sendRequest: async () => {
              throw new Error("down")
            },
          },
        } as never,
      ],
      query: "Thing",
      timeoutMs: 100,
      limit: 10,
    })

    expect(result.ok).toBe(false)
    expect(result.envelope.symbols).toEqual([first])
    expect(result.envelope.serverIDs).toEqual(["typescript"])
    expect(result.envelope.completeness).toBe("partial")
    expect(result.envelope.degraded).toBe(true)
  })

  test("workspace symbol envelope owns semantic selection and query orchestration", async () => {
    const first = symbol({ name: "Thing", kind: 5, line: 1 })
    let selectedOptions: unknown

    const result = await envelope({
      query: "Thing",
      timeoutMs: 100,
      limit: 10,
      selectClients: async (opts) => {
        selectedOptions = opts
        return {
          freshSpawnCount: 0,
          clients: [
            {
              serverID: "typescript",
              connection: {
                sendRequest: async (method: string, params: unknown) => {
                  expect(method).toBe("workspace/symbol")
                  expect(params).toEqual({ query: "Thing" })
                  return [first]
                },
              },
            } as never,
          ],
        }
      },
    })

    expect(selectedOptions).toEqual({ mode: "semantic", method: "workspaceSymbol" })
    expect(result.symbols).toEqual([first])
    expect(result.completeness).toBe("full")
    expect(result.serverIDs).toEqual(["typescript"])
  })

  test("primes configured servers on a cold workspace query", async () => {
    await using tmp = await tmpdir({ git: true })
    const serverPath = path.join(__dirname, "../fixture/lsp/fake-lsp-server.js")
    await Bun.write(path.join(tmp.path, "demo.ts"), "export const demo = 1\n")

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        configSpy = vi.spyOn(Config, "get").mockResolvedValue({
          lsp: {
            fake: {
              command: [process.execPath, serverPath],
              extensions: [".ts"],
            },
          },
        } as never)

        const result = await LSP.workspaceSymbol("DemoSymbol")
        expect(result).toHaveLength(1)
        expect(result[0]?.name).toBe("DemoSymbol")
      },
    })
  })
})
