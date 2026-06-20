import { describe, expect, test } from "vitest"
import { Shell } from "../../src/shell/shell"

describe("Shell", () => {
  test("rejects unsupported Windows shell executables regardless of extension casing", () => {
    expect(Shell.isAcceptable("C:\\Program Files\\fish\\fish.exe", "win32")).toBe(false)
    expect(Shell.isAcceptable("C:\\Program Files\\fish\\FISH.EXE", "win32")).toBe(false)
    expect(Shell.isAcceptable("C:\\Program Files\\nushell\\nu.CMD", "win32")).toBe(false)
    expect(Shell.isAcceptable("C:\\Windows\\System32\\cmd.exe", "win32")).toBe(true)
    expect(Shell.isAcceptable("C:\\Program Files\\Git\\bin\\bash.EXE", "win32")).toBe(true)
  })

  test("rejects unsupported POSIX shell basenames", () => {
    expect(Shell.isAcceptable("/usr/bin/fish", "linux")).toBe(false)
    expect(Shell.isAcceptable("/usr/local/bin/nu", "darwin")).toBe(false)
    expect(Shell.isAcceptable("/bin/bash", "linux")).toBe(true)
  })
})
