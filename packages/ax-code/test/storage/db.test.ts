import { describe, expect, test } from "bun:test"
import path from "path"
import { Global } from "../../src/global"
import { Installation } from "../../src/installation"
import { Flag } from "../../src/flag/flag"
import { Database } from "../../src/storage/db"
import { DurableStoragePolicy } from "../../src/storage/policy"

describe("Database.Path", () => {
  test("returns database path for the current channel", () => {
    const db = process.env["AX_CODE_DB"]
    const expected = db
      ? path.isAbsolute(db)
        ? db
        : path.join(Global.Path.data, db)
      : ["latest", "beta"].includes(Installation.CHANNEL) || Flag.AX_CODE_DISABLE_CHANNEL_DB
        ? path.join(Global.Path.data, "ax-code.db")
        : path.join(Global.Path.data, `ax-code-${Installation.CHANNEL.replace(/[^a-zA-Z0-9._-]/g, "-")}.db`)
    expect(Database.Path).toBe(expected)
  })
})

describe("Database.applyStartupPragmas", () => {
  test("keeps startup alive when wal checkpoint fails", () => {
    const statements: string[] = []
    const warnings: Array<{ message: string; extra: Record<string, unknown> }> = []

    expect(() =>
      Database.applyStartupPragmas({
        run(sql) {
          statements.push(sql)
          if (sql === "PRAGMA wal_checkpoint(PASSIVE)") throw new Error("attempt to write a readonly database")
        },
        warn(message, extra) {
          warnings.push({ message, extra })
        },
        path: "/tmp/ax-code.db",
      }),
    ).not.toThrow()

    expect(statements).toEqual([
      `PRAGMA busy_timeout = ${DurableStoragePolicy.busyTimeoutMs}`,
      `PRAGMA journal_mode = ${DurableStoragePolicy.journalMode}`,
      `PRAGMA synchronous = ${DurableStoragePolicy.synchronous}`,
      `PRAGMA cache_size = -${DurableStoragePolicy.cacheSizeKiB}`,
      `PRAGMA temp_store = ${DurableStoragePolicy.tempStore}`,
      `PRAGMA wal_autocheckpoint = ${DurableStoragePolicy.walAutoCheckpointPages}`,
      `PRAGMA journal_size_limit = ${DurableStoragePolicy.journalSizeLimitBytes}`,
      "PRAGMA foreign_keys = ON",
      "PRAGMA wal_checkpoint(PASSIVE)",
    ])
    expect(warnings).toEqual([
      {
        message: "failed to checkpoint wal during startup",
        extra: {
          path: "/tmp/ax-code.db",
          error: "attempt to write a readonly database",
        },
      },
    ])
  })
})
