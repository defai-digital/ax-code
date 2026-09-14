import { describe, expect, test, vi } from "vitest"
import fs from "fs/promises"
import path from "path"
import { Log } from "../../src/util/log"
import { tmpdir } from "../fixture/fixture"

describe("Log.prune", () => {
  test.each([-1, 1.5, NaN, Infinity])("rejects invalid retention count %s", async (keep) => {
    await using tmp = await tmpdir()
    await expect(Log.prune(tmp.path, { keep })).rejects.toThrow("non-negative integer")
  })

  test("does not count failed deletions as removed logs", async () => {
    await using tmp = await tmpdir()
    const file = path.join(tmp.path, "2026-04-22T015403-649-runtime-old.log")
    await fs.writeFile(file, "old")
    const unlink = vi.spyOn(fs, "unlink").mockRejectedValue(new Error("access denied"))
    try {
      expect(await Log.prune(tmp.path, { keep: 0 })).toEqual({ removed: 0, kept: 1 })
      expect(await fs.readFile(file, "utf8")).toBe("old")
    } finally {
      unlink.mockRestore()
    }
  })

  test("retains recent JSON diagnostics across repeated pruning of empty text logs", async () => {
    await using tmp = await tmpdir()
    const stem = "2026-04-22T015403-649-runtime-json"
    await fs.writeFile(path.join(tmp.path, `${stem}.log`), "")
    await fs.writeFile(path.join(tmp.path, `${stem}.json.log`), '{"message":"diagnostic"}\n')
    await fs.writeFile(path.join(tmp.path, "2026-04-22T015405-000-runtime-new.log"), "new")

    await Log.prune(tmp.path)
    await Log.prune(tmp.path)

    expect(await fs.readFile(path.join(tmp.path, `${stem}.json.log`), "utf8")).toContain("diagnostic")
  })

  test("keep zero removes all managed logs and preserves unrelated files", async () => {
    await using tmp = await tmpdir()
    await fs.writeFile(path.join(tmp.path, "2026-04-22T015403-649-runtime-old.log"), "old")
    await fs.writeFile(path.join(tmp.path, "dev.log"), "unmanaged")

    expect(await Log.prune(tmp.path, { keep: 0 })).toEqual({ removed: 1, kept: 0 })
    expect(await fs.readdir(tmp.path)).toEqual(["dev.log"])
  })

  test("removes old stamped logs including json.log pairs and empty files", async () => {
    await using tmp = await tmpdir()
    const names = [
      "2026-04-22T015403-649-runtime-old.log",
      "2026-04-22T015403-649-runtime-old.json.log",
      "2026-04-22T015404-000-runtime-empty.log",
      "2026-04-22T015405-000-runtime-new.log",
      "2026-04-22T015405-000-runtime-new.json.log",
    ]
    await fs.writeFile(path.join(tmp.path, names[0]), "old")
    await fs.writeFile(path.join(tmp.path, names[1]), "{}")
    await fs.writeFile(path.join(tmp.path, names[2]), "")
    await fs.writeFile(path.join(tmp.path, names[3]), "new")
    await fs.writeFile(path.join(tmp.path, names[4]), "{}")

    const result = await Log.prune(tmp.path, { keep: 1 })
    expect(result.removed).toBe(3)
    const remaining = (await fs.readdir(tmp.path)).sort()
    expect(remaining).toEqual([names[4], names[3]])
  })

  test("treats json.log files as managed companions of stamped logs", () => {
    expect(Log.isManagedLogName("2026-04-22T015403-649-main-run1.log")).toBe(true)
    expect(Log.isManagedLogName("2026-04-22T015403-649-main-run1.json.log")).toBe(true)
    expect(Log.isManagedLogName("dev.log")).toBe(false)
  })
})

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

  test("uses a private temp directory for the default fallback log path", async () => {
    await using tmp = await tmpdir()
    const preferred = path.join(tmp.path, "preferred-default-fallback")
    const warnings: string[] = []

    await Log.init(
      { print: false, dir: preferred, name: "default-fallback-test" },
      {
        mkdir: async (dir, options) => {
          if (path.resolve(String(dir)) === path.resolve(preferred)) throw new Error("disk unavailable")
          await fs.mkdir(dir, options)
        },
        tmpDir: () => tmp.path,
        stderrWrite: (msg) => {
          warnings.push(msg)
        },
      },
    )

    const file = Log.file()
    expect(file).toBeDefined()
    expect(path.basename(file!)).toBe("default-fallback-test.log")
    expect(path.basename(path.dirname(file!))).toMatch(/^ax-code-log-/)
    expect(warnings.join("")).toContain("falling back to")
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

  test("serializes Error extras in the JSON log instead of dropping them as {}", async () => {
    await using tmp = await tmpdir()
    await Log.init({ print: false, dir: tmp.path, name: "json-error-test" })

    Log.create({ service: "test-json-error" }).warn("session resync after reconnect failed", {
      error: new Error("resync failed", { cause: new Error("root cause") }),
      sessionID: "ses_test",
    })

    const content = await fs.readFile(path.join(tmp.path, "json-error-test.json.log"), "utf8")
    const line = content
      .trim()
      .split("\n")
      .find((entry) => entry.includes("session resync after reconnect failed"))
    expect(line).toBeDefined()
    const entry = JSON.parse(line!)
    expect(entry.error).toEqual({
      name: "Error",
      message: "resync failed Caused by: root cause",
    })
    expect(entry.sessionID).toBe("ses_test")
  })

  test("leaves the err key to pino's own serializer", async () => {
    await using tmp = await tmpdir()
    await Log.init({ print: false, dir: tmp.path, name: "json-err-key-test" })

    Log.create({ service: "test-json-err-key" }).warn("plain boom", { err: new Error("kept") })

    const content = await fs.readFile(path.join(tmp.path, "json-err-key-test.json.log"), "utf8")
    const line = content
      .trim()
      .split("\n")
      .find((entry) => entry.includes("plain boom"))
    expect(line).toBeDefined()
    const entry = JSON.parse(line!)
    expect(entry.err.message).toBe("kept")
    expect(typeof entry.err.stack).toBe("string")
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
