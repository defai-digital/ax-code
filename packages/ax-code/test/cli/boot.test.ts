import { NamedError } from "@ax-code/util/error"
import { describe, expect, test } from "bun:test"
import z from "zod"
import { apply, init, level } from "../../src/cli/bootstrap/env"
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
})

describe("cli.boot.init", () => {
  test("initializes logging and records args", async () => {
    const env: Record<string, string> = {}
    const log: unknown[] = []
    const info: unknown[] = []

    await init(
      { logLevel: "ERROR", sandbox: "read-only" },
      {
        argv: ["bun", "ax-code", "--print-logs", "run"],
        local: false,
        version: "1.2.3",
        pid: 9,
        env,
        log: async (opts) => void log.push(opts),
        info: (msg, extra) => void info.push({ msg, extra }),
      },
    )

    expect(log).toEqual([
      {
        print: true,
        dev: false,
        level: "ERROR",
      },
    ])
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
