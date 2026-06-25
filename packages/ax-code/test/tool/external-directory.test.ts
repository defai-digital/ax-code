import { describe, expect, test } from "vitest"
import fs from "fs/promises"
import path from "path"
import type { Tool } from "../../src/tool/tool"
import { Instance } from "../../src/project/instance"
import { assertExternalDirectory, assertSymlinkInsideProject, fileToolGuard } from "../../src/tool/external-directory"
import type { Permission } from "../../src/permission"
import { SessionID, MessageID } from "../../src/session/schema"
import { tmpdir } from "../fixture/fixture"

const baseCtx: Omit<Tool.Context, "ask"> = {
  sessionID: SessionID.make("ses_test"),
  messageID: MessageID.make(""),
  callID: "",
  agent: "build",
  abort: AbortSignal.any([]),
  messages: [],
  metadata: () => {},
}

describe("tool.assertExternalDirectory", () => {
  test("no-ops for empty target", async () => {
    const requests: Array<Omit<Permission.Request, "id" | "sessionID" | "tool">> = []
    const ctx: Tool.Context = {
      ...baseCtx,
      ask: async (req) => {
        requests.push(req)
      },
    }

    await Instance.provide({
      directory: "/tmp",
      fn: async () => {
        await assertExternalDirectory(ctx)
      },
    })

    expect(requests.length).toBe(0)
  })

  test("no-ops for paths inside Instance.directory", async () => {
    const requests: Array<Omit<Permission.Request, "id" | "sessionID" | "tool">> = []
    const ctx: Tool.Context = {
      ...baseCtx,
      ask: async (req) => {
        requests.push(req)
      },
    }

    await Instance.provide({
      directory: "/tmp/project",
      fn: async () => {
        await assertExternalDirectory(ctx, path.join("/tmp/project", "file.txt"))
      },
    })

    expect(requests.length).toBe(0)
  })

  test("asks with a single canonical glob", async () => {
    const requests: Array<Omit<Permission.Request, "id" | "sessionID" | "tool">> = []
    const ctx: Tool.Context = {
      ...baseCtx,
      ask: async (req) => {
        requests.push(req)
      },
    }

    const directory = "/tmp/project"
    const target = "/tmp/outside/file.txt"
    const expected = path.join(path.dirname(target), "*").replaceAll("\\", "/")

    await Instance.provide({
      directory,
      fn: async () => {
        await assertExternalDirectory(ctx, target)
      },
    })

    const req = requests.find((r) => r.permission === "external_directory")
    expect(req).toBeDefined()
    expect(req!.patterns).toEqual([expected])
    expect(req!.always).toEqual([expected])
  })

  test("uses target directory when kind=directory", async () => {
    const requests: Array<Omit<Permission.Request, "id" | "sessionID" | "tool">> = []
    const ctx: Tool.Context = {
      ...baseCtx,
      ask: async (req) => {
        requests.push(req)
      },
    }

    const directory = "/tmp/project"
    const target = "/tmp/outside"
    const expected = path.join(target, "*").replaceAll("\\", "/")

    await Instance.provide({
      directory,
      fn: async () => {
        await assertExternalDirectory(ctx, target, { kind: "directory" })
      },
    })

    const req = requests.find((r) => r.permission === "external_directory")
    expect(req).toBeDefined()
    expect(req!.patterns).toEqual([expected])
    expect(req!.always).toEqual([expected])
  })

  test.skipIf(process.platform === "win32")(
    "asks with canonical glob when external file path uses a symlinked parent",
    async () => {
      await using project = await tmpdir()
      await using outside = await tmpdir()
      await using aliasRoot = await tmpdir()
      const realDir = path.join(outside.path, "real")
      const linkDir = path.join(aliasRoot.path, "link")
      await fs.mkdir(realDir)
      await fs.symlink(realDir, linkDir)

      const requests: Array<Omit<Permission.Request, "id" | "sessionID" | "tool">> = []
      const ctx: Tool.Context = {
        ...baseCtx,
        ask: async (req) => {
          requests.push(req)
        },
      }

      await Instance.provide({
        directory: project.path,
        fn: async () => {
          await assertExternalDirectory(ctx, path.join(linkDir, "file.txt"))
        },
      })

      const expected = path.join(realDir, "*").replaceAll("\\", "/")
      const req = requests.find((r) => r.permission === "external_directory")
      expect(req).toBeDefined()
      expect(req!.patterns).toEqual([expected])
      expect(req!.always).toEqual([expected])
      expect(req!.metadata.parentDir).toBe(realDir)
      expect(req!.metadata.filepath).toBe(path.join(realDir, "file.txt"))
    },
  )

  test.skipIf(process.platform === "win32")("asks with canonical glob when external file is a symlink", async () => {
    await using project = await tmpdir()
    await using outside = await tmpdir()
    await using aliasRoot = await tmpdir()
    const realFile = path.join(outside.path, "secret.txt")
    const linkFile = path.join(aliasRoot.path, "secret-link.txt")
    await fs.writeFile(realFile, "secret")
    await fs.symlink(realFile, linkFile)

    const requests: Array<Omit<Permission.Request, "id" | "sessionID" | "tool">> = []
    const ctx: Tool.Context = {
      ...baseCtx,
      ask: async (req) => {
        requests.push(req)
      },
    }

    await Instance.provide({
      directory: project.path,
      fn: async () => {
        await assertExternalDirectory(ctx, linkFile)
      },
    })

    const expected = path.join(outside.path, "*").replaceAll("\\", "/")
    const req = requests.find((r) => r.permission === "external_directory")
    expect(req).toBeDefined()
    expect(req!.patterns).toEqual([expected])
    expect(req!.always).toEqual([expected])
    expect(req!.metadata.parentDir).toBe(outside.path)
    expect(req!.metadata.filepath).toBe(realFile)
  })

  test("skips prompting when bypass=true", async () => {
    const requests: Array<Omit<Permission.Request, "id" | "sessionID" | "tool">> = []
    const ctx: Tool.Context = {
      ...baseCtx,
      ask: async (req) => {
        requests.push(req)
      },
    }

    await Instance.provide({
      directory: "/tmp/project",
      fn: async () => {
        await assertExternalDirectory(ctx, "/tmp/outside/file.txt", { bypass: true })
      },
    })

    expect(requests.length).toBe(0)
  })
})

describe("tool.assertSymlinkInsideProject", () => {
  test("allows the project root itself", async () => {
    await using project = await tmpdir()

    await Instance.provide({
      directory: project.path,
      fn: async () => {
        await expect(assertSymlinkInsideProject(project.path)).resolves.toBeUndefined()
      },
    })
  })

  test("allows missing nested paths under normal project directories", async () => {
    await using project = await tmpdir()

    await Instance.provide({
      directory: project.path,
      fn: async () => {
        await expect(assertSymlinkInsideProject(path.join(project.path, "new", "file.txt"))).resolves.toBeUndefined()
      },
    })
  })

  test("allows missing nested paths when a parent path component is a file", async () => {
    await using project = await tmpdir()
    await fs.writeFile(path.join(project.path, "parent.txt"), "content")

    await Instance.provide({
      directory: project.path,
      fn: async () => {
        await expect(
          assertSymlinkInsideProject(path.join(project.path, "parent.txt", "child", "file.txt")),
        ).resolves.toBeUndefined()
      },
    })
  })

  test("rejects missing paths under symlinked ancestor directories that escape the project", async () => {
    await using project = await tmpdir()
    await using outside = await tmpdir()
    await fs.symlink(outside.path, path.join(project.path, "escape"))

    await Instance.provide({
      directory: project.path,
      fn: async () => {
        await expect(assertSymlinkInsideProject(path.join(project.path, "escape", "new.txt"))).rejects.toThrow(
          "parent directory escapes project directory",
        )
      },
    })
  })

  test("rejects existing paths under symlinked ancestor directories that escape the project", async () => {
    await using project = await tmpdir()
    await using outside = await tmpdir()
    await fs.writeFile(path.join(outside.path, "secret.txt"), "secret")
    await fs.symlink(outside.path, path.join(project.path, "escape"))

    await Instance.provide({
      directory: project.path,
      fn: async () => {
        await expect(assertSymlinkInsideProject(path.join(project.path, "escape", "secret.txt"))).rejects.toThrow(
          "parent directory escapes project directory",
        )
      },
    })
  })

  test("rejects dangling symlink targets inside the project", async () => {
    await using project = await tmpdir()
    await fs.symlink(path.join(project.path, "missing"), path.join(project.path, "dangling"))

    await Instance.provide({
      directory: project.path,
      fn: async () => {
        await expect(assertSymlinkInsideProject(path.join(project.path, "dangling"))).rejects.toThrow(
          "symlink target is dangling or inaccessible",
        )
      },
    })
  })

  test.skipIf(process.platform === "win32")("allows symlink pointing within the project", async () => {
    await using project = await tmpdir()
    await fs.writeFile(path.join(project.path, "real.txt"), "data")
    await fs.symlink(path.join(project.path, "real.txt"), path.join(project.path, "link.txt"))

    await Instance.provide({
      directory: project.path,
      fn: async () => {
        await expect(assertSymlinkInsideProject(path.join(project.path, "link.txt"))).resolves.toBeUndefined()
      },
    })
  })

  test("rejects symlinks that escape the worktree outside the current directory", async () => {
    await using project = await tmpdir({ git: true })
    await using outside = await tmpdir()
    const subdir = path.join(project.path, "packages", "app")
    await fs.mkdir(subdir, { recursive: true })
    await fs.writeFile(path.join(outside.path, "secret.txt"), "secret")
    const link = path.join(project.path, "linked-secret.txt")
    await fs.symlink(path.join(outside.path, "secret.txt"), link)

    await Instance.provide({
      directory: subdir,
      fn: async () => {
        expect(Instance.worktree).toBe(project.path)
        await expect(assertSymlinkInsideProject(link)).rejects.toThrow("symlink target escapes project directory")
      },
    })
  })

  test("allows paths that are entirely outside the project without error", async () => {
    await using project = await tmpdir()
    await using outside = await tmpdir()

    await Instance.provide({
      directory: project.path,
      fn: async () => {
        await expect(assertSymlinkInsideProject(path.join(outside.path, "file.txt"))).resolves.toBeUndefined()
      },
    })
  })
})

describe("tool.fileToolGuard", () => {
  test("resolves relative path and runs both guards", async () => {
    await using project = await tmpdir()
    const requests: string[] = []
    const ctx: Tool.Context = {
      ...baseCtx,
      ask: async (req) => {
        requests.push(req.permission)
      },
    }

    await Instance.provide({
      directory: project.path,
      fn: async () => {
        const result = await fileToolGuard(ctx, "subdir/file.txt")
        expect(result).toBe(path.resolve(project.path, "subdir/file.txt"))
      },
    })
  })

  test("returns resolved absolute path for absolute input", async () => {
    await using project = await tmpdir()
    const ctx: Tool.Context = {
      ...baseCtx,
      ask: async () => {},
    }

    await Instance.provide({
      directory: project.path,
      fn: async () => {
        const absPath = path.join(project.path, "file.txt")
        const result = await fileToolGuard(ctx, absPath)
        expect(result).toBe(absPath)
      },
    })
  })

  test("passes options through to assertExternalDirectory", async () => {
    await using project = await tmpdir()
    const requests: Array<{ permission: string; patterns: string[] }> = []
    const ctx: Tool.Context = {
      ...baseCtx,
      ask: async (req) => {
        requests.push({ permission: req.permission, patterns: req.patterns })
      },
    }

    await Instance.provide({
      directory: project.path,
      fn: async () => {
        await fileToolGuard(ctx, project.path, { kind: "directory" })
        // Internal path should not trigger external_directory permission
        expect(requests.filter((r) => r.permission === "external_directory")).toHaveLength(0)
      },
    })
  })
})
