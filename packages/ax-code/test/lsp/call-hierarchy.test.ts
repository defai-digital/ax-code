import { afterEach, describe, expect, test, vi, type MockInstance } from "vitest"
import path from "path"
import { writeFile } from "node:fs/promises"
import { LSP } from "@ax-code/ax-code-intel"
import { Config } from "../../src/config/config"
import { Instance } from "../../src/project/instance"
import { tmpdir } from "../fixture/fixture"
import { Log } from "../../src/util/log"

Log.init({ print: false })

let configSpy: MockInstance | undefined

afterEach(() => {
  configSpy?.mockRestore()
  configSpy = undefined
})

const range = {
  start: { line: 0, character: 0 },
  end: { line: 0, character: 3 },
}

function hierarchyItem(name: string) {
  return {
    name,
    kind: 12,
    uri: `file:///workspace/${name}.ts`,
    range,
    selectionRange: range,
  }
}

function incomingCall(name: string) {
  return { from: hierarchyItem(name), fromRanges: [range] }
}

function outgoingCall(name: string) {
  return { to: hierarchyItem(name), fromRanges: [range] }
}

describe("LSP call hierarchy aggregation", () => {
  test("incomingCalls aggregates every prepared hierarchy item", async () => {
    await using tmp = await tmpdir({ git: true })
    const serverPath = path.join(import.meta.dirname, "../fixture/lsp/fake-lsp-server.js")
    const file = path.join(tmp.path, "demo.ts")
    await writeFile(file, "export const hello = () => 1\n")
    const input = {
      file,
      line: 0,
      character: 0,
    }

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        configSpy = vi.spyOn(Config, "get").mockResolvedValue({
          lsp: {
            fake: {
              command: [process.execPath, serverPath],
              extensions: [".ts"],
              env: {
                FAKE_LSP_PREPARE_CALL_HIERARCHY: JSON.stringify([hierarchyItem("a"), hierarchyItem("b")]),
                FAKE_LSP_INCOMING_CALLS: JSON.stringify({
                  a: [incomingCall("caller-1")],
                  b: [incomingCall("caller-2")],
                }),
                FAKE_LSP_OUTGOING_CALLS: JSON.stringify([outgoingCall("ignored-incoming-only")]),
              },
            },
          },
        } as never)

        const calls = await LSP.incomingCalls(input)
        expect(calls).toHaveLength(2)
        expect(calls).toEqual(expect.arrayContaining([incomingCall("caller-1"), incomingCall("caller-2")]))
      },
    })
  })

  test("outgoingCalls aggregates every prepared hierarchy item", async () => {
    await using tmp = await tmpdir({ git: true })
    const serverPath = path.join(import.meta.dirname, "../fixture/lsp/fake-lsp-server.js")
    const file = path.join(tmp.path, "demo.ts")
    await writeFile(file, "export const hello = () => 1\n")
    const input = {
      file,
      line: 0,
      character: 0,
    }

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        configSpy = vi.spyOn(Config, "get").mockResolvedValue({
          lsp: {
            fake: {
              command: [process.execPath, serverPath],
              extensions: [".ts"],
              env: {
                FAKE_LSP_PREPARE_CALL_HIERARCHY: JSON.stringify([hierarchyItem("a"), hierarchyItem("b")]),
                FAKE_LSP_OUTGOING_CALLS: JSON.stringify({
                  a: [outgoingCall("callee-1")],
                  b: [outgoingCall("callee-2")],
                }),
                FAKE_LSP_INCOMING_CALLS: JSON.stringify([incomingCall("ignored-outgoing-only")]),
              },
            },
          },
        } as never)

        const calls = await LSP.outgoingCalls(input)
        expect(calls).toHaveLength(2)
        expect(calls).toEqual(expect.arrayContaining([outgoingCall("callee-1"), outgoingCall("callee-2")]))
      },
    })
  })
})
