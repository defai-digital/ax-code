import { afterEach, describe, expect, spyOn, test } from "bun:test"
import path from "path"
import { LSP } from "../../src/lsp"
import { Config } from "../../src/config/config"
import { Instance } from "../../src/project/instance"
import { tmpdir } from "../fixture/fixture"
import { Log } from "../../src/util/log"

Log.init({ print: false })

let configSpy: ReturnType<typeof spyOn> | undefined

afterEach(() => {
  configSpy?.mockRestore()
  configSpy = undefined
})

describe("LSP call hierarchy aggregation", () => {
  test("incomingCalls aggregates every prepared hierarchy item", async () => {
    await using tmp = await tmpdir({ git: true })
    const serverPath = path.join(import.meta.dir, "../fixture/lsp/fake-lsp-server.js")
    const file = path.join(tmp.path, "demo.ts")
    await Bun.write(file, "export const hello = () => 1\n")
    const input = {
      file,
      line: 0,
      character: 0,
    }

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        configSpy = spyOn(Config, "get").mockResolvedValue({
          lsp: {
            fake: {
              command: [process.execPath, serverPath],
              extensions: [".ts"],
              env: {
                FAKE_LSP_PREPARE_CALL_HIERARCHY: JSON.stringify([{ name: "a" }, { name: "b" }]),
                FAKE_LSP_INCOMING_CALLS: JSON.stringify({
                  a: [{ from: "caller-1" }],
                  b: [{ from: "caller-2" }],
                }),
                FAKE_LSP_OUTGOING_CALLS: JSON.stringify([{ to: "ignored-incoming-only" }]),
              },
            },
          },
        } as never)

        const calls = await LSP.incomingCalls(input)
        expect(calls).toHaveLength(2)
        expect(calls).toEqual(expect.arrayContaining([{ from: "caller-1" }, { from: "caller-2" }]))
      },
    })
  })

  test("outgoingCalls aggregates every prepared hierarchy item", async () => {
    await using tmp = await tmpdir({ git: true })
    const serverPath = path.join(import.meta.dir, "../fixture/lsp/fake-lsp-server.js")
    const file = path.join(tmp.path, "demo.ts")
    await Bun.write(file, "export const hello = () => 1\n")
    const input = {
      file,
      line: 0,
      character: 0,
    }

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        configSpy = spyOn(Config, "get").mockResolvedValue({
          lsp: {
            fake: {
              command: [process.execPath, serverPath],
              extensions: [".ts"],
              env: {
                FAKE_LSP_PREPARE_CALL_HIERARCHY: JSON.stringify([{ name: "a" }, { name: "b" }]),
                FAKE_LSP_OUTGOING_CALLS: JSON.stringify({
                  a: [{ to: "callee-1" }],
                  b: [{ to: "callee-2" }],
                }),
                FAKE_LSP_INCOMING_CALLS: JSON.stringify([{ from: "ignored-outgoing-only" }]),
              },
            },
          },
        } as never)

        const calls = await LSP.outgoingCalls(input)
        expect(calls).toHaveLength(2)
        expect(calls).toEqual(expect.arrayContaining([{ to: "callee-1" }, { to: "callee-2" }]))
      },
    })
  })
})
