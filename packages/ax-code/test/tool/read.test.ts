import { afterEach, describe, expect, test, vi } from "vitest"
import { mkdir, symlink, writeFile, readFile, rm } from "fs/promises"
import path from "path"
import { setTimeout as sleep } from "node:timers/promises"
import { ReadTool } from "../../src/tool/read"
import { LSP } from "@ax-code/ax-code-intel"
import { Instance } from "../../src/project/instance"
import { Filesystem } from "../../src/util/filesystem"
import { tmpdir } from "../fixture/fixture"
import { Permission } from "../../src/permission"
import { Agent } from "../../src/agent/agent"
import { SessionID, MessageID } from "../../src/session/schema"
import { Log } from "../../src/util/log"

const FIXTURES_DIR = path.join(import.meta.dirname, "fixtures")
const LSP_FILE = path.join(import.meta.dirname, "..", "fixture", "lsp", "fake-lsp-server.js")
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

afterEach(async () => {
  await Instance.disposeAll()
  vi.unstubAllEnvs()
})

const ctx = {
  sessionID: SessionID.make("ses_test"),
  messageID: MessageID.make(""),
  callID: "",
  agent: "build",
  abort: AbortSignal.any([]),
  messages: [],
  metadata: () => {},
  ask: async () => {},
}

describe("tool.read external_directory permission", () => {
  test("allows reading absolute path inside project directory", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        await writeFile(path.join(dir, "test.txt"), "hello world")
      },
    })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const read = await ReadTool.init()
        const result = await read.execute({ filePath: path.join(tmp.path, "test.txt") }, ctx)
        expect(result.output).toContain("hello world")
      },
    })
  })

  test("allows reading file in subdirectory inside project directory", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        await mkdir(path.join(dir, "subdir"), { recursive: true })
        await writeFile(path.join(dir, "subdir", "test.txt"), "nested content")
      },
    })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const read = await ReadTool.init()
        const result = await read.execute({ filePath: path.join(tmp.path, "subdir", "test.txt") }, ctx)
        expect(result.output).toContain("nested content")
      },
    })
  })

  test("rejects worktree symlink escapes outside the current directory", async () => {
    await using outerTmp = await tmpdir({
      init: async (dir) => {
        await writeFile(path.join(dir, "secret.txt"), "secret data")
      },
    })
    await using tmp = await tmpdir({ git: true })
    const subdir = path.join(tmp.path, "packages", "app")
    await mkdir(subdir, { recursive: true })
    const link = path.join(tmp.path, "linked-secret.txt")
    await symlink(path.join(outerTmp.path, "secret.txt"), link)

    await Instance.provide({
      directory: subdir,
      fn: async () => {
        const read = await ReadTool.init()
        expect(Instance.worktree).toBe(tmp.path)
        await expect(read.execute({ filePath: link }, ctx)).rejects.toMatchObject({
          name: "ReadSymlinkEscapeError",
        })
      },
    })
  })

  test("rejects a directory replaced with an escaping symlink during approval", async () => {
    await using outerTmp = await tmpdir({
      init: async (dir) => {
        await mkdir(path.join(dir, "nested"))
        await writeFile(path.join(dir, "nested", "secret.txt"), "secret data")
      },
    })
    await using tmp = await tmpdir({ git: true })
    const directory = path.join(tmp.path, "docs")
    await mkdir(directory)
    await writeFile(path.join(directory, "inside.txt"), "inside")

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const read = await ReadTool.init()
        const swapping = {
          ...ctx,
          ask: async () => {
            await rm(directory, { recursive: true, force: true })
            await symlink(outerTmp.path, directory)
          },
        }
        await expect(read.execute({ filePath: directory }, swapping)).rejects.toMatchObject({
          name: "ReadSymlinkEscapeError",
        })
      },
    })
  })

  test("rejects an image replaced with an escaping symlink during approval", async () => {
    await using outerTmp = await tmpdir({
      init: async (dir) => {
        await writeFile(path.join(dir, "secret.png"), Buffer.concat([PNG_SIGNATURE, Buffer.from("secret")]))
      },
    })
    await using tmp = await tmpdir({ git: true })
    const image = path.join(tmp.path, "photo.png")
    await writeFile(image, Buffer.concat([PNG_SIGNATURE, Buffer.from("inside")]))

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const read = await ReadTool.init()
        const swapping = {
          ...ctx,
          ask: async () => {
            await rm(image, { force: true })
            await symlink(path.join(outerTmp.path, "secret.png"), image)
          },
        }
        await expect(read.execute({ filePath: image }, swapping)).rejects.toMatchObject({
          name: "ReadSymlinkEscapeError",
        })
      },
    })
  })

  test("asks for external_directory permission when reading absolute path outside project", async () => {
    await using outerTmp = await tmpdir({
      init: async (dir) => {
        await writeFile(path.join(dir, "secret.txt"), "secret data")
      },
    })
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const read = await ReadTool.init()
        const requests: Array<Omit<Permission.Request, "id" | "sessionID" | "tool">> = []
        const testCtx = {
          ...ctx,
          ask: async (req: Omit<Permission.Request, "id" | "sessionID" | "tool">) => {
            requests.push(req)
          },
        }
        await read.execute({ filePath: path.join(outerTmp.path, "secret.txt") }, testCtx)
        const extDirReq = requests.find((r) => r.permission === "external_directory")
        expect(extDirReq).toBeDefined()
        expect(extDirReq!.patterns.some((p) => p.includes(outerTmp.path.replaceAll("\\", "/")))).toBe(true)
      },
    })
  })

  test("asks for directory-scoped external_directory permission when reading external directory", async () => {
    await using outerTmp = await tmpdir({
      init: async (dir) => {
        await mkdir(path.join(dir, "external"), { recursive: true })
        await writeFile(path.join(dir, "external", "a.txt"), "a")
      },
    })
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const read = await ReadTool.init()
        const requests: Array<Omit<Permission.Request, "id" | "sessionID" | "tool">> = []
        const testCtx = {
          ...ctx,
          ask: async (req: Omit<Permission.Request, "id" | "sessionID" | "tool">) => {
            requests.push(req)
          },
        }
        await read.execute({ filePath: path.join(outerTmp.path, "external") }, testCtx)
        const extDirReq = requests.find((r) => r.permission === "external_directory")
        expect(extDirReq).toBeDefined()
        expect(extDirReq!.patterns).toContain(path.join(outerTmp.path, "external", "*").replaceAll("\\", "/"))
      },
    })
  })

  test("asks for external_directory permission when reading relative path outside project", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const read = await ReadTool.init()
        const requests: Array<Omit<Permission.Request, "id" | "sessionID" | "tool">> = []
        const testCtx = {
          ...ctx,
          ask: async (req: Omit<Permission.Request, "id" | "sessionID" | "tool">) => {
            requests.push(req)
          },
        }
        // This will fail because file doesn't exist, but we can check if permission was asked
        await read.execute({ filePath: "../outside.txt" }, testCtx).catch(() => {})
        const extDirReq = requests.find((r) => r.permission === "external_directory")
        expect(extDirReq).toBeDefined()
      },
    })
  })

  test("does not ask for external_directory permission when reading inside project", async () => {
    await using tmp = await tmpdir({
      git: true,
      init: async (dir) => {
        await writeFile(path.join(dir, "internal.txt"), "internal content")
      },
    })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const read = await ReadTool.init()
        const requests: Array<Omit<Permission.Request, "id" | "sessionID" | "tool">> = []
        const testCtx = {
          ...ctx,
          ask: async (req: Omit<Permission.Request, "id" | "sessionID" | "tool">) => {
            requests.push(req)
          },
        }
        await read.execute({ filePath: path.join(tmp.path, "internal.txt") }, testCtx)
        const extDirReq = requests.find((r) => r.permission === "external_directory")
        expect(extDirReq).toBeUndefined()
      },
    })
  })
})

describe("tool.read env file permissions", () => {
  const cases: [string, boolean][] = [
    [".env", true],
    [".env.local", true],
    [".env.production", true],
    [".env.development.local", true],
    [".env.example", false],
    [".envrc", false],
    ["environment.ts", false],
  ]

  describe.each(["build", "plan"])("agent=%s", (agentName) => {
    test.each(cases)("%s asks=%s", async (filename, shouldAsk) => {
      await using tmp = await tmpdir({
        init: (dir) => writeFile(path.join(dir, filename), "content"),
      })
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const agent = await Agent.get(agentName)
          let askedForEnv = false
          const ctxWithPermissions = {
            ...ctx,
            ask: async (req: Omit<Permission.Request, "id" | "sessionID" | "tool">) => {
              for (const pattern of req.patterns) {
                const rule = Permission.evaluate(req.permission, pattern, agent.permission)
                if (rule.action === "ask" && req.permission === "read") {
                  askedForEnv = true
                }
                if (rule.action === "deny") {
                  throw new Permission.DeniedError({ ruleset: agent.permission })
                }
              }
            },
          }
          const read = await ReadTool.init()
          await read.execute({ filePath: path.join(tmp.path, filename) }, ctxWithPermissions)
          expect(askedForEnv).toBe(shouldAsk)
        },
      })
    })
  })
})

describe("tool.read observability", () => {
  test("logs named read failures with filepath and error message", async () => {
    await using tmp = await tmpdir({ git: true })
    await Log.init({ print: false, dir: tmp.path, name: "read-tool-observability" })

    try {
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const read = await ReadTool.init()
          const missing = path.join(tmp.path, "missing.ts")

          await expect(read.execute({ filePath: missing }, ctx)).rejects.toThrow(`File not found: ${missing}`)
        },
      })

      const logPath = path.join(tmp.path, "read-tool-observability.log")
      let rawLog = ""
      for (let attempt = 0; attempt < 20; attempt++) {
        await sleep(10)
        rawLog = await readFile(logPath, "utf-8")
        if (rawLog.includes("service=tool.read") && rawLog.includes("service=tool toolName=read")) {
          break
        }
      }

      const missing = path.join(tmp.path, "missing.ts")
      expect(rawLog).toContain("service=tool.read")
      expect(rawLog).toContain("service=tool toolName=read")
      expect(rawLog).toContain("errorCode=ReadFileNotFoundError")
      expect(rawLog).toContain(`errorMessage=File not found: ${missing}`)
    } finally {
      await Log.init({ print: false })
    }
  })
})

describe("tool.read truncation", () => {
  test("truncates large file by bytes and sets truncated metadata", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        // Create a file with few lines but large total size to trigger byte truncation
        // Each line is ~1KB, 100 lines = ~100KB total (well above MAX_BYTES=50KB, well below MAX_LINES=2000)
        const longLine = "x".repeat(1024)
        const content = Array.from({ length: 100 }, () => longLine).join("\n")
        await Filesystem.write(path.join(dir, "large.json"), content)
      },
    })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const read = await ReadTool.init()
        const result = await read.execute({ filePath: path.join(tmp.path, "large.json") }, ctx)
        expect(result.metadata.truncated).toBe(true)
        expect(result.output).toContain("Output capped at")
        expect(result.output).toContain("Use offset=")
      },
    })
  })

  test("truncates by line count when limit is specified", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        const lines = Array.from({ length: 100 }, (_, i) => `line${i}`).join("\n")
        await writeFile(path.join(dir, "many-lines.txt"), lines)
      },
    })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const read = await ReadTool.init()
        const result = await read.execute({ filePath: path.join(tmp.path, "many-lines.txt"), limit: 10 }, ctx)
        expect(result.metadata.truncated).toBe(true)
        expect(result.output).toContain("Showing lines 1-10. More lines remain; total not counted.")
        expect(result.output).toContain("Use offset=11")
        expect(result.output).toContain("line0")
        expect(result.output).toContain("line9")
        expect(result.output).not.toContain("line10")
      },
    })
  })

  test("does not truncate small file", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        await writeFile(path.join(dir, "small.txt"), "hello world")
      },
    })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const read = await ReadTool.init()
        const result = await read.execute({ filePath: path.join(tmp.path, "small.txt") }, ctx)
        expect(result.metadata.truncated).toBe(false)
        expect(result.output).toContain("End of file")
      },
    })
  })

  test("respects offset parameter", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        const lines = Array.from({ length: 20 }, (_, i) => `line${i + 1}`).join("\n")
        await writeFile(path.join(dir, "offset.txt"), lines)
      },
    })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const read = await ReadTool.init()
        const result = await read.execute({ filePath: path.join(tmp.path, "offset.txt"), offset: 10, limit: 5 }, ctx)
        expect(result.output).toContain("10: line10")
        expect(result.output).toContain("14: line14")
        expect(result.output).not.toContain("9: line10")
        expect(result.output).not.toContain("15: line15")
        expect(result.output).toContain("line10")
        expect(result.output).toContain("line14")
        expect(result.output).not.toContain("line0")
        expect(result.output).not.toContain("line15")
      },
    })
  })

  test("throws when offset is beyond end of file", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        const lines = Array.from({ length: 3 }, (_, i) => `line${i + 1}`).join("\n")
        await writeFile(path.join(dir, "short.txt"), lines)
      },
    })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const read = await ReadTool.init()
        await expect(
          read.execute({ filePath: path.join(tmp.path, "short.txt"), offset: 4, limit: 5 }, ctx),
        ).rejects.toThrow("Offset 4 is out of range for this file (3 lines)")
      },
    })
  })

  test("does not report byte-capped reads as offset-out-of-range", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        await writeFile(path.join(dir, "bytes.txt"), ("x".repeat(1900) + "\n").repeat(100))
      },
    })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const read = await ReadTool.init()
        const result = await read.execute({ filePath: path.join(tmp.path, "bytes.txt"), offset: 2 }, ctx)
        expect(result.metadata.truncated).toBe(true)
        expect(result.output).toContain("Output capped")
      },
    })
  })

  test("strips a UTF-8 BOM from the first line", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        await writeFile(path.join(dir, "bom.txt"), "\uFEFFfirst line\nsecond line\n")
      },
    })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const read = await ReadTool.init()
        const result = await read.execute({ filePath: path.join(tmp.path, "bom.txt") }, ctx)
        expect(result.output).toContain("1: first line")
        expect(result.output).not.toContain("\uFEFF")
      },
    })
  })

  test("rejects non-integer offsets", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        await writeFile(path.join(dir, "offset.txt"), "line1\nline2\n")
      },
    })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const read = await ReadTool.init()
        await expect(read.execute({ filePath: path.join(tmp.path, "offset.txt"), offset: 1.5 }, ctx)).rejects.toThrow()
      },
    })
  })

  test("rejects non-decimal numeric strings", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        await writeFile(path.join(dir, "numbers.txt"), "line1\nline2\n")
      },
    })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const read = await ReadTool.init()
        const filePath = path.join(tmp.path, "numbers.txt")

        for (const input of [{ offset: "1e3" }, { offset: "0x10" }, { limit: "1e3" }, { limit: "0x10" }]) {
          await expect(read.execute({ filePath, ...input } as any, ctx)).rejects.toThrow("invalid arguments")
        }
      },
    })
  })

  test("rejects non-positive and non-integer limits", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        await writeFile(path.join(dir, "limit.txt"), "line1\nline2\n")
      },
    })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const read = await ReadTool.init()
        const filePath = path.join(tmp.path, "limit.txt")

        for (const limit of [0, -1, 1.5]) {
          await expect(read.execute({ filePath, limit }, ctx)).rejects.toThrow("invalid arguments")
        }
      },
    })
  })

  test("allows reading empty file at default offset", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        await writeFile(path.join(dir, "empty.txt"), "")
      },
    })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const read = await ReadTool.init()
        const result = await read.execute({ filePath: path.join(tmp.path, "empty.txt") }, ctx)
        expect(result.metadata.truncated).toBe(false)
        expect(result.output).toContain("End of file - total 0 lines")
      },
    })
  })

  test("throws when offset > 1 for empty file", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        await writeFile(path.join(dir, "empty.txt"), "")
      },
    })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const read = await ReadTool.init()
        await expect(read.execute({ filePath: path.join(tmp.path, "empty.txt"), offset: 2 }, ctx)).rejects.toThrow(
          "Offset 2 is out of range for this file (0 lines)",
        )
      },
    })
  })

  test("does not mark final directory page as truncated", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        await mkdir(path.join(dir, "dir"), { recursive: true })
        await Promise.all(
          Array.from({ length: 10 }, (_, i) => writeFile(path.join(dir, "dir", `file-${i + 1}.txt`), `line${i}`)),
        )
      },
    })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const read = await ReadTool.init()
        const result = await read.execute({ filePath: path.join(tmp.path, "dir"), offset: 6, limit: 5 }, ctx)
        expect(result.metadata.truncated).toBe(false)
        expect(result.output).not.toContain("Showing 5 of 10 entries")
      },
    })
  })

  test("truncates long lines", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        const longLine = "x".repeat(3000)
        await writeFile(path.join(dir, "long-line.txt"), longLine)
      },
    })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const read = await ReadTool.init()
        const result = await read.execute({ filePath: path.join(tmp.path, "long-line.txt") }, ctx)
        expect(result.output).toContain("(line truncated to 2000 chars)")
        expect(result.output.length).toBeLessThan(3000)
      },
    })
  })

  test("does not split a Unicode surrogate pair when truncating a long line", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        const longLine = "x".repeat(1999) + "\u{1F680}" + "tail"
        await writeFile(path.join(dir, "unicode-long-line.txt"), longLine)
      },
    })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const read = await ReadTool.init()
        const result = await read.execute({ filePath: path.join(tmp.path, "unicode-long-line.txt") }, ctx)
        expect(result.output.isWellFormed()).toBe(true)
        expect(result.metadata.preview.isWellFormed()).toBe(true)
        expect(result.output).toContain("(line truncated to 2000 chars)")
      },
    })
  })

  test("image files set truncated to false", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        // 1x1 red PNG
        const png = Buffer.from(
          "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==",
          "base64",
        )
        await writeFile(path.join(dir, "image.png"), png)
      },
    })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const read = await ReadTool.init()
        const result = await read.execute({ filePath: path.join(tmp.path, "image.png") }, ctx)
        expect(result.metadata.truncated).toBe(false)
        expect(result.attachments).toBeDefined()
        expect(result.attachments?.length).toBe(1)
        expect(result.attachments?.[0]).not.toHaveProperty("id")
        expect(result.attachments?.[0]).not.toHaveProperty("sessionID")
        expect(result.attachments?.[0]).not.toHaveProperty("messageID")
      },
    })
  })

  test("rejects bitmap images instead of returning an attachment", async () => {
    await using tmp = await tmpdir({
      config: { username: "test" },
      init: async (dir) => {
        // BMP signature ("BM") followed by NUL bytes.
        const bmp = Buffer.from([0x42, 0x4d, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00])
        await writeFile(path.join(dir, "bitmap.bmp"), bmp)
      },
    })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const read = await ReadTool.init()
        await expect(read.execute({ filePath: path.join(tmp.path, "bitmap.bmp") }, ctx)).rejects.toThrow(
          "Cannot read binary file",
        )
      },
    })
  })

  test("large image files are properly attached without error", async () => {
    await Instance.provide({
      directory: FIXTURES_DIR,
      fn: async () => {
        const read = await ReadTool.init()
        const result = await read.execute({ filePath: path.join(FIXTURES_DIR, "large-image.png") }, ctx)
        expect(result.metadata.truncated).toBe(false)
        expect(result.attachments).toBeDefined()
        expect(result.attachments?.length).toBe(1)
        expect(result.attachments?.[0].type).toBe("file")
        expect(result.attachments?.[0]).not.toHaveProperty("id")
        expect(result.attachments?.[0]).not.toHaveProperty("sessionID")
        expect(result.attachments?.[0]).not.toHaveProperty("messageID")
      },
    })
  })

  test(".fbs files (FlatBuffers schema) are read as text, not images", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        // FlatBuffers schema content
        const fbsContent = `namespace MyGame;

table Monster {
  pos:Vec3;
  name:string;
  inventory:[ubyte];
}

root_type Monster;`
        await writeFile(path.join(dir, "schema.fbs"), fbsContent)
      },
    })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const read = await ReadTool.init()
        const result = await read.execute({ filePath: path.join(tmp.path, "schema.fbs") }, ctx)
        // Should be read as text, not as image
        expect(result.attachments).toBeUndefined()
        expect(result.output).toContain("namespace MyGame")
        expect(result.output).toContain("table Monster")
      },
    })
  })
})

describe("tool.read line splitting", () => {
  test("keeps a lone carriage return inside the line and does not add a line number", async () => {
    await using tmp = await tmpdir({
      config: { username: "test" },
      init: async (dir) => {
        await writeFile(path.join(dir, "cr.txt"), "const s = 'a\rb'\nline2\nline3\n")
      },
    })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const read = await ReadTool.init()
        const result = await read.execute({ filePath: path.join(tmp.path, "cr.txt") }, ctx)
        // Ripgrep and the edit tool split on "\n" only, so the reader must not
        // invent a fourth line for the lone "\r".
        expect(result.output).toContain("1: const s = 'a\rb'")
        expect(result.output).toContain("2: line2")
        expect(result.output).toContain("3: line3")
        expect(result.output).not.toContain("4: ")
        expect(result.output).toContain("End of file - total 3 lines")
      },
    })
  })

  test("renders CRLF files exactly as before", async () => {
    await using tmp = await tmpdir({
      config: { username: "test" },
      init: async (dir) => {
        await writeFile(path.join(dir, "crlf.txt"), "line1\r\nline2\r\nline3\r\n")
      },
    })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const read = await ReadTool.init()
        const result = await read.execute({ filePath: path.join(tmp.path, "crlf.txt") }, ctx)
        expect(result.output).toContain("1: line1")
        expect(result.output).toContain("2: line2")
        expect(result.output).toContain("3: line3")
        expect(result.output).not.toContain("\r")
        expect(result.output).toContain("End of file - total 3 lines")
      },
    })
  })

  test("strips a trailing lone carriage return on the final line", async () => {
    await using tmp = await tmpdir({
      config: { username: "test" },
      init: async (dir) => {
        await writeFile(path.join(dir, "trailing-cr.txt"), "line1\r")
      },
    })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const read = await ReadTool.init()
        const result = await read.execute({ filePath: path.join(tmp.path, "trailing-cr.txt") }, ctx)
        // A trailing "\r" is the carriage half of a CRLF terminator, so it is
        // stripped — the same rendering the reader produced before.
        expect(result.output).toContain("1: line1")
        expect(result.output).not.toContain("\r")
        expect(result.output).toContain("End of file - total 1 lines")
      },
    })
  })

  test("keeps a lone carriage return inside the final line", async () => {
    await using tmp = await tmpdir({
      config: { username: "test" },
      init: async (dir) => {
        await writeFile(path.join(dir, "final-line-cr.txt"), "a\rb")
      },
    })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const read = await ReadTool.init()
        const result = await read.execute({ filePath: path.join(tmp.path, "final-line-cr.txt") }, ctx)
        expect(result.output).toContain("1: a\rb")
        expect(result.output).toContain("End of file - total 1 lines")
      },
    })
  })

  test("keeps line numbers aligned with offset when a carriage return is present", async () => {
    await using tmp = await tmpdir({
      config: { username: "test" },
      init: async (dir) => {
        await writeFile(path.join(dir, "cr-offset.txt"), "const s = 'a\rb'\nline2\nline3\n")
      },
    })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const read = await ReadTool.init()
        const result = await read.execute({ filePath: path.join(tmp.path, "cr-offset.txt"), offset: 2 }, ctx)
        expect(result.output).toContain("2: line2")
        expect(result.output).toContain("3: line3")
        expect(result.output).not.toContain("1: ")
      },
    })
  })
})

describe("tool.read lsp", () => {
  test.each(["normal", "low"])("semantic queries still start a real server on demand in %s mode", async (profile) => {
    vi.stubEnv("AX_CODE_MEMORY_PROFILE", profile)
    vi.stubEnv("AX_CODE_LSP_PREWARM", undefined)
    vi.stubEnv("AX_CODE_TRUST_PROJECT_CONFIG", "1")
    const range = { start: { line: 0, character: 0 }, end: { line: 0, character: 5 } }
    const item = { name: "main", kind: 12, uri: "file:///workspace/test.txt", range, selectionRange: range }
    await using tmp = await tmpdir({
      config: {
        lsp: {
          fake: {
            command: [process.execPath, LSP_FILE],
            extensions: [".txt"],
            env: {
              FAKE_LSP_CAPABILITIES_JSON: JSON.stringify({ callHierarchyProvider: true }),
              FAKE_LSP_PREPARE_CALL_HIERARCHY: JSON.stringify([item]),
            },
          },
        },
      },
      init: async (dir) => {
        await writeFile(path.join(dir, "test.txt"), "main()")
      },
    })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const file = path.join(tmp.path, "test.txt")
        const read = await ReadTool.init()
        expect((await read.execute({ filePath: file }, ctx)).output).toContain("main()")
        await sleep(20)
        expect(await LSP.status()).toEqual([])
        const result = await LSP.prepareCallHierarchy({ file, line: 0, character: 0 })
        expect(result).toEqual([item])
        expect(await LSP.status()).toContainEqual(expect.objectContaining({ id: "fake", status: "connected" }))
      },
    })
  })

  test.each([
    ["normal", undefined],
    ["low", undefined],
    ["low", "1"],
  ])("plain reads skip speculative LSP in %s mode with prewarm=%s", async (profile, prewarm) => {
    vi.stubEnv("AX_CODE_MEMORY_PROFILE", profile)
    vi.stubEnv("AX_CODE_LSP_PREWARM", prewarm)
    await using tmp = await tmpdir({
      init: async (dir) => {
        await writeFile(path.join(dir, "test.ts"), "export const value = 1")
      },
    })
    const hasClients = vi.spyOn(LSP, "hasClients").mockResolvedValue(true)
    const touch = vi.spyOn(LSP, "touchFile").mockResolvedValue(1)
    try {
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const read = await ReadTool.init()
          expect((await read.execute({ filePath: path.join(tmp.path, "test.ts") }, ctx)).output).toContain("value = 1")
          await sleep(20)
          expect(hasClients).not.toHaveBeenCalled()
          expect(touch).not.toHaveBeenCalled()
        },
      })
    } finally {
      hasClients.mockRestore()
      touch.mockRestore()
    }
  })

  test("activates lsp while reading a file", async () => {
    vi.stubEnv("AX_CODE_MEMORY_PROFILE", "normal")
    vi.stubEnv("AX_CODE_LSP_PREWARM", "1")
    // The fixture deliberately launches a project-provided LSP process, which
    // requires the same explicit checkout trust as it does in production.
    vi.stubEnv("AX_CODE_TRUST_PROJECT_CONFIG", "1")

    await using tmp = await tmpdir({
      config: {
        lsp: {
          fake: {
            command: [process.execPath, LSP_FILE],
            extensions: [".txt"],
          },
        },
      },
      init: async (dir) => {
        await writeFile(path.join(dir, "test.txt"), "hello world")
      },
    })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const read = await ReadTool.init()
        await read.execute({ filePath: path.join(tmp.path, "test.txt") }, ctx)
        for (let i = 0; i < 20; i++) {
          const status = await LSP.status()
          if (
            status.some(
              (item) => item.id === "fake" && item.name === "fake" && item.root === "" && item.status === "connected",
            )
          ) {
            return
          }
          await sleep(25)
        }
        expect(await LSP.status()).toContainEqual({
          id: "fake",
          name: "fake",
          root: "",
          status: "connected",
        })
      },
    })
  })

  test("does not wait for opportunistic lsp warmup", async () => {
    vi.stubEnv("AX_CODE_MEMORY_PROFILE", "normal")
    vi.stubEnv("AX_CODE_LSP_PREWARM", "1")
    await using tmp = await tmpdir({
      init: async (dir) => {
        await writeFile(path.join(dir, "test.txt"), "hello world")
      },
    })

    let resolveTouch: ((value: number) => void) | undefined
    const hasClientsSpy = vi.spyOn(LSP, "hasClients").mockResolvedValue(true)
    const touchSpy = vi.spyOn(LSP, "touchFile").mockImplementation(
      () =>
        new Promise<number>((resolve) => {
          resolveTouch = resolve
        }),
    )

    try {
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const read = await ReadTool.init()
          const result = await read.execute({ filePath: path.join(tmp.path, "test.txt") }, ctx)
          expect(result.output).toContain("hello world")
          expect(hasClientsSpy).toHaveBeenCalledTimes(0)
          expect(touchSpy).toHaveBeenCalledTimes(0)
          await sleep(10)
          expect(hasClientsSpy).toHaveBeenCalledWith(path.join(tmp.path, "test.txt"), { mode: "semantic" })
          expect(touchSpy).toHaveBeenCalledTimes(1)
          expect(resolveTouch).toBeDefined()
        },
      })
    } finally {
      resolveTouch?.(1)
      hasClientsSpy.mockRestore()
      touchSpy.mockRestore()
    }
  })

  test("continues when opportunistic lsp warmup fails", async () => {
    vi.stubEnv("AX_CODE_MEMORY_PROFILE", "normal")
    vi.stubEnv("AX_CODE_LSP_PREWARM", "1")
    await using tmp = await tmpdir({
      init: async (dir) => {
        await writeFile(path.join(dir, "test.txt"), "hello world")
      },
    })

    const hasClientsSpy = vi.spyOn(LSP, "hasClients").mockResolvedValue(true)
    const touchSpy = vi.spyOn(LSP, "touchFile").mockRejectedValue(new Error("warmup failed"))

    try {
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const read = await ReadTool.init()
          const result = await read.execute({ filePath: path.join(tmp.path, "test.txt") }, ctx)
          expect(result.output).toContain("hello world")
          await sleep(10)
        },
      })
    } finally {
      hasClientsSpy.mockRestore()
      touchSpy.mockRestore()
    }
  })

  test("skips opportunistic lsp warmup when no semantic server matches", async () => {
    vi.stubEnv("AX_CODE_MEMORY_PROFILE", "normal")
    vi.stubEnv("AX_CODE_LSP_PREWARM", "1")
    await using tmp = await tmpdir({
      init: async (dir) => {
        await writeFile(path.join(dir, "notes.txt"), "hello world")
      },
    })

    const hasClientsSpy = vi.spyOn(LSP, "hasClients").mockResolvedValue(false)
    const touchSpy = vi.spyOn(LSP, "touchFile").mockResolvedValue(0 as never)

    try {
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const read = await ReadTool.init()
          const result = await read.execute({ filePath: path.join(tmp.path, "notes.txt") }, ctx)
          expect(result.output).toContain("hello world")
          await sleep(10)
          expect(hasClientsSpy).toHaveBeenCalledWith(path.join(tmp.path, "notes.txt"), { mode: "semantic" })
          expect(touchSpy).not.toHaveBeenCalled()
        },
      })
    } finally {
      hasClientsSpy.mockRestore()
      touchSpy.mockRestore()
    }
  })

  test("skips deferred lsp warmup after instance disposal", async () => {
    vi.stubEnv("AX_CODE_MEMORY_PROFILE", "normal")
    vi.stubEnv("AX_CODE_LSP_PREWARM", "1")
    await using tmp = await tmpdir({
      init: async (dir) => {
        await writeFile(path.join(dir, "test.txt"), "hello world")
      },
    })

    const hasClientsSpy = vi.spyOn(LSP, "hasClients").mockResolvedValue(true)
    const touchSpy = vi.spyOn(LSP, "touchFile").mockResolvedValue(1 as never)

    try {
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const read = await ReadTool.init()
          const result = await read.execute({ filePath: path.join(tmp.path, "test.txt") }, ctx)
          expect(result.output).toContain("hello world")
        },
      })

      await Instance.disposeAll()
      await sleep(10)

      expect(hasClientsSpy).not.toHaveBeenCalled()
      expect(touchSpy).not.toHaveBeenCalled()
    } finally {
      hasClientsSpy.mockRestore()
      touchSpy.mockRestore()
    }
  })
})

describe("tool.read loaded instructions", () => {
  test("loads AGENTS.md from parent directory and includes in metadata", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        await mkdir(path.join(dir, "subdir"), { recursive: true })
        await mkdir(path.join(dir, "subdir", "nested"), { recursive: true })
        await writeFile(path.join(dir, "subdir", "AGENTS.md"), "# Test Instructions\nDo something special.")
        await writeFile(path.join(dir, "subdir", "nested", "test.txt"), "test content")
      },
    })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const read = await ReadTool.init()
        const result = await read.execute({ filePath: path.join(tmp.path, "subdir", "nested", "test.txt") }, ctx)
        expect(result.output).toContain("test content")
        expect(result.output).toContain("system-reminder")
        expect(result.output).toContain("Test Instructions")
        expect(result.metadata.loaded).toBeDefined()
        expect(result.metadata.loaded).toContain(path.join(tmp.path, "subdir", "AGENTS.md"))
      },
    })
  })
})

describe("tool.read binary detection", () => {
  test("rejects text extension files with null bytes", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        const bytes = Buffer.from([0x68, 0x65, 0x6c, 0x6c, 0x6f, 0x00, 0x77, 0x6f, 0x72, 0x6c, 0x64])
        await writeFile(path.join(dir, "null-byte.txt"), bytes)
      },
    })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const read = await ReadTool.init()
        await expect(read.execute({ filePath: path.join(tmp.path, "null-byte.txt") }, ctx)).rejects.toThrow(
          "Cannot read binary file",
        )
      },
    })
  })

  test("rejects known binary extensions", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        await writeFile(path.join(dir, "module.wasm"), "not really wasm")
      },
    })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const read = await ReadTool.init()
        await expect(read.execute({ filePath: path.join(tmp.path, "module.wasm") }, ctx)).rejects.toThrow(
          "Cannot read binary file",
        )
      },
    })
  })
})
