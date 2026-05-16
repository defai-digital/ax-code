import { describe, expect, test } from "bun:test"
import fs from "fs/promises"
import path from "path"
import type { Tool } from "../../src/tool/tool"
import { Instance } from "../../src/project/instance"
import { assertExternalDirectory, assertSymlinkInsideProject } from "../../src/tool/external-directory"
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
