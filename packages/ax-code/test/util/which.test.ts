import { afterEach, describe, expect, test, vi } from "vitest"
import fs from "fs/promises"
import path from "path"
import { which } from "../../src/util/which"
import { tmpdir } from "../fixture/fixture"

async function cmd(dir: string, name: string, exec = true) {
  const ext = process.platform === "win32" ? ".cmd" : ""
  const file = path.join(dir, name + ext)
  const body = process.platform === "win32" ? "@echo off\r\n" : "#!/bin/sh\n"
  await fs.writeFile(file, body)
  if (process.platform !== "win32") {
    await fs.chmod(file, exec ? 0o755 : 0o644)
  }
  return file
}

function env(PATH: string): NodeJS.ProcessEnv {
  return {
    PATH,
    PATHEXT: process.env["PATHEXT"],
  }
}

function envPath(Path: string): NodeJS.ProcessEnv {
  return {
    Path,
    PathExt: process.env["PathExt"] ?? process.env["PATHEXT"],
  }
}

function same(a: string | null, b: string) {
  if (process.platform === "win32") {
    expect(a?.toLowerCase()).toBe(b.toLowerCase())
    return
  }

  expect(a).toBe(b)
}

afterEach(() => vi.unstubAllEnvs())

describe("util.which", () => {
  test("resolves a new first match immediately after PATH changes", async () => {
    await using tmp = await tmpdir()
    const a = path.join(tmp.path, "a")
    const b = path.join(tmp.path, "b")
    await fs.mkdir(a)
    await fs.mkdir(b)
    const name = `ax-code-path-change-${Math.random().toString(36).slice(2)}`
    const first = await cmd(a, name)
    const second = await cmd(b, name)
    vi.stubEnv("PATH", a)
    same(which(name), first)
    vi.stubEnv("PATH", [b, a].join(path.delimiter))
    same(which(name), second)
  })

  test("does not reuse a CLI from another home directory", async () => {
    await using tmp = await tmpdir()
    const name = `ax-code-home-change-${Math.random().toString(36).slice(2)}`
    const a = path.join(tmp.path, "a")
    const b = path.join(tmp.path, "b")
    const binA = path.join(a, ".grok", "bin")
    const binB = path.join(b, ".grok", "bin")
    await fs.mkdir(binA, { recursive: true })
    await fs.mkdir(binB, { recursive: true })
    const first = await cmd(binA, name)
    const second = await cmd(binB, name)
    vi.stubEnv("AX_CODE_TEST_HOME", a)
    same(which(name), first)
    vi.stubEnv("AX_CODE_TEST_HOME", b)
    same(which(name), second)
  })

  test("drops a cached command that loses executable permission", async () => {
    if (process.platform === "win32") return
    await using tmp = await tmpdir()
    const a = path.join(tmp.path, "a")
    const b = path.join(tmp.path, "b")
    await fs.mkdir(a)
    await fs.mkdir(b)
    const name = `ax-code-permission-change-${Math.random().toString(36).slice(2)}`
    const first = await cmd(a, name)
    const second = await cmd(b, name)
    vi.stubEnv("PATH", [a, b].join(path.delimiter))
    same(which(name), first)
    await fs.chmod(first, 0o644)
    same(which(name), second)
  })
  test("reevaluates relative PATH precedence after a directory change", async () => {
    await using tmp = await tmpdir()
    const original = process.cwd()
    const name = `ax-code-cwd-change-${Math.random().toString(36).slice(2)}`
    for (const root of ["one", "two"]) {
      for (const bin of ["a", "b"]) await fs.mkdir(path.join(tmp.path, root, bin), { recursive: true })
    }
    await cmd(path.join(tmp.path, "one", "b"), name)
    await cmd(path.join(tmp.path, "two", "a"), name)
    await cmd(path.join(tmp.path, "two", "b"), name)
    vi.stubEnv("PATH", ["a", "b"].join(path.delimiter))
    try {
      process.chdir(path.join(tmp.path, "one"))
      same(which(name), path.join("b", name + (process.platform === "win32" ? ".cmd" : "")))
      process.chdir(path.join(tmp.path, "two"))
      same(which(name), path.join("a", name + (process.platform === "win32" ? ".cmd" : "")))
    } finally {
      process.chdir(original)
    }
  })

  test("returns null when command is missing", () => {
    expect(which("opencode-missing-command-for-test")).toBeNull()
  })

  test("detects a CLI installed after an earlier failed lookup", async () => {
    await using tmp = await tmpdir()
    const original = process.env.AX_CODE_TEST_HOME
    const name = `ax-code-appears-${Math.random().toString(36).slice(2)}`
    process.env.AX_CODE_TEST_HOME = tmp.path
    try {
      expect(which(name)).toBeNull()

      const bin = path.join(tmp.path, ".grok", "bin")
      await fs.mkdir(bin, { recursive: true })
      const file = await cmd(bin, name)

      same(which(name), file)
    } finally {
      if (original === undefined) delete process.env.AX_CODE_TEST_HOME
      else process.env.AX_CODE_TEST_HOME = original
    }
  })

  test("drops a cached lookup once the binary is removed", async () => {
    await using tmp = await tmpdir()
    const original = process.env.AX_CODE_TEST_HOME
    const name = `ax-code-removed-${Math.random().toString(36).slice(2)}`
    process.env.AX_CODE_TEST_HOME = tmp.path
    try {
      const bin = path.join(tmp.path, ".grok", "bin")
      await fs.mkdir(bin, { recursive: true })
      const file = await cmd(bin, name)

      same(which(name), file)
      await fs.rm(file)
      expect(which(name)).toBeNull()
    } finally {
      if (original === undefined) delete process.env.AX_CODE_TEST_HOME
      else process.env.AX_CODE_TEST_HOME = original
    }
  })

  test("finds a command from PATH override", async () => {
    await using tmp = await tmpdir()
    const bin = path.join(tmp.path, "bin")
    await fs.mkdir(bin)
    const file = await cmd(bin, "tool")

    same(which("tool", env(bin)), file)
  })

  test("uses first PATH match", async () => {
    await using tmp = await tmpdir()
    const a = path.join(tmp.path, "a")
    const b = path.join(tmp.path, "b")
    await fs.mkdir(a)
    await fs.mkdir(b)
    const first = await cmd(a, "dupe")
    await cmd(b, "dupe")

    same(which("dupe", env([a, b].join(path.delimiter))), first)
  })

  test("returns null for non-executable file on unix", async () => {
    if (process.platform === "win32") return

    await using tmp = await tmpdir()
    const bin = path.join(tmp.path, "bin")
    await fs.mkdir(bin)
    await cmd(bin, "noexec", false)

    expect(which("noexec", env(bin))).toBeNull()
  })

  test("uses PATHEXT on windows", async () => {
    if (process.platform !== "win32") return

    await using tmp = await tmpdir()
    const bin = path.join(tmp.path, "bin")
    await fs.mkdir(bin)
    const file = path.join(bin, "pathext.CMD")
    await fs.writeFile(file, "@echo off\r\n")

    expect(which("pathext", { PATH: bin, PATHEXT: ".CMD" })).toBe(file)
  })

  test("uses Windows Path casing fallback", async () => {
    if (process.platform !== "win32") return

    await using tmp = await tmpdir()
    const bin = path.join(tmp.path, "bin")
    await fs.mkdir(bin)
    const file = await cmd(bin, "mixed")

    same(which("mixed", envPath(bin)), file)
  })

  test("searches common user CLI install directories", async () => {
    if (process.platform === "win32") return

    await using tmp = await tmpdir()
    const original = process.env.AX_CODE_TEST_HOME
    process.env.AX_CODE_TEST_HOME = tmp.path
    try {
      const bin = path.join(tmp.path, ".grok", "bin")
      await fs.mkdir(bin, { recursive: true })
      const file = await cmd(bin, "grok")

      same(which("grok", env("")), file)
    } finally {
      if (original === undefined) delete process.env.AX_CODE_TEST_HOME
      else process.env.AX_CODE_TEST_HOME = original
    }
  })
})
