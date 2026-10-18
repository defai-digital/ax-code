import { afterEach, describe, expect, test, vi } from "vitest"
import fs from "fs/promises"
import path from "path"
import { Filesystem } from "../../src/util/filesystem"
import { InstructionPrompt } from "../../src/session/instruction"
import { Instance } from "../../src/project/instance"
import { WriteTool } from "../../src/tool/write"
import { Log } from "../../src/util/log"
import { tmpdir } from "../fixture/fixture"
import { SessionID, MessageID } from "../../src/session/schema"

afterEach(async () => {
  await Instance.disposeAll()
  vi.restoreAllMocks()
})

const RULES_BODY = "Always run the focused vitest file after touching a test."

async function writeRules(dir: string, extra?: (dir: string) => Promise<void>) {
  await fs.mkdir(path.join(dir, ".ax-code", "rules"), { recursive: true })
  await fs.writeFile(
    path.join(dir, ".ax-code", "rules", "ts-tests.md"),
    `---\npaths:\n  - "**/*.test.ts"\n  - "test/**"\n---\n${RULES_BODY}`,
  )
  await fs.writeFile(
    path.join(dir, ".ax-code", "rules", "docs.md"),
    '---\npaths: ["docs/**"]\n---\n# Docs rule\nKeep diagrams next to the page they explain.',
  )
  // No `paths` frontmatter: ignored by the rules mechanism (use AGENTS.md).
  await fs.writeFile(path.join(dir, ".ax-code", "rules", "global.md"), "---\ntitle: no paths\n---\nGlobal rule body.")
  await extra?.(dir)
}

async function projectWithRules(extra?: (dir: string) => Promise<void>) {
  return tmpdir({
    git: true,
    config: { username: "testuser" },
    init: async (dir) => {
      await writeRules(dir, extra)
      await fs.mkdir(path.join(dir, "src"), { recursive: true })
      await fs.writeFile(path.join(dir, "src", "foo.test.ts"), "test content")
      await fs.writeFile(path.join(dir, "src", "foo.ts"), "source content")
    },
  })
}

function messagesWithLoaded(tool: string, loaded: string[]) {
  return [
    {
      info: { id: "m0", role: "user" },
      parts: [
        {
          id: "p0",
          type: "tool",
          tool,
          state: { status: "completed", time: { created: Date.now() }, metadata: { loaded } },
        },
      ],
    },
  ] as any
}

describe("path rules frontmatter and matching (ADR-219)", () => {
  test("matches rule globs against the worktree-relative path", async () => {
    await using tmp = await projectWithRules()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const tsRule = await InstructionPrompt.matchingPathRules(path.join(tmp.path, "src", "foo.test.ts"))
        expect(tsRule.length).toBe(1)
        expect(tsRule[0]!.paths).toEqual(["**/*.test.ts", "test/**"])
        expect(tsRule[0]!.content).toBe(RULES_BODY)

        expect((await InstructionPrompt.matchingPathRules(path.join(tmp.path, "src", "foo.ts"))).length).toBe(0)
      },
    })
  })

  test("a rule without paths is ignored", async () => {
    await using tmp = await projectWithRules()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        // global.md has no `paths` key; nothing matches it regardless of target.
        const all = [
          ...(await InstructionPrompt.matchingPathRules(path.join(tmp.path, "src", "foo.ts"))),
          ...(await InstructionPrompt.matchingPathRules(path.join(tmp.path, "global.md"))),
        ]
        expect(all.map((rule) => path.basename(rule.filepath))).not.toContain("global.md")
      },
    })
  })

  test("a rule with invalid paths frontmatter is ignored", async () => {
    await using tmp = await projectWithRules(async (dir) => {
      await fs.writeFile(path.join(dir, ".ax-code", "rules", "broken.md"), '---\npaths: "not-an-array"\n---\nBody.')
    })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const rules = await InstructionPrompt.matchingPathRules(path.join(tmp.path, "src", "foo.test.ts"))
        expect(rules.map((rule) => path.basename(rule.filepath))).toEqual(["ts-tests.md"])
      },
    })
  })

  test("a rule over the size cap is skipped", async () => {
    await using tmp = await projectWithRules(async (dir) => {
      await fs.writeFile(
        path.join(dir, ".ax-code", "rules", "huge.md"),
        `---\npaths: ["**/*.test.ts"]\n---\n${"x".repeat(65 * 1024)}`,
      )
    })
    const warn = vi.spyOn(Log.create({ service: "instruction" }), "warn")
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const rules = await InstructionPrompt.matchingPathRules(path.join(tmp.path, "src", "foo.test.ts"))
        expect(rules.map((rule) => path.basename(rule.filepath))).toEqual(["ts-tests.md"])
        expect(warn).toHaveBeenCalledWith(
          "path rule exceeds size cap; skipping",
          expect.objectContaining({ path: path.join(tmp.path, ".ax-code", "rules", "huge.md") }),
        )
      },
    })
  })

  test("a rule over the size cap is skipped without reading the file body", async () => {
    await using tmp = await projectWithRules(async (dir) => {
      await fs.writeFile(
        path.join(dir, ".ax-code", "rules", "huge.md"),
        `---\npaths: ["**/*.test.ts"]\n---\n${"x".repeat(65 * 1024)}`,
      )
    })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const reads = vi.spyOn(Filesystem, "readText")
        const rules = await InstructionPrompt.matchingPathRules(path.join(tmp.path, "src", "foo.test.ts"))
        expect(rules.map((rule) => path.basename(rule.filepath))).toEqual(["ts-tests.md"])
        const huge = path.join(tmp.path, ".ax-code", "rules", "huge.md")
        expect(reads.mock.calls.filter(([file]) => file === huge)).toEqual([])
      },
    })
  })

  test("targets outside the worktree never match", async () => {
    await using tmp = await projectWithRules()
    await using outside = await tmpdir()
    const outsideFile = path.join(outside.path, "leak.test.ts")
    await fs.writeFile(outsideFile, "outside")
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        expect(await InstructionPrompt.matchingPathRules(outsideFile)).toEqual([])
      },
    })
  })
})

describe("path rules injection via resolve (ADR-219)", () => {
  test("injects a matching rule once per message and once per session", async () => {
    await using tmp = await projectWithRules()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const target = path.join(tmp.path, "src", "foo.test.ts")
        const rulePath = path.join(tmp.path, ".ax-code", "rules", "ts-tests.md")

        const first = await InstructionPrompt.resolve([], target, "msg-1")
        expect(first.length).toBe(1)
        expect(first[0]!.filepath).toBe(rulePath)
        expect(first[0]!.content).toContain("Instructions from: " + rulePath)
        expect(first[0]!.content).toContain(RULES_BODY)
        // The frontmatter is not part of the injected content.
        expect(first[0]!.content).not.toContain("paths:")

        // Same message: per-message claim suppresses re-injection.
        expect(await InstructionPrompt.resolve([], target, "msg-1")).toEqual([])

        // New message, but the session already loaded the rule through a
        // completed read part: session-wide dedupe suppresses it.
        expect(await InstructionPrompt.resolve(messagesWithLoaded("read", [rulePath]), target, "msg-2")).toEqual([])

        // The dedupe also recognizes edit/apply_patch parts that recorded
        // discovered instructions (ADR-219 wiring).
        expect(await InstructionPrompt.resolve(messagesWithLoaded("edit", [rulePath]), target, "msg-3")).toEqual([])
        expect(await InstructionPrompt.resolve(messagesWithLoaded("apply_patch", [rulePath]), target, "msg-4")).toEqual(
          [],
        )

        // A non-matching file never injects the rule.
        expect(await InstructionPrompt.resolve([], path.join(tmp.path, "src", "foo.ts"), "msg-5")).toEqual([])
      },
    })
  })

  test("still injects the rule when the target also discovers a nested AGENTS.md", async () => {
    await using tmp = await tmpdir({
      git: true,
      config: { username: "testuser" },
      init: async (dir) => {
        await writeRules(dir)
        await fs.mkdir(path.join(dir, "nested"), { recursive: true })
        await fs.writeFile(path.join(dir, "nested", "AGENTS.md"), "# Nested instructions")
        await fs.writeFile(path.join(dir, "nested", "dep.test.ts"), "test content")
      },
    })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const results = await InstructionPrompt.resolve([], path.join(tmp.path, "nested", "dep.test.ts"), "msg-1")
        const files = results.map((r) => path.basename(r.filepath)).sort()
        expect(files).toEqual(["AGENTS.md", "ts-tests.md"])
      },
    })
  })

  test("warns with file and count when a rule contains hidden Unicode", async () => {
    await using tmp = await tmpdir({
      git: true,
      config: { username: "testuser" },
      init: async (dir) => {
        await fs.mkdir(path.join(dir, ".ax-code", "rules"), { recursive: true })
        await fs.writeFile(
          path.join(dir, ".ax-code", "rules", "bidi.md"),
          '---\npaths: ["**/*.ts"]\n---\nvisible\u202Ereorder\u200Bzero-width',
        )
        await fs.writeFile(path.join(dir, "plain.ts"), "content")
      },
    })
    const warn = vi.spyOn(Log.create({ service: "instruction" }), "warn")
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const results = await InstructionPrompt.resolve([], path.join(tmp.path, "plain.ts"), "msg-1")
        // Advisory only (ADR-206): the content still loads verbatim.
        expect(results.length).toBe(1)
        expect(results[0]!.content).toContain("visible\u202Ereorder\u200Bzero-width")
      },
    })
    expect(warn).toHaveBeenCalledWith("instruction file contains hidden Unicode characters", {
      path: path.join(tmp.path, ".ax-code", "rules", "bidi.md"),
      count: 2,
    })
  })
})

describe("path rules on write (ADR-219)", () => {
  const ctx = {
    sessionID: SessionID.make("ses_instruction-rules"),
    messageID: MessageID.make(""),
    callID: "",
    agent: "build",
    abort: AbortSignal.any([]),
    messages: [],
    metadata: () => {},
    ask: async () => {},
  } as any

  test("write injects the matching rule and records it in loaded metadata", async () => {
    await using tmp = await projectWithRules()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const write = await WriteTool.init()
        const result = await write.execute(
          { filePath: path.join(tmp.path, "src", "new.test.ts"), content: "test body" },
          ctx,
        )
        expect(result.output).toContain("<system-reminder>")
        expect(result.output).toContain(RULES_BODY)
        expect(result.metadata.loaded).toEqual([path.join(tmp.path, ".ax-code", "rules", "ts-tests.md")])
      },
    })
  })

  test("write of a non-matching file injects nothing", async () => {
    await using tmp = await projectWithRules()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const write = await WriteTool.init()
        const result = await write.execute({ filePath: path.join(tmp.path, "src", "plain.ts"), content: "body" }, ctx)
        expect(result.output).not.toContain("<system-reminder>")
        expect(result.metadata.loaded).toEqual([])
      },
    })
  })
})

test("evicts cached rule bodies under file churn without dropping matching rules", async () => {
  await using tmp = await tmpdir({
    git: true,
    config: { username: "testuser" },
    init: async (dir) => {
      await fs.mkdir(path.join(dir, ".ax-code", "rules"), { recursive: true })
      await fs.writeFile(
        path.join(dir, ".ax-code", "rules", "original.md"),
        '---\npaths: ["src/**"]\n---\nOriginal rule',
      )
    },
  })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const original = path.join(tmp.path, ".ax-code", "rules", "original.md")
      const reads = vi.spyOn(Filesystem, "readText")
      const target = path.join(tmp.path, "src", "file.ts")
      expect(await InstructionPrompt.matchingPathRules(target)).toHaveLength(1)
      await Promise.all(
        Array.from({ length: 512 }, (_, index) =>
          fs.writeFile(
            path.join(tmp.path, ".ax-code", "rules", `new-${index}.md`),
            '---\npaths: ["src/**"]\n---\nNew rule',
          ),
        ),
      )
      expect(await InstructionPrompt.matchingPathRules(target)).toHaveLength(513)
      expect(await InstructionPrompt.matchingPathRules(target)).toHaveLength(513)
      expect(reads.mock.calls.filter(([file]) => file === original).length).toBeGreaterThan(1)
    },
  })
})

test("ignores a rules directory symlink that escapes the worktree", async () => {
  await using tmp = await tmpdir({ git: true, config: { username: "testuser" } })
  await using outside = await tmpdir()
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const outsideRules = path.join(outside.path, "rules")
      await fs.mkdir(outsideRules, { recursive: true })
      await fs.writeFile(path.join(outsideRules, "leak.md"), '---\npaths: ["src/**"]\n---\nEscaped rule')
      await fs.mkdir(path.join(tmp.path, ".ax-code"), { recursive: true })
      await fs.symlink(
        outsideRules,
        path.join(tmp.path, ".ax-code", "rules"),
        process.platform === "win32" ? "junction" : "dir",
      )
      const target = path.join(tmp.path, "src", "file.ts")
      expect(await InstructionPrompt.matchingPathRules(target)).toEqual([])
    },
  })
})

test("matches rules for a worktree file whose name starts with two dots", async () => {
  await using tmp = await tmpdir({
    git: true,
    config: { username: "testuser" },
    init: async (dir) => {
      await fs.mkdir(path.join(dir, ".ax-code", "rules"), { recursive: true })
      await fs.writeFile(path.join(dir, ".ax-code", "rules", "dotty.md"), '---\npaths: ["**"]\n---\nDot rule')
    },
  })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const target = path.join(tmp.path, "..notes.md")
      expect(await InstructionPrompt.matchingPathRules(target)).toHaveLength(1)
    },
  })
})
