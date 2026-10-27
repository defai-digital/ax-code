import { afterEach, describe, expect, test } from "vitest"
import path from "path"
import { readFile, readdir } from "node:fs/promises"
import {
  SessionBackupProjectCommand,
  SessionClearProjectCommand,
  sessionProjectStatusPayload,
} from "../../src/cli/cmd/storage/session"
import { Instance } from "../../src/project/instance"
import { Session } from "../../src/session"
import { resetDatabase } from "../fixture/db"
import { tmpdir } from "../fixture/fixture"

afterEach(async () => {
  await resetDatabase()
})

describe("session clear-project", () => {
  async function withCwd<T>(cwd: string, fn: () => T | Promise<T>) {
    const previous = process.cwd()
    process.chdir(cwd)
    try {
      return await fn()
    } finally {
      process.chdir(previous)
    }
  }

  test("clears every session of a project, not just the 100 most recent", async () => {
    await using caller = await tmpdir({ git: true })
    await using target = await tmpdir({ git: true })
    await Instance.provide({
      directory: target.path,
      fn: async () => {
        for (let i = 0; i < 105; i++) await Session.create({ title: `s${i}` })
      },
    })
    await withCwd(caller.path, () =>
      SessionClearProjectCommand.handler({
        dir: target.path,
        yes: true,
        backupDir: "backups",
        $0: "ax-code",
        _: ["session", "clear-project"],
      } as never),
    )
    await Instance.provide({
      directory: target.path,
      fn: async () => {
        expect([...Session.list({ limit: Number.MAX_SAFE_INTEGER })]).toEqual([])
      },
    })
    const backup = path.join(caller.path, "backups")
    const entries = (await readdir(backup)).filter((name) => name.endsWith(".json"))
    const archive = JSON.parse(await readFile(path.join(backup, entries[0]!), "utf8"))
    expect(archive.sessions).toHaveLength(105)
  })

  test("--dir backs up and clears only the selected project; relative backup paths use the caller cwd", async () => {
    await using caller = await tmpdir({ git: true })
    await using target = await tmpdir({ git: true })
    const keep = await Instance.provide({ directory: caller.path, fn: () => Session.create({ title: "keep" }) })
    const remove = await Instance.provide({ directory: target.path, fn: () => Session.create({ title: "remove" }) })
    await withCwd(caller.path, async () => {
      await SessionClearProjectCommand.handler({
        dir: target.path,
        yes: true,
        backupDir: "backups",
        $0: "ax-code",
        _: ["session", "clear-project"],
      } as never)
      expect(process.cwd()).toBe(caller.path)
    })
    await Instance.provide({
      directory: caller.path,
      fn: async () => {
        expect([...Session.list()].map((item) => item.id)).toEqual([keep.id])
      },
    })
    await Instance.provide({
      directory: target.path,
      fn: async () => {
        expect([...Session.list()]).toEqual([])
      },
    })
    const backup = path.join(caller.path, "backups")
    const entries = (await readdir(backup)).filter((name) => name.endsWith(".json"))
    expect(entries).toHaveLength(1)
    const archive = JSON.parse(await readFile(path.join(backup, entries[0]!), "utf8"))
    expect(archive.sessions.map((entry: { info: { id: string } }) => entry.info.id)).toEqual([remove.id])
    expect(archive.directory).toBe(target.path)
  })

  test("backs up current project sessions without deleting unless confirmed", async () => {
    await using project = await tmpdir({ git: true })
    await using backup = await tmpdir()
    const session = await Instance.provide({
      directory: project.path,
      fn: async () => Session.create({ title: "keep until confirmed" }),
    })

    await withCwd(project.path, () =>
      SessionClearProjectCommand.handler({
        yes: false,
        backupDir: backup.path,
        $0: "ax-code",
        _: ["session", "clear-project"],
      } as never),
    )

    await Instance.provide({
      directory: project.path,
      fn: async () => {
        expect([...Session.list()].map((item) => item.id)).toContain(session.id)
      },
    })

    const allFiles = await readdir(backup.path)
    const entries = allFiles.filter((f) => f.startsWith("session-project-") && f.endsWith(".json"))
    expect(entries.length).toBe(1)
    const exported = JSON.parse(await readFile(path.join(backup.path, entries[0]!), "utf-8"))
    expect(exported.type).toBe("ax-code.project-session-backup")
    expect(exported.version).toBe(1)
    expect(exported.scope).toBe("current-project-id-only")
    expect(exported.worktree).toBe(project.path)
    expect(exported.projectID).toBe(session.projectID)
    expect(exported.count).toBe(1)
    expect(exported.deletionPlan).toEqual({
      sessionCount: 1,
      rootSessionCount: 1,
      rootSessionIDs: [session.id],
    })
    expect(exported.duplicateProjectIdentities).toEqual([])
    expect(exported.restoreHint).toContain("safety archive")
    expect(exported.sessions[0].info.id).toBe(session.id)
  })

  test("deletes current project sessions after backup when confirmed", async () => {
    await using project = await tmpdir({ git: true })
    await using backup = await tmpdir()
    await Instance.provide({
      directory: project.path,
      fn: async () => Session.create({ title: "delete me" }),
    })

    await withCwd(project.path, () =>
      SessionClearProjectCommand.handler({
        yes: true,
        backupDir: backup.path,
        $0: "ax-code",
        _: ["session", "clear-project"],
      } as never),
    )

    await Instance.provide({
      directory: project.path,
      fn: async () => {
        expect([...Session.list()]).toEqual([])
      },
    })
  })

  test("backs up current project sessions without deleting through backup-project", async () => {
    await using project = await tmpdir({ git: true })
    await using backup = await tmpdir()
    const session = await Instance.provide({
      directory: project.path,
      fn: async () => Session.create({ title: "backup only" }),
    })

    await withCwd(project.path, () =>
      SessionBackupProjectCommand.handler({
        backupDir: backup.path,
        $0: "ax-code",
        _: ["session", "backup-project"],
      } as never),
    )

    const allFiles = await readdir(backup.path)
    const entries = allFiles.filter((f) => f.startsWith("session-project-") && f.endsWith(".json"))
    expect(entries.length).toBe(1)
    const exported = JSON.parse(await readFile(path.join(backup.path, entries[0]!), "utf-8"))
    expect(exported.scope).toBe("current-project-id-only")
    expect(exported.projectID).toBe(session.projectID)
    expect(exported.sessions[0].info.id).toBe(session.id)

    await Instance.provide({
      directory: project.path,
      fn: async () => {
        expect([...Session.list()].map((item) => item.id)).toContain(session.id)
      },
    })
  })

  test("deletes child sessions through their root without double-deleting", async () => {
    await using project = await tmpdir({ git: true })
    await using backup = await tmpdir()
    const root = await Instance.provide({
      directory: project.path,
      fn: async () => Session.create({ title: "root" }),
    })
    await Instance.provide({
      directory: project.path,
      fn: async () => Session.create({ title: "child", parentID: root.id }),
    })

    await withCwd(project.path, () =>
      SessionClearProjectCommand.handler({
        yes: true,
        backupDir: backup.path,
        $0: "ax-code",
        _: ["session", "clear-project"],
      } as never),
    )

    await Instance.provide({
      directory: project.path,
      fn: async () => {
        expect([...Session.list()]).toEqual([])
      },
    })
  })

  test("reports current project storage status without deleting sessions", async () => {
    await using project = await tmpdir({ git: true })
    const session = await Instance.provide({
      directory: project.path,
      fn: async () => Session.create({ title: "visible status" }),
    })
    const payload = await Instance.provide({
      directory: project.path,
      fn: async () =>
        sessionProjectStatusPayload({
          projectID: Instance.project.id,
          worktree: Instance.worktree,
          directory: Instance.directory,
          sessions: [...Session.list()],
        }),
    })

    expect(payload.projectID).toBe(session.projectID)
    expect(payload.worktree).toBe(project.path)
    expect(payload.sessions).toBe(1)
    expect(payload.rootSessions).toBe(1)
    expect(payload.duplicateProjectIdentities).toEqual([])
    expect(payload.latest[0].id).toBe(session.id)

    await Instance.provide({
      directory: project.path,
      fn: async () => {
        expect([...Session.list()].map((item) => item.id)).toContain(session.id)
      },
    })
  })
})
