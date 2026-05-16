import { describe, expect, test } from "bun:test"
import fs from "fs/promises"
import path from "path"
import { Log } from "../../src/util/log"
import { tmpdir } from "../fixture/fixture"

describe("Log.stampedName", () => {
  test("keeps component-scoped names distinct within the same second", () => {
    const now = new Date("2026-04-22T01:54:03.649Z")

    expect(Log.stampedName("main", now, "run1")).toBe("2026-04-22T015403-649-main-run1")
    expect(Log.stampedName("tui-worker", now, "run1")).toBe("2026-04-22T015403-649-tui-worker-run1")
    expect(Log.stampedName("main", now, "run1")).not.toBe(Log.stampedName("tui-worker", now, "run1"))
  })

  test("keeps same-component names distinct when the caller provides a different run id", () => {
    const now = new Date("2026-04-22T01:54:03.649Z")

    expect(Log.stampedName("main", now, "run1")).not.toBe(Log.stampedName("main", now, "run2"))
  })
})

describe("Log.init", () => {
  test("skips file log setup in print mode", async () => {
    let mkdirCalls = 0
    let truncateCalls = 0

    await Log.init(
      { print: true },
      {
        mkdir: async (...args) => {
          mkdirCalls += 1
          await fs.mkdir(...args)
        },
        truncate: async (...args) => {
          truncateCalls += 1
          await fs.truncate(...args)
        },
      },
    )

    expect(mkdirCalls).toBe(0)
    expect(truncateCalls).toBe(0)
  })

  test("falls back to a temp log dir when the preferred path is unavailable", async () => {
    await using tmp = await tmpdir()
    const preferred = path.join(tmp.path, "preferred")
    const fallback = path.join(tmp.path, "fallback")
    const warnings: string[] = []

    await Log.init(
      { print: false, dir: preferred, name: "fallback-test" },
      {
        mkdir: async (dir, options) => {
          if (path.resolve(String(dir)) === path.resolve(preferred)) throw new Error("disk unavailable")
          await fs.mkdir(dir, options)
        },
        fallbackDir: fallback,
        stderrWrite: (msg) => {
          warnings.push(msg)
        },
      },
    )

    expect(Log.file()).toBe(path.join(fallback, "fallback-test.log"))
    expect(warnings.join("")).toContain(`falling back to ${fallback}`)
  })

  test("falls back when the preferred log file cannot be opened", async () => {
    await using tmp = await tmpdir()
    const preferred = path.join(tmp.path, "preferred-open")
    const fallback = path.join(tmp.path, "fallback-open")
    const warnings: string[] = []

    await Log.init(
      { print: false, dir: preferred, name: "open-fallback-test" },
      {
        open: async (file, flags) => {
          if (String(file).includes("preferred-open")) throw new Error("EPERM")
          return fs.open(file, flags)
        },
        fallbackDir: fallback,
        stderrWrite: (msg) => {
          warnings.push(msg)
        },
      },
    )

    expect(Log.file()).toBe(path.join(fallback, "open-fallback-test.log"))
    expect(warnings.join("")).toContain(`falling back to ${fallback}`)
  })
})
