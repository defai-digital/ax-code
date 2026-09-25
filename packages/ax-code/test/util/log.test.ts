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

describe("log boundary redaction", () => {
  async function textLines() {
    const lines: string[] = []
    await Log.init(
      { print: true },
      {
        stderrWrite: (msg) => {
          lines.push(msg)
        },
      },
    )
    return lines
  }

  // Assembled rather than written out: a literal key of this shape trips the
  // pre-commit secret scanner, and this is a fixture, not a credential. The
  // value it builds is exactly the shape the redactor has to catch.
  const providerKey = "sk-" + "live" + "abcdefghijklmnopqrstuvwxyz"

  test("ordinary text is untouched", async () => {
    const lines = await textLines()
    Log.create({ service: "redact-control" }).info("session resync after reconnect failed", {
      sessionID: "ses_test",
    })
    const output = lines.join("")
    expect(output).toContain("session resync after reconnect failed")
    expect(output).toContain("sessionID=ses_test")
    expect(output).not.toContain("[redacted]")
  })

  test("a credential-named extra field loses its value", async () => {
    const lines = await textLines()
    Log.create({ service: "redact-field" }).warn("provider refresh failed", {
      apiKey: "sk-live-abcdef123456",
      nested: { authorization: "Bearer eyJhbGciOi" },
    })
    const output = lines.join("")
    expect(output).not.toContain("sk-live-abcdef123456")
    expect(output).not.toContain("eyJhbGciOi")
    expect(output).toContain("[redacted]")
  })

  test("names that merely contain a secret word are not redacted", async () => {
    const lines = await textLines()
    Log.create({ service: "redact-strict" }).info("counts", {
      tokenCount: 42,
      keyboard: "us",
      monkey: "banana",
    })
    const output = lines.join("")
    // Over-redaction makes logs useless while looking safe.
    expect(output).toContain("42")
    expect(output).toContain("us")
    expect(output).toContain("banana")
  })

  test("a credential in an error message and its cause chain is redacted", async () => {
    const lines = await textLines()
    const root = new Error("connect failed with password=hunter2")
    const wrapped = new Error("Authorization: Bearer eyJhbGciOiJIUzI1NiJ9", { cause: root })
    Log.create({ service: "redact-error" }).error("upstream call failed", { error: wrapped })
    const output = lines.join("")
    expect(output).not.toContain("hunter2")
    expect(output).not.toContain("eyJhbGciOiJIUzI1NiJ9")
    expect(output).toContain("upstream call failed")
    expect(output).toContain("Caused by")
  })

  test("the err key's stack is redacted in the JSON log", async () => {
    await using tmp = await tmpdir()
    await Log.init({ print: false, dir: tmp.path, name: "redact-err-stack" })
    const error = new Error("boom")
    // A stack is the path that bypassed redaction while pino serialized it.
    error.stack = "Error: boom\n    at run (password=hunter2)"
    Log.create({ service: "redact-err-stack" }).warn("plain boom", { err: error })

    const content = await fs.readFile(path.join(tmp.path, "redact-err-stack.json.log"), "utf8")
    const entry = JSON.parse(content.trim().split("\n").find((line) => line.includes("plain boom"))!)
    expect(entry.err.message).toBe("boom")
    expect(typeof entry.err.stack).toBe("string")
    expect(entry.err.stack).not.toContain("hunter2")
    expect(entry.err.stack).toContain("[redacted]")
  })

  test("a large value is truncated after redaction, never splitting the secret", async () => {
    const lines = await textLines()
    const padding = "p".repeat(2_040)
    Log.create({ service: "redact-cap" }).info("large", { note: `${padding} password=hunter2` })
    const output = lines.join("")
    expect(output).not.toContain("hunter2")
    expect(output).toContain("chars truncated")
  })

  test("a credential spelled out in the message is redacted in the JSON log", async () => {
    await using tmp = await tmpdir()
    await Log.init({ print: false, dir: tmp.path, name: "redact-pino-message" })
    const key = providerKey
    Log.create({ service: "redact-pino-message" }).warn(`upstream refused: Incorrect API key provided: ${key}`)
    const content = await fs.readFile(path.join(tmp.path, "redact-pino-message.json.log"), "utf8")
    expect(content).toContain("upstream refused")
    expect(content).not.toContain(key)
    expect(content).toContain("[redacted")
  })

  test("a credential-named tag loses its value in the JSON log", async () => {
    await using tmp = await tmpdir()
    await Log.init({ print: false, dir: tmp.path, name: "redact-pino-tags" })
    Log.create({ service: "redact-pino-tags", apiKey: providerKey }).info("bound tag")
    const content = await fs.readFile(path.join(tmp.path, "redact-pino-tags.json.log"), "utf8")
    expect(content).not.toContain(providerKey)
    expect(content).toContain("[redacted]")
    expect(content).toContain("redact-pino-tags")
  })

  test("a bare JWT or provider key is redacted with no key name in sight", async () => {
    const lines = await textLines()
    const jwt =
      "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dBjftJeZ4CVPmB92K27uhbUJU1p1rwW1gFWFOEjXk"
    const key = providerKey
    Log.create({ service: "redact-bare" }).info(`tokens seen ${jwt} plus ${key}`)
    const output = lines.join("")
    expect(output).not.toContain(jwt)
    expect(output).not.toContain(key)
    expect(output).toContain("[redacted secret]")
  })

  test("header-style credential names lose their value, a session id does not", async () => {
    const lines = await textLines()
    Log.create({ service: "redact-headers" }).warn("request rejected", {
      auth: "Basic dXNlcjpwYXNzd29yZA==",
      cookie: "session=abc123",
      "x-api-key": "abc123",
      private_key: "plainvalue",
      access_token: "abc123",
      sessionID: "ses_keepme",
    })
    const output = lines.join("")
    expect(output).not.toContain("dXNlcjpwYXNzd29yZA==")
    expect(output).not.toContain("session=abc123")
    expect(output).not.toContain("abc123")
    // No pattern matches this one: the key name alone has to drop it.
    expect(output).not.toContain("plainvalue")
    expect(output).toContain("[redacted]")
    // Over-redaction would blind the log: a session id is not a credential.
    expect(output).toContain("sessionID=ses_keepme")
  })
})
