import { NamedError } from "@ax-code/util/error"
import { describe, expect, test } from "bun:test"
import os from "os"
import path from "path"
import z from "zod"
import { apply, debugOptions, debugRunDir, init, level } from "../../src/cli/bootstrap/env"
import { data, fatal } from "../../src/cli/bootstrap/fatal"
import { migrate } from "../../src/cli/bootstrap/migrate"

describe("cli.boot.level", () => {
  test("prefers explicit log level", () => {
    expect(level("WARN", false)).toBe("WARN")
  })

  test("uses DEBUG for local installs", () => {
    expect(level(undefined, true)).toBe("DEBUG")
  })

  test("uses INFO outside local installs", () => {
    expect(level(undefined, false)).toBe("INFO")
  })

  test("uses DEBUG when diagnostics are enabled", () => {
    expect(level("ERROR", false, true)).toBe("DEBUG")
  })
})

describe("cli.boot.apply", () => {
  test("sets runtime env vars", () => {
    const env: Record<string, string> = {}
    apply({ sandbox: "workspace-write" }, env, 42)
    expect(env.AGENT).toBe("1")
    expect(env.AX_CODE).toBe("1")
    expect(env.OPENCODE).toBe("1")
    expect(env.AX_CODE_PID).toBe("42")
    expect(env.AX_CODE_ISOLATION_MODE).toBe("workspace-write")
  })

  test("sets debug env vars for child processes", () => {
    const env: Record<string, string | undefined> = {}
    apply({ debug: true, debugIncludeContent: true }, env, 42, "/tmp/ax-code-log/run")
    expect(env.AX_CODE_DEBUG).toBe("1")
    expect(env.AX_CODE_DEBUG_DIR).toBe("/tmp/ax-code-log/run")
    expect(env.AX_CODE_DEBUG_INCLUDE_CONTENT).toBe("1")
  })
})

describe("cli.boot.debugOptions", () => {
  test("keeps diagnostics disabled by default", () => {
    expect(debugOptions({}, "/repo")).toEqual({
      enabled: false,
      baseDir: undefined,
      dir: undefined,
      includeContent: false,
    })
  })

  test("resolves the debug base directory from cwd", () => {
    expect(debugOptions({ debug: true, debugDir: "logs", debugIncludeContent: true }, "/repo")).toEqual({
      enabled: true,
      baseDir: "/repo/logs",
      dir: "/repo/logs",
      includeContent: true,
    })
  })

  test("uses OS temp by default to avoid repo-local data leakage", () => {
    expect(debugOptions({ debug: true }, "/repo").baseDir).toBe(path.join(os.tmpdir(), "ax-code-log"))
  })

  test("formats a stable per-run directory", () => {
    expect(debugRunDir("/repo/ax-code-log", 42, new Date("2026-04-12T23:32:46.123Z"))).toBe(
      "/repo/ax-code-log/20260412-233246Z-42",
    )
  })
})

describe("cli.boot.init", () => {
  test("initializes logging and records args", async () => {
    const env: Record<string, string> = {}
    const log: unknown[] = []
    const info: unknown[] = []
    const now = new Date("2026-04-22T02:15:00.123Z")

    await init(
      { logLevel: "ERROR", sandbox: "read-only" },
      {
        argv: ["bun", "ax-code", "--print-logs", "run"],
        local: false,
        version: "1.2.3",
        pid: 9,
        now,
        env,
        log: async (opts) => void log.push(opts),
        info: (msg, extra) => void info.push({ msg, extra }),
      },
    )

    expect(log).toHaveLength(1)
    expect(log[0]).toMatchObject({
      print: true,
      dev: false,
      level: "ERROR",
    })
    expect((log[0] as { name?: string }).name).toMatch(/^2026-04-22T021500-123-main-[a-z0-9]{8}$/)
    expect(info).toEqual([
      {
        msg: "ax-code",
        extra: {
          version: "1.2.3",
          args: ["--print-logs", "run"],
        },
      },
    ])
    expect(env.AX_CODE_ISOLATION_MODE).toBe("read-only")
    expect(env.AX_CODE_PID).toBe("9")
  })
})

describe("cli.boot.migrate", () => {
  test("skips migration when db already exists", async () => {
    let ran = false

    const ok = await migrate({
      path: "/tmp/db",
      exists: async () => true,
      db: () => ({}) as never,
      run: async () => void (ran = true),
      err: {
        isTTY: false,
        write() {
          return true
        },
      },
    })

    expect(ok).toBe(false)
    expect(ran).toBe(false)
  })

  test("runs migration and prints non-tty progress", async () => {
    const out: string[] = []

    const ok = await migrate({
      path: "/tmp/db",
      exists: async () => false,
      db: () => ({}) as never,
      run: async (_, opts) => {
        opts?.progress?.({
          current: 1,
          total: 2,
          label: "step",
        })
        opts?.progress?.({
          current: 2,
          total: 2,
          label: "done",
        })
      },
      err: {
        isTTY: false,
        write(text: string) {
          out.push(text)
          return true
        },
      },
    })

    expect(ok).toBe(true)
    expect(out.join("")).toContain("Performing one time database migration")
    expect(out.join("")).toContain("sqlite-migration:50")
    expect(out.join("")).toContain("sqlite-migration:100")
    expect(out.join("")).toContain("sqlite-migration:done")
    expect(out.join("")).toContain("Database migration complete.")
  })
})

describe("cli.boot.data", () => {
  test("extracts named error data", () => {
    const Boom = NamedError.create("Boom", z.object({ code: z.string() }))
    expect(data(new Boom({ code: "E1" }))).toMatchObject({
      name: "Boom",
      code: "E1",
    })
  })
})

describe("cli.boot.fatal", () => {
  test("prints fallback output when no formatted error exists", () => {
    const ui: string[] = []
    const out: string[] = []
    const err: unknown[] = []

    fatal(new Error("boom"), {
      error: (msg, extra) => void err.push({ msg, extra }),
      format: () => undefined,
      ui: (text) => void ui.push(text),
      file: () => "/tmp/ax-code.log",
      out: {
        write(text: string) {
          out.push(text)
          return true
        },
      },
      text: (item) => "ERR:" + NamedError.message(item),
    })

    expect(err).toHaveLength(1)
    expect(ui[0]).toContain("/tmp/ax-code.log")
    expect(out).toEqual(["ERR:boom\n"])
  })
})
