import { describe, expect, test } from "bun:test"
import { apply, banner, init, level } from "../../../src/cli/bootstrap/env"

describe("cli bootstrap env", () => {
  test("debugger forces debug level", () => {
    expect(level(undefined, false, true)).toBe("DEBUG")
    expect(level("ERROR", false, true)).toBe("DEBUG")
  })

  test("apply enables debugger env", () => {
    const env: Record<string, string | undefined> = {}
    apply({ debugger: true, sandbox: "full-access" }, env, 42)
    expect(env.AGENT).toBe("1")
    expect(env.AX_CODE).toBe("1")
    expect(env.AX_CODE_PID).toBe("42")
    expect(env.AX_CODE_ISOLATION_MODE).toBe("full-access")
    expect(env.AX_CODE_DEBUGGER).toBe("1")
    expect(env.AX_CODE_DISABLE_AUTOUPDATE).toBe("1")
  })

  test("banner includes trace hints", () => {
    const text = banner({
      cwd: "/tmp/app",
      log: "/tmp/app/dev.log",
      pid: 9,
      version: "3.0.4",
    })
    expect(text).toContain("ax-code debugger")
    expect(text).toContain("trace: ax-code trace --logs")
    expect(text).toContain("json: /tmp/app/dev.json.log")
  })

  test("init writes debugger summary", async () => {
    const env: Record<string, string | undefined> = {}
    const seen: Array<Record<string, unknown>> = []
    let text = ""

    await init(
      { debugger: true },
      {
        argv: ["bun", "ax-code", "--debugger"],
        cwd: "/tmp/app",
        env,
        info: (_, data) => seen.push(data),
        load: async () => {},
        local: false,
        log: async (opts) => {
          seen.push({ log: opts })
        },
        pid: 77,
        version: "3.0.4",
        write: (chunk) => {
          text += chunk
        },
      },
    )

    expect(seen[0]).toEqual({
      log: {
        dev: false,
        level: "DEBUG",
        print: false,
      },
    })
    expect(env.AX_CODE_DEBUGGER).toBe("1")
    expect(env.AX_CODE_DISABLE_AUTOUPDATE).toBe("1")
    expect(text).toContain("ax-code debugger")
    expect(text).toContain("pid: 77")
    expect(text).toContain("cwd: /tmp/app")
  })
})
