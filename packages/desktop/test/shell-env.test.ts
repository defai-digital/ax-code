import { describe, expect, test } from "bun:test"
import {
  isNushell,
  loadDesktopShellEnvironment,
  mergeDesktopSidecarEnvironment,
  parseShellEnvOutput,
} from "../src/lifecycle/shell-env"

describe("desktop shell environment", () => {
  test("parses nul-delimited shell environment output", () => {
    expect(parseShellEnvOutput(Buffer.from("PATH=/opt/homebrew/bin:/usr/bin\0OPENAI_API_KEY=secret\0EMPTY=\0"))).toEqual({
      PATH: "/opt/homebrew/bin:/usr/bin",
      OPENAI_API_KEY: "secret",
      EMPTY: "",
    })
  })

  test("merges login shell env without overriding explicit process variables", () => {
    expect(
      mergeDesktopSidecarEnvironment({
        shellEnv: {
          PATH: "/opt/homebrew/bin:/usr/bin:/bin",
          OPENAI_API_KEY: "shell-key",
          SHELL_ONLY: "shell-value",
        },
        processEnv: {
          PATH: "/usr/bin:/bin",
          OPENAI_API_KEY: "process-key",
        },
      }),
    ).toEqual({
      PATH: "/opt/homebrew/bin:/usr/bin:/bin",
      SHELL_ONLY: "shell-value",
    })
  })

  test("uses macOS CLI path fallbacks when login shell env is unavailable", () => {
    expect(
      mergeDesktopSidecarEnvironment({
        shellEnv: null,
        platform: "darwin",
        processEnv: {
          PATH: "/usr/bin:/bin",
          HOME: "/Users/ax",
        },
      }),
    ).toEqual({
      PATH: [
        "/usr/bin",
        "/bin",
        "/opt/homebrew/bin",
        "/usr/local/bin",
        "/usr/sbin",
        "/sbin",
        "/Users/ax/.local/bin",
        "/Users/ax/.bun/bin",
        "/Users/ax/.cargo/bin",
        "/Users/ax/bin",
      ].join(":"),
    })
  })

  test("does not add macOS CLI path fallbacks on non-mac platforms", () => {
    expect(
      mergeDesktopSidecarEnvironment({
        shellEnv: null,
        platform: "linux",
        processEnv: {
          PATH: "/usr/bin:/bin",
          HOME: "/home/ax",
        },
      }),
    ).toBeUndefined()
  })

  test("falls back from interactive to login shell probing and skips nushell", () => {
    const calls: string[] = []
    const shellEnv = loadDesktopShellEnvironment({
      platform: "darwin",
      shell: "/bin/zsh",
      probe: (shell, mode) => {
        calls.push(`${shell} ${mode}`)
        return {
          pid: 1,
          output: [],
          stdout: mode === "-l" ? Buffer.from("PATH=/shell/bin\0") : Buffer.from(""),
          stderr: Buffer.from(""),
          status: mode === "-l" ? 0 : 1,
          signal: null,
        }
      },
    })

    expect(shellEnv).toEqual({ PATH: "/shell/bin" })
    expect(calls).toEqual(["/bin/zsh -il", "/bin/zsh -l"])
    expect(isNushell("/opt/homebrew/bin/nu")).toBe(true)
    expect(
      loadDesktopShellEnvironment({
        platform: "darwin",
        shell: "/opt/homebrew/bin/nu",
        probe: () => {
          throw new Error("nushell should not be probed")
        },
      }),
    ).toBeNull()
  })
})
