import { afterEach, describe, expect, spyOn, test } from "bun:test"
import path from "path"
import { tmpdir } from "../fixture/fixture"
import { Config } from "../../src/config/config"
import { Instance } from "../../src/project/instance"
import { LSP } from "../../src/lsp"
import { Log } from "../../src/util/log"

Log.init({ print: false })

let configSpy: ReturnType<typeof spyOn> | undefined

afterEach(() => {
  configSpy?.mockRestore()
  configSpy = undefined
  LSP.perfReset()
})

describe("LSP.selectPrewarmFiles", () => {
  test("keeps the first representative file per language and respects limits", () => {
    expect(
      LSP.selectPrewarmFiles(
        ["/repo/a.ts", "/repo/b.ts", "/repo/lib.rs", "/repo/README.md", "/repo/view.tsx", "/repo/notes.txt"],
        {
          maxFiles: 3,
          maxLanguages: 3,
        },
      ),
    ).toEqual(["/repo/a.ts", "/repo/lib.rs", "/repo/README.md"])
  })

  test("skips unknown/plaintext entries and stops at the language cap", () => {
    expect(
      LSP.selectPrewarmFiles(["/repo/notes.txt", "/repo/a.ts", "/repo/b.tsx", "/repo/c.rs"], {
        maxFiles: 5,
        maxLanguages: 2,
      }),
    ).toEqual(["/repo/a.ts", "/repo/b.tsx"])
  })
})

describe("LSP.prewarmFiles", () => {
  test("deduplicates cold start for files that share the same server root", async () => {
    await using tmp = await tmpdir({ git: true })
    const a = path.join(tmp.path, "a.ts")
    const b = path.join(tmp.path, "b.ts")
    const serverPath = path.join(import.meta.dir, "..", "fixture", "lsp", "fake-lsp-server.js")
    await Bun.write(a, "export const a = 1\n")
    await Bun.write(b, "export const b = 2\n")

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        configSpy = spyOn(Config, "get").mockResolvedValue({
          lsp: {
            typescript: {
              disabled: true,
            },
            fake: {
              command: [process.execPath, serverPath],
              extensions: [".ts"],
            },
          },
        } as never)

        const result = await LSP.prewarmFiles([a, b], {
          mode: "semantic",
          methods: ["documentSymbol", "references"],
        })

        expect(result).toEqual({
          readyCount: 1,
          freshSpawnCount: 1,
        })
        expect((await LSP.status()).map((item) => item.id)).toEqual(["fake"])

        const snap = LSP.perfSnapshot()
        expect(snap.prewarm?.count).toBe(1)
        expect(snap["client.spawn"]?.count).toBe(1)
        expect(snap["client.initialize"]?.count).toBe(1)
      },
    })
  })

  test("prewarms independent servers in parallel", async () => {
    await using tmp = await tmpdir({ git: true })
    const ts = path.join(tmp.path, "a.ts")
    const rs = path.join(tmp.path, "lib.rs")
    const serverPath = path.join(import.meta.dir, "..", "fixture", "lsp", "fake-lsp-server.js")
    await Bun.write(ts, "export const a = 1\n")
    await Bun.write(rs, "fn main() {}\n")

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        configSpy = spyOn(Config, "get").mockResolvedValue({
          lsp: {
            typescript: {
              disabled: true,
            },
            rust: {
              disabled: true,
            },
            "fake-ts": {
              command: [process.execPath, serverPath],
              extensions: [".ts"],
              env: {
                FAKE_LSP_INITIALIZE_DELAY_MS: "300",
              },
            },
            "fake-rs": {
              command: [process.execPath, serverPath],
              extensions: [".rs"],
              env: {
                FAKE_LSP_INITIALIZE_DELAY_MS: "300",
              },
            },
          },
        } as never)

        const result = await LSP.prewarmFiles([ts, rs], {
          mode: "semantic",
          methods: ["documentSymbol", "references"],
        })

        expect(result).toEqual({
          readyCount: 2,
          freshSpawnCount: 2,
        })

        const snap = LSP.perfSnapshot()
        expect(snap.prewarm?.count).toBe(1)
        expect(snap["client.initialize"]?.count).toBe(2)
        expect(snap.prewarm?.totalMs ?? Infinity).toBeLessThan((snap["client.initialize"]?.totalMs ?? 0) - 150)
      },
    })
  })

  test("skips built-in servers that are deferred from startup prewarm", async () => {
    await using tmp = await tmpdir({ git: true })
    const sh = path.join(tmp.path, "script.sh")
    const serverPath = path.join(import.meta.dir, "..", "fixture", "lsp", "fake-lsp-server.js")
    await Bun.write(sh, "#!/usr/bin/env bash\necho ok\n")

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        configSpy = spyOn(Config, "get").mockResolvedValue({
          lsp: {
            bash: {
              command: [process.execPath, serverPath],
              extensions: [".sh"],
            },
          },
        } as never)

        const result = await LSP.prewarmFiles([sh], {
          mode: "semantic",
          methods: ["documentSymbol", "references"],
        })

        expect(result).toEqual({
          readyCount: 0,
          freshSpawnCount: 0,
        })
        expect((await LSP.status()).map((item) => item.id)).toEqual([])
      },
    })
  })

  test("prewarmWorkspace scans only representative files for eligible languages", async () => {
    await using tmp = await tmpdir({ git: true })
    const a = path.join(tmp.path, "a.ts")
    const b = path.join(tmp.path, "b.ts")
    const readme = path.join(tmp.path, "README.md")
    const serverPath = path.join(import.meta.dir, "..", "fixture", "lsp", "fake-lsp-server.js")
    await Bun.write(a, "export const a = 1\n")
    await Bun.write(b, "export const b = 2\n")
    await Bun.write(readme, "# demo\n")

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        configSpy = spyOn(Config, "get").mockResolvedValue({
          lsp: {
            typescript: {
              disabled: true,
            },
            fake: {
              command: [process.execPath, serverPath],
              extensions: [".ts"],
            },
          },
        } as never)

        const result = await LSP.prewarmWorkspace({
          mode: "semantic",
          methods: ["documentSymbol", "references"],
          maxFiles: 4,
          maxLanguages: 4,
        })

        expect(result.readyCount).toBe(1)
        expect(result.freshSpawnCount).toBe(1)
        expect(result.files).toHaveLength(1)
        expect([a, b]).toContain(result.files[0])
      },
    })
  })
})
