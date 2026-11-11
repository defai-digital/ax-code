import { readFile, writeFile } from "fs/promises"
import path from "path"
import { describe, expect, test } from "vitest"
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
