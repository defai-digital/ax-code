import { test, expect } from "vitest"
import { spawnSync } from "node:child_process"
import {
  ensureWindowsUtf8Console,
  UTF8_CONSOLE_GUARD_ENV,
  type WindowsConsoleCodePages,
} from "../../../src/cli/bootstrap/windows-console"

test("no-op on non-Windows platforms", () => {
  const calls: string[][] = []
  const result = ensureWindowsUtf8Console({
    platform: "darwin",
    env: {},
    isTTY: true,
    exec: (file, args) => calls.push([file, ...args]),
  })
  expect(result).toBe(false)
  expect(calls).toHaveLength(0)
})

test("runs chcp.com 65001 on win32 with a TTY", () => {
  const calls: string[][] = []
  const env: Record<string, string | undefined> = { SystemRoot: "C:\\Windows" }
  const result = ensureWindowsUtf8Console({
    platform: "win32",
    env,
    isTTY: true,
    native: null,
    exec: (file, args) => calls.push([file, ...args]),
  })
  expect(result).toBe(true)
  expect(calls).toEqual([["C:\\Windows\\System32\\chcp.com", "65001"]])
  expect(env[UTF8_CONSOLE_GUARD_ENV]).toBe("1")
})

test("falls back to bare chcp.com without SystemRoot", () => {
  const calls: string[][] = []
  const result = ensureWindowsUtf8Console({
    platform: "win32",
    env: {},
    isTTY: true,
    native: null,
    exec: (file, args) => calls.push([file, ...args]),
  })
  expect(result).toBe(true)
  expect(calls).toEqual([["chcp.com", "65001"]])
})

test("skips when output is not a TTY", () => {
  const calls: string[][] = []
  const result = ensureWindowsUtf8Console({
    platform: "win32",
    env: {},
    isTTY: false,
    exec: (file, args) => calls.push([file, ...args]),
  })
  expect(result).toBe(false)
  expect(calls).toHaveLength(0)
})

test("does not let a stale env guard bypass the fallback on a new launch", () => {
  const calls: string[][] = []
  const result = ensureWindowsUtf8Console({
    platform: "win32",
    env: { [UTF8_CONSOLE_GUARD_ENV]: "1" },
    isTTY: true,
    native: null,
    exec: (file, args) => calls.push([file, ...args]),
  })
  expect(result).toBe(true)
  expect(calls).toEqual([["chcp.com", "65001"]])
})

function consoleApi(input: number, output: number) {
  const writes: string[] = []
  const api: WindowsConsoleCodePages = {
    GetConsoleCP: () => input,
    GetConsoleOutputCP: () => output,
    SetConsoleCP: (value) => {
      input = value
      writes.push("input")
      return 1
    },
    SetConsoleOutputCP: (value) => {
      output = value
      writes.push("output")
      return 1
    },
  }
  return { api, writes }
}

test("repairs output-only GBK drift even when input and the env marker say UTF-8", () => {
  const { api, writes } = consoleApi(65001, 936)
  expect(
    ensureWindowsUtf8Console({ platform: "win32", isTTY: true, native: api, env: { [UTF8_CONSOLE_GUARD_ENV]: "1" } }),
  ).toBe(true)
  expect(api.GetConsoleOutputCP()).toBe(65001)
  expect(writes).toEqual(["output"])
})

test("rechecks actual state after a successful call and console reuse", () => {
  const { api, writes } = consoleApi(936, 936)
  const dep = { platform: "win32" as const, isTTY: true, native: api, env: {} }
  expect(ensureWindowsUtf8Console(dep)).toBe(true)
  expect(writes).toEqual(["input", "output"])
  api.SetConsoleOutputCP(936)
  expect(ensureWindowsUtf8Console(dep)).toBe(true)
  expect(api.GetConsoleOutputCP()).toBe(65001)
})

test("does not rewrite an already correct console", () => {
  const { api, writes } = consoleApi(65001, 65001)
  expect(ensureWindowsUtf8Console({ platform: "win32", isTTY: true, native: api, env: {} })).toBe(true)
  expect(writes).toEqual([])
})

test("does not claim success when the native setter fails or changes no state", () => {
  for (const result of [0, 1]) {
    const { api } = consoleApi(65001, 936)
    api.SetConsoleOutputCP = () => result
    const env = {}
    expect(ensureWindowsUtf8Console({ platform: "win32", isTTY: true, native: api, env })).toBe(false)
    expect(env).toEqual({})
  }
})

test("does not change code pages when output is redirected or no console is attached", () => {
  const { api, writes } = consoleApi(0, 0)
  expect(ensureWindowsUtf8Console({ platform: "win32", isTTY: true, native: api, env: {} })).toBe(false)
  expect(ensureWindowsUtf8Console({ platform: "win32", isTTY: false, native: api, env: {} })).toBe(false)
  expect(writes).toEqual([])
})

test("swallows exec failure and leaves the guard unset", () => {
  const env: Record<string, string | undefined> = {}
  const result = ensureWindowsUtf8Console({
    platform: "win32",
    env,
    isTTY: true,
    native: null,
    exec: () => {
      throw new Error("chcp.com not found")
    },
  })
  expect(result).toBe(false)
  expect(env[UTF8_CONSOLE_GUARD_ENV]).toBeUndefined()
})

test.skipIf(process.platform !== "win32" || Number(process.versions.node.split(".")[0]) < 26)(
  "repairs a real isolated Windows console after output code-page drift",
  () => {
    const child = spawnSync(
      process.execPath,
      [
        "--experimental-ffi",
        "--disable-warning=ExperimentalWarning",
        "--input-type=module",
        "--eval",
        `
          import assert from "node:assert/strict"
          import { dlopen } from "node:ffi"
          const { ensureWindowsUtf8Console, UTF8_CONSOLE_GUARD_ENV } = await import(process.argv[1])
          const library = dlopen("kernel32.dll", {
            FreeConsole: { arguments: [], return: "i32" },
            AllocConsole: { arguments: [], return: "i32" },
            GetConsoleCP: { arguments: [], return: "u32" },
            GetConsoleOutputCP: { arguments: [], return: "u32" },
            SetConsoleCP: { arguments: ["u32"], return: "i32" },
            SetConsoleOutputCP: { arguments: ["u32"], return: "i32" },
          })
          const api = library.functions
          // Detach only this child; never change the developer's shared console.
          api.FreeConsole()
          assert.equal(api.AllocConsole(), 1)
          try {
            const env = { [UTF8_CONSOLE_GUARD_ENV]: "1" }
            for (let restart = 0; restart < 2; restart++) {
              assert.equal(api.SetConsoleCP(65001), 1)
              assert.equal(api.SetConsoleOutputCP(936), 1)
              assert.equal(ensureWindowsUtf8Console({ isTTY: true, env, exec: () => {
                throw new Error("Native console API unexpectedly fell back to chcp")
              } }), true)
              assert.equal(api.GetConsoleCP(), 65001)
              assert.equal(api.GetConsoleOutputCP(), 65001)
            }
          } finally {
            api.FreeConsole()
          }
          process.stdout.write("native-console-ready")
        `,
        new URL("../../../src/cli/bootstrap/windows-console.ts", import.meta.url).href,
      ],
      { encoding: "utf8", windowsHide: true, timeout: 15_000 },
    )
    expect(child.error).toBeUndefined()
    expect(child.status, child.stderr).toBe(0)
    expect(child.stdout).toBe("native-console-ready")
  },
)
