import { chmod, lstat, readFile, rm, symlink, writeFile } from "node:fs/promises"
import path from "node:path"
import { describe, expect, test } from "vitest"
import { tmpdir } from "../../fixture/fixture"
import { Global } from "../../../src/global"
import {
  KIMI_READ_ONLY_AGENT,
  ensureKimiReadOnlyAgentFile,
  kimiReadOnlyAgentPath,
} from "../../../src/provider/cli/kimi-isolation"

describe("kimi read-only agent", () => {
  test("writes the agent definition under AX Code's cache directory", async () => {
    const file = await ensureKimiReadOnlyAgentFile()
    expect(file).toBe(kimiReadOnlyAgentPath())
    expect(path.dirname(file)).toBe(Global.Path.cache)
    expect(await readFile(file, "utf8")).toBe(KIMI_READ_ONLY_AGENT)
  })

  test("frontmatter allowlists exactly Read, Glob, and Grep", () => {
    expect(KIMI_READ_ONLY_AGENT).toContain("tools: [Read, Glob, Grep]\n")
    expect(KIMI_READ_ONLY_AGENT.split("\n").filter((line) => line.startsWith("tools:")).length).toBe(1)
    expect(KIMI_READ_ONLY_AGENT.startsWith("---\nname: ax-code-read-only\n")).toBe(true)
  })

  test("is idempotent and repairs a modified copy", async () => {
    await ensureKimiReadOnlyAgentFile()
    await ensureKimiReadOnlyAgentFile()
    expect(await readFile(kimiReadOnlyAgentPath(), "utf8")).toBe(KIMI_READ_ONLY_AGENT)

    await writeFile(kimiReadOnlyAgentPath(), "---\ntools: [Read, Write]\n---\n")
    await ensureKimiReadOnlyAgentFile()
    expect(await readFile(kimiReadOnlyAgentPath(), "utf8")).toBe(KIMI_READ_ONLY_AGENT)
  })

  test("parallel launches can repair the agent file without sharing a temporary file", async () => {
    await ensureKimiReadOnlyAgentFile()
    await writeFile(kimiReadOnlyAgentPath(), "outdated agent definition\n")
    const results = await Promise.allSettled(Array.from({ length: 16 }, () => ensureKimiReadOnlyAgentFile()))
    expect(results.filter((result) => result.status === "rejected")).toEqual([])
    expect(await readFile(kimiReadOnlyAgentPath(), "utf8")).toBe(KIMI_READ_ONLY_AGENT)
  })
})

// Control files must remain local regular files with restrictive permissions.
describe("control file integrity", () => {
  test.skipIf(process.platform === "win32")("replaces a matching symlink without changing its target", async () => {
    await using tmp = await tmpdir()
    const target = path.join(tmp.path, "outside-control-file")
    await writeFile(target, KIMI_READ_ONLY_AGENT)
    await chmod(target, 0o640)
    await ensureKimiReadOnlyAgentFile()
    const file = kimiReadOnlyAgentPath()
    await rm(file)
    await symlink(target, file)
    try {
      await ensureKimiReadOnlyAgentFile()
      expect((await lstat(file)).isSymbolicLink()).toBe(false)
      expect((await lstat(file)).mode & 0o777).toBe(0o600)
      expect(await readFile(file, "utf8")).toBe(KIMI_READ_ONLY_AGENT)
      expect(await readFile(target, "utf8")).toBe(KIMI_READ_ONLY_AGENT)
      expect((await lstat(target)).mode & 0o777).toBe(0o640)
    } finally {
      await rm(file, { force: true })
    }
  })

  test.skipIf(process.platform === "win32")("repairs permissions even when the content already matches", async () => {
    await ensureKimiReadOnlyAgentFile()
    const file = kimiReadOnlyAgentPath()
    await chmod(file, 0o666)
    await ensureKimiReadOnlyAgentFile()
    expect((await lstat(file)).mode & 0o777).toBe(0o600)
    expect(await readFile(file, "utf8")).toBe(KIMI_READ_ONLY_AGENT)
  })
})
