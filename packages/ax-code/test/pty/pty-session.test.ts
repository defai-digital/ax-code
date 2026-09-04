import { describe, expect, test } from "vitest"
import { Bus } from "../../src/bus"
import { Instance } from "../../src/project/instance"
import { Pty } from "../../src/pty"
import type { PtyID } from "../../src/pty/schema"
import { tmpdir } from "../fixture/fixture"
import { setTimeout as sleep } from "node:timers/promises"
import fs from "fs/promises"
import path from "path"

const wait = async (fn: () => boolean, ms = 5000) => {
  const end = Date.now() + ms
  while (Date.now() < end) {
    if (fn()) return
    await sleep(25)
  }
  throw new Error("timeout waiting for pty events")
}

const pick = (log: Array<{ type: "created" | "exited" | "deleted"; id: PtyID }>, id: PtyID) => {
  return log.filter((evt) => evt.id === id).map((evt) => evt.type)
}

describe("pty", () => {
  test("update input parses terminal size strings from browser clients", () => {
    const parsed = Pty.UpdateInput.parse({
      size: {
        rows: "24",
        cols: "120",
      },
    })

    expect(parsed.size).toEqual({ rows: 24, cols: 120 })
  })

  test("update input rejects non-decimal terminal size strings", () => {
    expect(
      Pty.UpdateInput.safeParse({
        size: {
          rows: "0x18",
          cols: "120",
        },
      }).success,
    ).toBe(false)

    expect(
      Pty.UpdateInput.safeParse({
        size: {
          rows: "24",
          cols: "1e2",
        },
      }).success,
    ).toBe(false)
  })

  test("direct resize calls reject invalid terminal dimensions", async () => {
    await expect(Pty.resize("pty_missing" as PtyID, 0, 24)).rejects.toThrow()
    await expect(Pty.resize("pty_missing" as PtyID, 80, Number.NaN)).rejects.toThrow()
  })

  test("sanitizes user-provided terminal env before spawn", () => {
    const env = Pty.sanitizeUserEnv({
      OPENAI_API_KEY: "api_key_from_user",
      NODE_OPTIONS: "--require ./shim.js",
      LD_PRELOAD: "/tmp/malicious.so",
      PATH: "/tmp/evil/bin",
      SAFE: "ok",
    })

    expect(env.OPENAI_API_KEY).toBeUndefined()
    expect(env.NODE_OPTIONS).toBeUndefined()
    expect(env.LD_PRELOAD).toBeUndefined()
    expect(env.PATH).toBeUndefined()
    expect(env.SAFE).toBe("ok")
  })

  test("defaults locale-less PTY children to UTF-8", () => {
    expect(Pty.withUtf8LocaleDefaults({ SAFE: "ok" })).toEqual({
      SAFE: "ok",
      LC_ALL: "C.UTF-8",
      LC_CTYPE: "C.UTF-8",
      LANG: "C.UTF-8",
    })
  })

  test.each([{ LANG: "en_CA.UTF-8" }, { LC_CTYPE: "de_DE.UTF-8" }, { LC_ALL: "C" }] as Array<Record<string, string>>)(
    "preserves an explicitly configured PTY locale: %o",
    (env) => {
      expect(Pty.withUtf8LocaleDefaults(env)).toEqual(env)
    },
  )

  test("reports a replay gap when reconnect cursor is older than the retained buffer", () => {
    const replay = Pty.replayBufferedOutput(
      {
        buffer: "cdef",
        bufferCursor: 2,
        cursor: 6,
      },
      1,
    )

    expect(replay.data).toBe("cdef")
    expect(replay.meta).toEqual({
      cursor: 6,
      from: 2,
      gap: { requested: 1, available: 2 },
    })
  })

  test("replays retained data from the requested cursor when no gap exists", () => {
    const replay = Pty.replayBufferedOutput(
      {
        buffer: "cdef",
        bufferCursor: 2,
        cursor: 6,
      },
      3,
    )

    expect(replay.data).toBe("def")
    expect(replay.meta).toEqual({ cursor: 6 })
  })

  test("publishes created, exited, deleted in order for an immediately exiting process", async () => {
    if (process.platform === "win32") return

    await using dir = await tmpdir({ git: true })

    await Instance.provide({
      directory: dir.path,
      fn: async () => {
        const log: Array<{ type: "created" | "exited" | "deleted"; id: PtyID }> = []
        const off = [
          Bus.subscribe(Pty.Event.Created, (evt) => log.push({ type: "created", id: evt.properties.info.id })),
          Bus.subscribe(Pty.Event.Exited, (evt) => log.push({ type: "exited", id: evt.properties.id })),
          Bus.subscribe(Pty.Event.Deleted, (evt) => log.push({ type: "deleted", id: evt.properties.id })),
        ]

        let id: PtyID | undefined
        try {
          const info = await Pty.create({
            command: "/usr/bin/env",
            args: ["true"],
            title: "true",
          })
          id = info.id

          await wait(() => pick(log, id!).includes("exited"))

          await Pty.remove(id)
          await wait(() => pick(log, id!).length >= 3)
          expect(pick(log, id!)).toEqual(["created", "exited", "deleted"])
        } finally {
          off.forEach((x) => x())
          if (id) await Pty.remove(id)
        }
      },
    })
  })

  test("publishes created, exited, deleted in order for /bin/sh + remove", async () => {
    if (process.platform === "win32") return

    await using dir = await tmpdir({ git: true })

    await Instance.provide({
      directory: dir.path,
      fn: async () => {
        const log: Array<{ type: "created" | "exited" | "deleted"; id: PtyID }> = []
        const off = [
          Bus.subscribe(Pty.Event.Created, (evt) => log.push({ type: "created", id: evt.properties.info.id })),
          Bus.subscribe(Pty.Event.Exited, (evt) => log.push({ type: "exited", id: evt.properties.id })),
          Bus.subscribe(Pty.Event.Deleted, (evt) => log.push({ type: "deleted", id: evt.properties.id })),
        ]

        let id: PtyID | undefined
        try {
          const info = await Pty.create({ command: "/bin/sh", title: "sh" })
          id = info.id

          await sleep(100)

          await Pty.remove(id)
          await wait(() => pick(log, id!).length >= 3)
          expect(pick(log, id!)).toEqual(["created", "exited", "deleted"])
        } finally {
          off.forEach((x) => x())
          if (id) await Pty.remove(id)
        }
      },
    })
  })

  test("waits for a real PTY exit and kills its process group before deletion", async () => {
    if (process.platform === "win32") return

    await using dir = await tmpdir({ git: true })

    await Instance.provide({
      directory: dir.path,
      fn: async () => {
        const events: Array<{ type: "exited" | "deleted"; exitCode?: number; signal?: number }> = []
        let targetID: PtyID | undefined
        const off = [
          Bus.subscribe(Pty.Event.Exited, (evt) => {
            if (evt.properties.id !== targetID) return
            const properties = evt.properties as typeof evt.properties & { signal?: number }
            events.push({
              type: "exited",
              exitCode: properties.exitCode,
              signal: properties.signal,
            })
          }),
          Bus.subscribe(Pty.Event.Deleted, (evt) => {
            if (evt.properties.id === targetID) events.push({ type: "deleted" })
          }),
        ]
        const output: string[] = []
        let info: Awaited<ReturnType<typeof Pty.create>> | undefined
        let childPID: number | undefined

        try {
          info = await Pty.create({
            command: "/usr/bin/env",
            args: [
              "sh",
              "-c",
              `trap '' HUP TERM
sh -c 'trap "" HUP TERM; while :; do sleep 1; done' &
echo CHILD:$!
wait`,
            ],
            title: "stubborn-tree",
          })
          targetID = info.id
          await Pty.connect(info.id, {
            readyState: 1,
            send(data) {
              if (typeof data === "string") output.push(data)
            },
            close() {},
          })
          await wait(() => /CHILD:\d+/.test(output.join("")))
          childPID = Number(/CHILD:(\d+)/.exec(output.join(""))?.[1])
          expect(Number.isSafeInteger(childPID)).toBe(true)

          await Pty.remove(info.id)
          await wait(() => events.some((event) => event.type === "deleted"))
          await wait(() => {
            try {
              process.kill(childPID!, 0)
              return false
            } catch {
              return true
            }
          })

          expect(events.map((event) => event.type)).toEqual(["exited", "deleted"])
          expect(events[0]?.signal).toBeGreaterThan(0)
        } finally {
          off.forEach((unsubscribe) => unsubscribe())
          if (info) {
            try {
              process.kill(-info.pid, "SIGKILL")
            } catch {}
            await Pty.remove(info.id)
          }
          if (childPID) {
            try {
              process.kill(childPID, "SIGKILL")
            } catch {}
          }
        }
      },
    })
  })

  test("does not append login args to non-shell commands", async () => {
    await using dir = await tmpdir({ git: true })

    await Instance.provide({
      directory: dir.path,
      fn: async () => {
        const info = await Pty.create({ command: "ssh", args: ["-V"], title: "ssh" })
        try {
          expect(info.args).toEqual(["-V"])
        } finally {
          await Pty.remove(info.id)
        }
      },
    })
  })

  test("prepends the login flag before user-provided shell arguments", async () => {
    if (process.platform === "win32") return

    await using dir = await tmpdir({ git: true })

    await Instance.provide({
      directory: dir.path,
      fn: async () => {
        const info = await Pty.create({ command: "/bin/sh", args: ["-c", "sleep 5"], title: "sh" })
        try {
          expect(info.args).toEqual(["-l", "-c", "sleep 5"])
        } finally {
          await Pty.remove(info.id)
        }
      },
    })
  })

  test("rejects cwd symlinks that escape the project directory", async () => {
    if (process.platform === "win32") return

    await using dir = await tmpdir({ git: true })
    await using outside = await tmpdir()
    const link = path.join(dir.path, "outside-link")
    await fs.symlink(outside.path, link)

    await Instance.provide({
      directory: dir.path,
      fn: async () => {
        await expect(
          Pty.create({
            command: "/usr/bin/env",
            args: ["true"],
            cwd: link,
            title: "escaped-cwd",
          }),
        ).rejects.toMatchObject({
          name: "PtyInvalidCwd",
          data: {
            message: expect.stringContaining("PTY cwd escapes project directory:"),
          },
        })
      },
    })
  })

  test("stores the canonical cwd for symlinks inside the project", async () => {
    if (process.platform === "win32") return

    await using dir = await tmpdir({ git: true })
    const target = path.join(dir.path, "target")
    const link = path.join(dir.path, "target-link")
    await fs.mkdir(target)
    await fs.symlink(target, link)

    await Instance.provide({
      directory: dir.path,
      fn: async () => {
        const info = await Pty.create({ command: "/usr/bin/env", args: ["true"], cwd: link })
        try {
          expect(info.cwd).toBe(await fs.realpath(target))
        } finally {
          await Pty.remove(info.id)
        }
      },
    })
  })

  test("ignores websocket writes after the process exits", async () => {
    if (process.platform === "win32") return

    await using dir = await tmpdir({ git: true })

    await Instance.provide({
      directory: dir.path,
      fn: async () => {
        const info = await Pty.create({
          command: "/usr/bin/env",
          args: ["sh", "-c", "sleep 0.1"],
          title: "sleep",
        })

        try {
          const conn = await Pty.connect(info.id, {
            readyState: 1,
            send() {},
            close() {},
          } as any)

          await wait(() => pick([{ type: "exited", id: info.id }], info.id).includes("exited")).catch(() => sleep(150))
          expect(() => conn?.onMessage("hello")).not.toThrow()
        } finally {
          await Pty.remove(info.id)
        }
      },
    })
  })
})
