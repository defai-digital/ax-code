import { afterEach, describe, expect, spyOn, test } from "bun:test"
import fs from "fs"
import path from "path"
import { Instance } from "../../src/project/instance"
import { Server } from "../../src/server/server"
import { tmpdir } from "../fixture/fixture"
import { LSP } from "../../src/lsp"
import { Log } from "../../src/util/log"
import { File } from "../../src/file"

Log.init({ print: false })

let workspaceSymbolSpy: ReturnType<typeof spyOn> | undefined

afterEach(() => {
  workspaceSymbolSpy?.mockRestore()
  workspaceSymbolSpy = undefined
})

describe("file routes", () => {
  test("find file treats bare dirs query flag as true", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        let searchInput: Parameters<typeof File.search>[0] | undefined
        const searchSpy = spyOn(File, "search").mockImplementation(async (input) => {
          searchInput = input
          return ["needle-dir"]
        })
        try {
          const dir = `directory=${encodeURIComponent(tmp.path)}`
          const response = await Server.Default().request(`/find/file?query=needle&dirs&${dir}`)
          expect(response.status).toBe(200)
          expect(await response.json()).toEqual(["needle-dir"])
          expect(searchInput?.dirs).toBe(true)
        } finally {
          searchSpy.mockRestore()
        }
      },
    })
  })

  test("find symbol delegates to LSP workspaceSymbol", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        workspaceSymbolSpy = spyOn(LSP, "workspaceSymbol").mockResolvedValue([
          {
            name: "DemoSymbol",
            kind: 12,
            location: {
              uri: "file:///workspace/demo.ts",
              range: {
                start: { line: 0, character: 0 },
                end: { line: 0, character: 10 },
              },
            },
          },
        ] as any)

        const response = await Server.Default().request("/find/symbol?query=DemoSymbol")
        expect(response.status).toBe(200)
        expect(workspaceSymbolSpy).toHaveBeenCalledWith("DemoSymbol")

        const body = (await response.json()) as Array<{ name: string }>
        expect(body).toHaveLength(1)
        expect(body[0]?.name).toBe("DemoSymbol")
      },
    })
  })

  test("path traversal read returns 403 instead of 500", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const dir = `directory=${encodeURIComponent(tmp.path)}`
        const response = await Server.Default().request(
          `/file/content?path=${encodeURIComponent("../../etc/passwd")}&${dir}`,
        )
        expect(response.status).toBe(403)
        const body = (await response.json()) as { name: string; details?: { resource?: string } }
        expect(body.name).toBe("ForbiddenError")
        expect(body.details?.resource).toBe("file")
      },
    })
  })

  test("path traversal list returns 403 instead of 500", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const dir = `directory=${encodeURIComponent(tmp.path)}`
        const response = await Server.Default().request(`/file?path=${encodeURIComponent("../../etc")}&${dir}`)
        expect(response.status).toBe(403)
        const body = (await response.json()) as { name: string }
        expect(body.name).toBe("ForbiddenError")
      },
    })
  })

  test("null byte read path returns 403 instead of 500", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const dir = `directory=${encodeURIComponent(tmp.path)}`
        const response = await Server.Default().request(`/file/content?path=${encodeURIComponent("\0bad")}&${dir}`)
        expect(response.status).toBe(403)
        const body = (await response.json()) as { name: string; details?: { resource?: string } }
        expect(body.name).toBe("ForbiddenError")
        expect(body.details?.resource).toBe("file")
      },
    })
  })

  test("null byte list path returns 403 instead of 500", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const dir = `directory=${encodeURIComponent(tmp.path)}`
        const response = await Server.Default().request(`/file?path=${encodeURIComponent("\0bad")}&${dir}`)
        expect(response.status).toBe(403)
        const body = (await response.json()) as { name: string; details?: { resource?: string } }
        expect(body.name).toBe("ForbiddenError")
        expect(body.details?.resource).toBe("file")
      },
    })
  })

  test("symlink escape read returns 403 instead of 500", async () => {
    await using tmp = await tmpdir({ git: true })
    await using outside = await tmpdir()
    const secret = path.join(outside.path, "secret.txt")
    fs.writeFileSync(secret, "outside-the-project")

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const link = path.join(tmp.path, "escape.txt")
        try {
          fs.symlinkSync(secret, link)
        } catch {
          return // platform without symlink permission; skip
        }
        const dir = `directory=${encodeURIComponent(tmp.path)}`
        const response = await Server.Default().request(`/file/content?path=${encodeURIComponent("escape.txt")}&${dir}`)
        expect(response.status).toBe(403)
        const body = (await response.json()) as { name: string }
        expect(body.name).toBe("ForbiddenError")
      },
    })
  })
})
