import { Log } from "../util/log"
import path from "path"
import fs from "fs/promises"
import { Global } from "../global"
import { Filesystem } from "../util/filesystem"
import { lazy } from "../util/lazy"
import { Lock } from "../util/lock"
import { FileLock } from "../util/filelock"
import { NamedError } from "@ax-code/util/error"
import z from "zod"
import { Glob } from "../util/glob"
import { git } from "@/util/git"

export namespace Storage {
  const log = Log.create({ service: "storage" })

  type Migration = (dir: string) => Promise<void>

  export const NotFoundError = NamedError.create(
    "NotFoundError",
    z.object({
      message: z.string(),
    }),
  )

  const MIGRATIONS: Migration[] = [
    async (dir) => {
      const project = path.resolve(dir, "../project")
      if (!(await Filesystem.isDir(project))) return
      const projectDirs = await Glob.scan("*", {
        cwd: project,
        include: "all",
      })
      for (const projectDir of projectDirs) {
        const fullPath = path.join(project, projectDir)
        if (!(await Filesystem.isDir(fullPath))) continue
        log.info(`migrating project ${projectDir}`)
        let projectID = projectDir
        const fullProjectDir = path.join(project, projectDir)
        let worktree = "/"

        if (projectID !== "global") {
          for (const msgFile of await Glob.scan("storage/session/message/*/*.json", {
            cwd: path.join(project, projectDir),
            absolute: true,
          })) {
            try {
              const json = await Filesystem.readJson<any>(msgFile)
              worktree = json.path?.root
              if (worktree) break
            } catch {
              log.warn("skipping corrupted message file during migration", { file: msgFile })
            }
          }
          if (!worktree) continue
          if (!(await Filesystem.isDir(worktree))) continue
          const result = await git(["rev-list", "--max-parents=0", "--all"], {
            cwd: worktree,
          })
          const [id] = result
            .text()
            .split("\n")
            .filter(Boolean)
            .map((x) => x.trim())
            .toSorted()
          if (!id) continue
          projectID = id

          await Filesystem.writeJson(path.join(dir, "project", projectID + ".json"), {
            id,
            vcs: "git",
            worktree,
            time: {
              created: Date.now(),
              initialized: Date.now(),
            },
          })

          log.info(`migrating sessions for project ${projectID}`)
          for (const sessionFile of await Glob.scan("storage/session/info/*.json", {
            cwd: fullProjectDir,
            absolute: true,
          })) {
            const dest = path.join(dir, "session", projectID, path.basename(sessionFile))
            log.info("copying", {
              sessionFile,
              dest,
            })
            const session = await Filesystem.readJson<any>(sessionFile)
            await Filesystem.writeJson(dest, session)
            log.info(`migrating messages for session ${session.id}`)
            for (const msgFile of await Glob.scan(`storage/session/message/${session.id}/*.json`, {
              cwd: fullProjectDir,
              absolute: true,
            })) {
              const dest = path.join(dir, "message", session.id, path.basename(msgFile))
              log.info("copying", {
                msgFile,
                dest,
              })
              const message = await Filesystem.readJson<any>(msgFile)
              await Filesystem.writeJson(dest, message)

              log.info(`migrating parts for message ${message.id}`)
              for (const partFile of await Glob.scan(`storage/session/part/${session.id}/${message.id}/*.json`, {
                cwd: fullProjectDir,
                absolute: true,
              })) {
                const dest = path.join(dir, "part", message.id, path.basename(partFile))
                const part = await Filesystem.readJson(partFile)
                log.info("copying", {
                  partFile,
                  dest,
                })
                await Filesystem.writeJson(dest, part)
              }
            }
          }
        }
      }
    },
    async (dir) => {
      for (const item of await Glob.scan("session/*/*.json", {
        cwd: dir,
        absolute: true,
      })) {
        const session = await Filesystem.readJson<any>(item)
        if (!session.projectID) continue
        if (!session.summary?.diffs) continue
        const { diffs } = session.summary
        await Filesystem.write(path.join(dir, "session_diff", session.id + ".json"), JSON.stringify(diffs))
        await Filesystem.writeJson(path.join(dir, "session", session.projectID, session.id + ".json"), {
          ...session,
          summary: {
            additions: diffs.reduce((sum: number, x: { additions: number; deletions: number }) => sum + x.additions, 0),
            deletions: diffs.reduce((sum: number, x: { additions: number; deletions: number }) => sum + x.deletions, 0),
          },
        })
      }
    },
  ]

  const state = lazy(async () => {
    const dir = path.join(Global.Path.data, "storage")
    // Distinguish "first run" (ENOENT) from "corrupt marker" (any other
    // read/parse failure) so corruption is logged loudly instead of
    // silently masquerading as a fresh install. Both paths still default
    // to 0 because current migrations are idempotent — but a future
    // non-idempotent migration would benefit from a recovery hook hung
    // off this log line (BUG-105). Also clamp values outside the valid
    // range [0, MIGRATIONS.length] so a downgraded marker doesn't cause
    // an out-of-bounds index access at the loop below.
    const migration = await Filesystem.readJson<string>(path.join(dir, "migration"))
      .then((x) => {
        const n = parseInt(x, 10)
        if (Number.isNaN(n)) {
          log.warn("storage migration marker not numeric, defaulting to 0", { value: x })
          return 0
        }
        if (n < 0 || n > MIGRATIONS.length) {
          log.warn("storage migration marker out of range, clamping", { value: n, max: MIGRATIONS.length })
          return Math.max(0, Math.min(n, MIGRATIONS.length))
        }
        return n
      })
      .catch((err) => {
        if ((err as NodeJS.ErrnoException | undefined)?.code === "ENOENT") return 0
        log.error("storage migration marker unreadable, replaying from 0", { err })
        return 0
      })
    for (let index = migration; index < MIGRATIONS.length; index++) {
      log.info("running migration", { index })
      // Renamed to avoid shadowing the outer `migration` (the parsed
      // version-number marker) — a future maintainer adding logging or
      // recovery to the catch block below would otherwise reach for
      // `migration` and silently get the migration function instead of
      // the version number.
      const migrationFn = MIGRATIONS[index]
      // Do NOT advance the version marker on failure — a failed migration
      // must be retried on the next startup, otherwise storage can be
      // left in a permanently corrupt state. The previous code swallowed
      // the error and wrote the next index unconditionally, which meant
      // broken migrations were silently skipped forever.
      try {
        await migrationFn(dir)
      } catch (err) {
        log.error("failed to run migration", { index, err })
        throw err
      }
      await Filesystem.write(path.join(dir, "migration"), (index + 1).toString())
    }
    return {
      dir,
    }
  })

  export async function remove(key: string[]) {
    const dir = await state().then((x) => x.dir)
    const target = path.join(dir, ...key) + ".json"
    return withErrorHandling(async () => {
      using _inProcess = await Lock.write(target)
      // Match `update`: cross-process lock so an unlink can't race with
      // a concurrent ax-code process's read-modify-write on the same
      // key. The previous in-process-only lock was safe within one
      // process but allowed CLI + TUI co-operation on the same target
      // to interleave delete and rename operations.
      using _crossProcess = await FileLock.acquire(target)
      // ENOENT is expected (already removed). Any other error
      // (EPERM, EBUSY, EIO) should surface — a silent catch left
      // callers believing removal succeeded when it hadn't.
      await fs.unlink(target).catch((err: NodeJS.ErrnoException) => {
        if (err?.code === "ENOENT") return
        log.error("storage remove failed", { target, err })
        throw err
      })
    })
  }

  export async function read<T>(key: string[]) {
    const dir = await state().then((x) => x.dir)
    const target = path.join(dir, ...key) + ".json"
    return withErrorHandling(async () => {
      using _ = await Lock.read(target)
      const result = await Filesystem.readJson<T>(target)
      return result as T
    })
  }

  export async function update<T>(key: string[], fn: (draft: T) => void) {
    const dir = await state().then((x) => x.dir)
    const target = path.join(dir, ...key) + ".json"
    return withErrorHandling(async () => {
      // In-process lock prevents concurrent reads/writes within this process.
      using _inProcess = await Lock.write(target)
      // Cross-process lock via O_EXCL lockfile prevents concurrent
      // read-modify-write across separate ax-code processes (CLI +
      // desktop app, multiple terminals). See BUG-12.
      using _crossProcess = await FileLock.acquire(target)
      const content = await Filesystem.readJson<T>(target)
      fn(content as T)
      await Filesystem.writeJson(target, content)
      return content
    })
  }

  export async function write<T>(key: string[], content: T) {
    const dir = await state().then((x) => x.dir)
    const target = path.join(dir, ...key) + ".json"
    return withErrorHandling(async () => {
      using _inProcess = await Lock.write(target)
      // Pair with `update`'s cross-process lock so a write from one
      // ax-code process can't be silently overwritten by a concurrent
      // write from another (CLI + TUI / desktop running against the
      // same project). `Filesystem.writeJson` is atomic per-write
      // (tmp+rename), but two interleaved overwrites still produce a
      // last-writer-wins race where one caller's content is lost
      // without any error surfacing.
      using _crossProcess = await FileLock.acquire(target)
      await Filesystem.writeJson(target, content)
    })
  }

  async function withErrorHandling<T>(body: () => Promise<T>) {
    return body().catch((e) => {
      if (!(e instanceof Error)) throw e
      const errnoException = e as NodeJS.ErrnoException
      if (errnoException.code === "ENOENT") {
        throw new NotFoundError({ message: `Resource not found: ${errnoException.path}` })
      }
      throw e
    })
  }

  export async function list(prefix: string[]) {
    const dir = await state().then((x) => x.dir)
    try {
      // Strip the `.json` suffix specifically. The previous `.slice(0,
      // -5)` hardcoded the strip length assuming every file is at
      // least 5 chars long and ends in `.json` — a 4-char file like
      // `a.json` would become `a.js` and a file with any other
      // extension would be silently mangled. A regex anchored to `$`
      // is both correct for the current contract and safe for any
      // future file type that enters the storage directory. See
      // BUG-67.
      const result = await Glob.scan("**/*", {
        cwd: path.join(dir, ...prefix),
        include: "file",
      }).then((results) => results.map((x) => [...prefix, ...x.replace(/\.json$/, "").split(path.sep)]))
      result.sort()
      return result
    } catch (err) {
      // Only "directory does not exist yet" legitimately means an empty
      // listing. Other errors (EACCES, EIO, corrupt directory) must
      // surface — a bare `catch {}` here let permission and I/O failures
      // masquerade as "no sessions/projects found", which silently broke
      // discovery callers and could prompt them to write fresh state on
      // top of unreadable existing data.
      if ((err as NodeJS.ErrnoException)?.code === "ENOENT") return []
      throw err
    }
  }
}
