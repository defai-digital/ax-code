import { describe, expect, test } from "vitest"
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

  test("recognizes stamped log filenames without a backtracking regex", () => {
    expect(Log.isStampedLogName("2026-04-22T015403-649-main-run1.log")).toBe(true)
    expect(Log.isStampedLogName("2026-04-22T015403-main-run1.log")).toBe(true)
    expect(Log.isStampedLogName("2026-04-22T015403-649-main-run1.json.log")).toBe(false)
    expect(Log.isStampedLogName("dev.log")).toBe(false)
    expect(Log.isStampedLogName("2026-04-22T015403-649-main-run1.txt")).toBe(false)
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

describe("Log.create", () => {
  test("does not throw when structured extras contain bigint values", async () => {
    const lines: string[] = []
    await Log.init(
      { print: true },
      {
        stderrWrite: (msg) => {
          lines.push(msg)
        },
      },
    )

    expect(() => Log.create({ service: "test-log-bigint" }).info("message", { metadata: { count: 1n } })).not.toThrow()

    expect(lines.join("")).toContain('metadata={"count":"1"}')
  })

  test("does not throw when structured extras contain circular references", async () => {
    const lines: string[] = []
    await Log.init(
      { print: true },
      {
        stderrWrite: (msg) => {
          lines.push(msg)
        },
      },
    )
    const metadata: Record<string, unknown> = { name: "root" }
    metadata.self = metadata

    expect(() => Log.create({ service: "test-log-circular" }).warn("message", { metadata })).not.toThrow()

    expect(lines.join("")).toContain('metadata={"name":"root","self":"[Circular]"}')
  })

  test("does not throw when log messages or extras cannot be stringified", async () => {
    const lines: string[] = []
    await Log.init(
      { print: true },
      {
        stderrWrite: (msg) => {
          lines.push(msg)
        },
      },
    )
    const broken = function brokenThrowable() {
      return undefined
    }
    Object.defineProperty(broken, Symbol.toPrimitive, {
      value() {
        throw new Error("cannot stringify")
      },
    })

    expect(() => Log.create({ service: "test-log-unprintable" }).error(broken, { error: broken })).not.toThrow()

    const text = lines.join("")
    expect(text).toContain("error=[Unprintable]")
    expect(text).toContain("[Unprintable]")
  })
})
