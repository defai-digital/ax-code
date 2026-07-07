import { test, expect } from "vitest"
import { ensureWindowsUtf8Console, UTF8_CONSOLE_GUARD_ENV } from "../../../src/cli/bootstrap/windows-console"

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

test("skips when the guard env var is already set", () => {
  const calls: string[][] = []
  const result = ensureWindowsUtf8Console({
    platform: "win32",
    env: { [UTF8_CONSOLE_GUARD_ENV]: "1" },
    isTTY: true,
    exec: (file, args) => calls.push([file, ...args]),
  })
  expect(result).toBe(false)
  expect(calls).toHaveLength(0)
})

test("swallows exec failure and leaves the guard unset", () => {
  const env: Record<string, string | undefined> = {}
  const result = ensureWindowsUtf8Console({
    platform: "win32",
    env,
    isTTY: true,
    exec: () => {
      throw new Error("chcp.com not found")
    },
  })
  expect(result).toBe(false)
  expect(env[UTF8_CONSOLE_GUARD_ENV]).toBeUndefined()
})
