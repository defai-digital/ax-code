import { afterEach, describe, expect, test, vi } from "vitest"
import fs from "fs/promises"
import path from "path"
import { InstructionPrompt } from "../../src/session/instruction"
import { Instance } from "../../src/project/instance"
import { Filesystem } from "../../src/util/filesystem"
import { Glob } from "../../src/util/glob"
import { Config } from "../../src/config/config"
import { tmpdir } from "../fixture/fixture"

afterEach(async () => {
  await Instance.disposeAll()
  vi.restoreAllMocks()
})

const RULE_BODY = "Cache test rule body."

async function writeRule(dir: string, name: string, body: string) {
  await fs.mkdir(path.join(dir, ".ax-code", "rules"), { recursive: true })
  await fs.writeFile(path.join(dir, ".ax-code", "rules", name), `---\npaths: ["src/**"]\n---\n${body}`)
}

describe("systemPaths cache", () => {
  test("serves repeated calls from cache until the filesystem changes", async () => {
    await using tmp = await tmpdir({
      git: true,
      // Config with a username keeps loadState off os.userInfo(), whose passwd
      // lookup is unavailable in some sandboxed environments.
      config: { username: "testuser" },
      init: async (dir) => {
        await fs.writeFile(path.join(dir, "AGENTS.md"), "# Root")
      },
    })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const findUp = vi.spyOn(Filesystem, "findUp")
        const first = await InstructionPrompt.systemPaths()
        const second = await InstructionPrompt.systemPaths()
        // The second call hit the cache: the findUp walk ran exactly once.
        expect(findUp).toHaveBeenCalledTimes(1)
        expect(second.has(path.join(tmp.path, "AGENTS.md"))).toBe(true)
        expect([...second].sort()).toEqual([...first].sort())
      },
    })
  })

  test("sees an AGENTS.md created after the cached result", async () => {
    await using tmp = await tmpdir({
      git: true,
      config: { username: "testuser" },
    })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const agents = path.join(tmp.path, "AGENTS.md")
        expect((await InstructionPrompt.systemPaths()).has(agents)).toBe(false)
        await fs.writeFile(agents, "# Created later")
        expect((await InstructionPrompt.systemPaths()).has(agents)).toBe(true)
      },
    })
  })

  test("sees an AGENTS.md removed after the cached result", async () => {
    await using tmp = await tmpdir({
      git: true,
      config: { username: "testuser" },
      init: async (dir) => {
        await fs.writeFile(path.join(dir, "AGENTS.md"), "# Root")
      },
    })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const agents = path.join(tmp.path, "AGENTS.md")
        expect((await InstructionPrompt.systemPaths()).has(agents)).toBe(true)
        await fs.rm(agents)
        expect((await InstructionPrompt.systemPaths()).has(agents)).toBe(false)
      },
    })
  })

  test("drops a cached instruction match whose file was deleted", async () => {
    await using tmp = await tmpdir({
      git: true,
      config: { username: "testuser", instructions: ["extra.md"] },
      init: async (dir) => {
        await fs.writeFile(path.join(dir, "extra.md"), "# Extra")
      },
    })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const extra = path.join(tmp.path, "extra.md")
        expect((await InstructionPrompt.systemPaths()).has(extra)).toBe(true)
        await fs.rm(extra)
        expect((await InstructionPrompt.systemPaths()).has(extra)).toBe(false)
      },
    })
  })

  test("sees a new file matching a configured instruction glob immediately", async () => {
    await using tmp = await tmpdir({
      git: true,
      config: { username: "testuser", instructions: ["docs/*.md"] },
      init: async (dir) => {
        await fs.mkdir(path.join(dir, "docs"), { recursive: true })
      },
    })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const added = path.join(tmp.path, "docs", "added.md")
        expect((await InstructionPrompt.systemPaths()).has(added)).toBe(false)
        await fs.writeFile(added, "# Added")
        expect((await InstructionPrompt.systemPaths()).has(added)).toBe(true)
      },
    })
  })

  test("recomputes after a config change", async () => {
    await using tmp = await tmpdir({
      git: true,
      config: { username: "testuser" },
      init: async (dir) => {
        await fs.writeFile(path.join(dir, "AGENTS.md"), "# Root")
        await fs.writeFile(path.join(dir, "extra.md"), "# Extra")
      },
    })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const findUp = vi.spyOn(Filesystem, "findUp")
        const extra = path.join(tmp.path, "extra.md")
        const first = await InstructionPrompt.systemPaths()
        const second = await InstructionPrompt.systemPaths()
        // Two calls, one computation: the cache is serving.
        expect(findUp).toHaveBeenCalledTimes(1)
        expect(first.has(extra)).toBe(false)
        expect(second.has(extra)).toBe(false)

        // Keep the username: dropping it would push the reloaded config onto
        // os.userInfo(), whose passwd lookup is unavailable in some sandboxed
        // environments.
        await fs.writeFile(
          path.join(tmp.path, "ax-code.json"),
          JSON.stringify({ username: "testuser", instructions: ["extra.md"] }),
        )
        await Config.invalidate()

        const third = await InstructionPrompt.systemPaths()
        expect(third.has(extra)).toBe(true)
        // The config change produced a new config snapshot, which invalidated
        // the cache and forced a second computation.
        expect(findUp).toHaveBeenCalledTimes(2)
      },
    })
  })
})

describe("rules listing cache", () => {
  async function projectWithRule(body: string) {
    return tmpdir({
      git: true,
      config: { username: "testuser" },
      init: async (dir) => {
        await writeRule(dir, "ts.md", body)
        await fs.mkdir(path.join(dir, "src"), { recursive: true })
        await fs.writeFile(path.join(dir, "src", "file.ts"), "content")
      },
    })
  }

  test("serves the listing from cache without re-globbing", async () => {
    await using tmp = await projectWithRule(RULE_BODY)
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const scan = vi.spyOn(Glob, "scan")
        const target = path.join(tmp.path, "src", "file.ts")
        const first = await InstructionPrompt.matchingPathRules(target)
        const second = await InstructionPrompt.matchingPathRules(target)
        expect(first.length).toBe(1)
        expect(second.length).toBe(1)
        expect(first).toEqual(second)
        // The listing cache served the second call: exactly one glob ran.
        expect(scan).toHaveBeenCalledTimes(1)
      },
    })
  })

  test("sees a new rule file created after the cached listing", async () => {
    await using tmp = await projectWithRule(RULE_BODY)
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const scan = vi.spyOn(Glob, "scan")
        const target = path.join(tmp.path, "src", "file.ts")
        expect(await InstructionPrompt.matchingPathRules(target)).toHaveLength(1)

        await writeRule(tmp.path, "new.md", "New rule body.")

        const rules = await InstructionPrompt.matchingPathRules(target)
        expect(rules.map((rule) => path.basename(rule.filepath)).sort()).toEqual(["new.md", "ts.md"])
        // Creating the rule file bumped the directory mtime, so the listing
        // was re-globbed exactly once more.
        expect(scan).toHaveBeenCalledTimes(2)
      },
    })
  })

  test("re-reads a rule edited in place (file mtime beats directory mtime)", async () => {
    await using tmp = await projectWithRule(RULE_BODY)
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const rule = path.join(tmp.path, ".ax-code", "rules", "ts.md")
        const target = path.join(tmp.path, "src", "file.ts")
        // Pin the cached mtime to a past timestamp so the in-place rewrite is
        // guaranteed to produce a different mtime even on coarse-mtime
        // filesystems (a rewrite does not change the directory mtime).
        const past = new Date(Date.now() - 60_000)
        await fs.utimes(rule, past, past)

        const first = await InstructionPrompt.matchingPathRules(target)
        expect(first[0]!.content).toBe(RULE_BODY)

        const rewritten = "Rewritten rule body."
        await fs.writeFile(rule, `---\npaths: ["src/**"]\n---\n${rewritten}`)

        const second = await InstructionPrompt.matchingPathRules(target)
        expect(second[0]!.content).toBe(rewritten)
      },
    })
  })

  test("caches the absent rules directory and sees it created", async () => {
    await using tmp = await tmpdir({
      git: true,
      config: { username: "testuser" },
      init: async (dir) => {
        await fs.mkdir(path.join(dir, "src"), { recursive: true })
        await fs.writeFile(path.join(dir, "src", "file.ts"), "content")
      },
    })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const scan = vi.spyOn(Glob, "scan")
        const target = path.join(tmp.path, "src", "file.ts")
        expect(await InstructionPrompt.matchingPathRules(target)).toEqual([])
        expect(await InstructionPrompt.matchingPathRules(target)).toEqual([])
        // The missing-directory listing was cached: only the first call globbed.
        expect(scan).toHaveBeenCalledTimes(1)

        await writeRule(tmp.path, "late.md", "Late rule body.")

        const rules = await InstructionPrompt.matchingPathRules(target)
        expect(rules.map((rule) => path.basename(rule.filepath))).toEqual(["late.md"])
        expect(scan).toHaveBeenCalledTimes(2)
      },
    })
  })
})
