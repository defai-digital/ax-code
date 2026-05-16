import { describe, expect, test } from "bun:test"
import path from "path"
import { Global } from "../../src/global"
import { Instance } from "../../src/project/instance"
import { Session } from "../../src/session"
import { Filesystem } from "../../src/util/filesystem"
import { tmpdir } from "../fixture/fixture"

describe("session diff recovery", () => {
  test("missing session_diff storage returns empty array", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({ title: "Diff Missing Test" })
        // No file has been written yet — NotFoundError is the expected
        // path and should surface as [].
        expect(await Session.diff(session.id)).toEqual([])
        await Session.remove(session.id)
      },
    })
  })

  test("corrupt session_diff storage propagates the error and preserves the file", async () => {
    // Regression guard: a previous version of Session.diff silently
    // overwrote the file with [] on any non-NotFound read error, which
    // permanently destroyed diff history whenever the underlying
    // storage suffered a transient fault (corrupt JSON, I/O, perms).
    // The fix propagates the error so the caller can decide what to do,
    // and leaves the original bytes on disk for manual recovery.
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({ title: "Diff Corrupt Test" })
        const file = path.join(Global.Path.data, "storage", "session_diff", `${session.id}.json`)
        const corrupt = "{ invalid json"
        await Bun.write(file, corrupt)

        let caught: unknown = null
        await Session.diff(session.id).catch((err) => {
          caught = err
        })
        expect(caught).not.toBeNull()

        // The corrupt bytes must still be on disk — NOT overwritten with "[]".
        const after = await Filesystem.readText(file)
        expect(after).toBe(corrupt)

        await Session.remove(session.id)
      },
    })
  })
})
