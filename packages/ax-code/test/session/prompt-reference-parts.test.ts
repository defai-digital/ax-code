import { afterEach, describe, expect, test, vi } from "vitest"
import path from "path"
import { writeFile, mkdir } from "fs/promises"
import { resolvePromptParts, type ReferenceRunners } from "../../src/session/prompt/prompt-reference-parts"
import { Instance } from "../../src/project/instance"
import { tmpdir } from "../fixture/fixture"

function makeRunners(overrides: Partial<ReferenceRunners> = {}): ReferenceRunners {
  return {
    runGit: vi.fn(async () => ""),
    fetchUrl: vi.fn(async () => ""),
    ...overrides,
  }
}

afterEach(async () => {
  await Instance.disposeAll()
  vi.unstubAllEnvs()
})

describe("resolvePromptParts ADR-236 forms", () => {
  test("plain template without @-references returns just the text part", async () => {
    const parts = await resolvePromptParts("hello world", { runners: makeRunners() })
    expect(parts).toEqual([{ type: "text", text: "hello world" }])
  })

  test("@diff expands via injected git runner", async () => {
    const runners = makeRunners({
      runGit: vi.fn(async (args) => {
        expect(args).toEqual(["diff", "--no-color"])
        return "diff --git a/x b/x\n+added line\n-removed line\n"
      }),
    })
    const parts = await resolvePromptParts("see @diff please", { runners })
    expect(parts[0]).toEqual({ type: "text", text: "see @diff please" })
    expect(parts[1].type).toBe("text")
    expect(parts[1].text).toContain("+added line")
    expect((runners.runGit as ReturnType<typeof vi.fn>).mock.calls[0][0]).toEqual(["diff", "--no-color"])
  })

  test("@staged runs git diff --cached", async () => {
    const seen: string[][] = []
    const runners = makeRunners({
      runGit: vi.fn(async (args) => {
        seen.push(args)
        return ""
      }),
    })
    const parts = await resolvePromptParts("@staged", { runners })
    expect(parts[1].type).toBe("text")
    expect(parts[1].text).toContain("is empty")
    expect(seen).toEqual([["diff", "--cached", "--no-color"]])
  })

  test("@git:N runs git log -n N -p", async () => {
    const seen: string[][] = []
    const runners = makeRunners({
      runGit: vi.fn(async (args) => {
        seen.push(args)
        return "commit abc\nAuthor: a\n\n    message\n+ line\n"
      }),
    })
    const parts = await resolvePromptParts("@git:3 summary", { runners })
    expect(parts[1].type).toBe("text")
    expect(parts[1].text).toContain("+ line")
    expect(seen).toEqual([["log", "-n", "3", "-p", "--no-color"]])
  })

  test("@git:N clamps N to at most 10", async () => {
    const seen: string[][] = []
    const runners = makeRunners({
      runGit: vi.fn(async (args) => {
        seen.push(args)
        return ""
      }),
    })
    await resolvePromptParts("@git:999", { runners })
    expect(seen[0]).toEqual(["log", "-n", "10", "-p", "--no-color"])
  })

  test("@file:range reads the bounded slice from a real file", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const target = path.join(tmp.path, "src", "x.ts")
        await mkdir(path.dirname(target), { recursive: true })
        await writeFile(target, ["a", "b", "c", "d", "e", "f", "g"].join("\n"))
        const parts = await resolvePromptParts(`see @file:${target}:3-5`)
        expect(parts[1].type).toBe("text")
        // Only lines 3-5 should appear; lines 1,2 and 6,7 must not.
        const bodyOnly = parts[1].text.replace(/<file_range[^>]*>\n/, "").replace(/\n<\/file_range>$/, "")
        const bodyLines = bodyOnly.split("\n")
        expect(bodyLines).toEqual(["c", "d", "e"])
      },
    })
  })

  test("@file:range bounds long UTF-8 lines after a streamed prefix", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const target = path.join(tmp.path, "large.txt")
        await writeFile(target, "skip\n".repeat(20000) + "a".repeat(30 * 1024 - 1) + "😀".repeat(50000))
        const parts = await resolvePromptParts(`@file:${target}:20001`)
        const body = parts[1].text.replace(/<file_range[^>]*>\n/, "").split("\n[truncated:")[0]
        expect(body).toBe("a".repeat(30 * 1024 - 1))
        expect(parts[1].text).toContain("[truncated:")
      },
    })
  })

  test("@file:range with start past EOF becomes an inline note", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const target = path.join(tmp.path, "tiny.txt")
        await writeFile(target, "one\ntwo")
        const parts = await resolvePromptParts(`@file:${target}:99`)
        expect(parts[1].type).toBe("text")
        expect(parts[1].text).toMatch(/out of range/)
      },
    })
  })

  test("@file:range resolves relative paths against the worktree", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        await writeFile(path.join(tmp.path, "rel.txt"), "one\ntwo")
        const parts = await resolvePromptParts(`@file:rel.txt:2`)
        expect(parts[1].text).toContain("two")
      },
    })
  })

  test("@file:range refuses a file outside the workspace", async () => {
    await using tmp = await tmpdir({ git: true })
    await using outside = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const secret = path.join(outside.path, "secret.txt")
        await writeFile(secret, "top secret")
        const parts = await resolvePromptParts(`@file:${secret}:1`)
        expect(parts[1].type).toBe("text")
        expect(parts[1].text).toMatch(/outside the workspace/)
        expect(parts[1].text).not.toContain("top secret")
      },
    })
  })

  test("@url fetches through the injected fetcher and wraps as untrusted", async () => {
    const fetchUrl = vi.fn(async (href: string) => {
      expect(href).toBe("https://example.com/api")
      return "external content that should be wrapped as untrusted by the tool"
    })
    const runners = makeRunners({ fetchUrl })
    const parts = await resolvePromptParts(`fetch @url:https://example.com/api now`, { runners })
    expect(parts[1].type).toBe("text")
    expect(parts[1].text).toMatch(/^<untrusted_content source="@url">/)
    expect(parts[1].text).toContain("external content")
    expect(fetchUrl).toHaveBeenCalledTimes(1)
  })

  test("@url fetch failure becomes an inline note, never an error", async () => {
    const runners = makeRunners({
      fetchUrl: vi.fn(async () => {
        throw new Error("boom")
      }),
    })
    const parts = await resolvePromptParts(`@url:https://example.com/api`, { runners })
    expect(parts[1].type).toBe("text")
    expect(parts[1].text).toMatch(/failed: boom/)
  })

  test("git runner failure becomes an inline note", async () => {
    const runners = makeRunners({
      runGit: vi.fn(async () => {
        throw new Error("no git")
      }),
    })
    const parts = await resolvePromptParts(`@diff`, { runners })
    expect(parts[1].type).toBe("text")
    expect(parts[1].text).toMatch(/failed: no git/)
  })

  test("expansion is capped at 30 KB with an inline truncation note", async () => {
    const big = "x".repeat(40 * 1024)
    const runners = makeRunners({ runGit: vi.fn(async () => big) })
    const parts = await resolvePromptParts(`@git:1`, { runners })
    expect(parts[1].type).toBe("text")
    expect(parts[1].text).toContain("[truncated:")
    // First 30 KB of the body, then the trailing note. The note starts with
    // `\n[truncated: …` so the byte count up to the `[` is at most
    // 30 KB + 1 for the newline.
    const idx = parts[1].text.indexOf("[truncated:")
    expect(Buffer.byteLength(parts[1].text.slice(0, idx), "utf8")).toBeLessThanOrEqual(30 * 1024 + 1)
  })

  test("multibyte expansions are capped by bytes, not code units", async () => {
    const big = "字".repeat(20 * 1024)
    const runners = makeRunners({ runGit: vi.fn(async () => big) })
    const parts = await resolvePromptParts(`@git:1`, { runners })
    const idx = parts[1].text.indexOf("[truncated:")
    expect(idx).toBeGreaterThan(0)
    expect(Buffer.byteLength(parts[1].text.slice(0, idx), "utf8")).toBeLessThanOrEqual(30 * 1024 + 1)
  })

  test("keeps a UTF-8 boundary at the reference byte cap", async () => {
    const parts = await resolvePromptParts("@diff", {
      runners: makeRunners({ runGit: async () => "a".repeat(30 * 1024 - 1) + "😀" }),
    })
    const body = parts[1].text.split("\n[truncated:")[0]
    expect(body).not.toContain("\uFFFD")
    expect(Buffer.byteLength(body)).toBeLessThanOrEqual(30 * 1024)
  })

  test("unrecognized @-token falls through to file resolution under Instance", async () => {
    await using tmp = await tmpdir({ git: true, config: { username: "tester" } })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const runners = makeRunners()
        const parts = await resolvePromptParts(`hello @nonexistent-token`, { runners })
        // The template part is emitted, but no extra part for the unknown reference.
        expect(parts.length).toBe(1)
        expect((runners.runGit as ReturnType<typeof vi.fn>).mock.calls.length).toBe(0)
      },
    })
  })

  test("multiple @-references are all expanded", async () => {
    const seen: string[][] = []
    const runners = makeRunners({
      runGit: vi.fn(async (args) => {
        seen.push(args)
        return `out-${args.join("-")}`
      }),
    })
    const parts = await resolvePromptParts(`a @diff and @staged and @git:2`, { runners })
    expect(parts.length).toBe(4) // template + diff + staged + git
    // args are joined with "-" so leading "--" flags come out as "---" in the body.
    expect(parts[1].text).toContain("out-diff---no-color")
    expect(parts[2].text).toContain("out-diff---cached---no-color")
    expect(parts[3].text).toContain("out-log--n-2--p---no-color")
  })
})
