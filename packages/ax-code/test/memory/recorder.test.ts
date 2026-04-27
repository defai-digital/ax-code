import { describe, expect, test } from "bun:test"
import { tmpdir } from "../fixture/fixture"
import { recordEntry, removeEntry, listEntries } from "../../src/memory/recorder"
import { buildContext } from "../../src/memory/injector"
import { generate } from "../../src/memory/generator"
import * as store from "../../src/memory/store"

describe("memory.recorder", () => {
  test("records and lists entries", async () => {
    await using tmp = await tmpdir()

    await recordEntry(tmp.path, "userPrefs", {
      name: "language",
      body: "Reply in Traditional Chinese",
      why: "user preference",
    })
    await recordEntry(tmp.path, "feedback", {
      name: "tests",
      body: "Integration tests must hit a real database",
      why: "mock divergence burned us",
      howToApply: "anywhere we touch test/",
    })

    const userEntries = await listEntries(tmp.path, "userPrefs")
    expect(userEntries).toHaveLength(1)
    expect(userEntries[0]?.name).toBe("language")

    const feedbackEntries = await listEntries(tmp.path, "feedback")
    expect(feedbackEntries[0]?.howToApply).toBe("anywhere we touch test/")

    const all = await listEntries(tmp.path)
    expect(all).toHaveLength(2)
  })

  test("dedupes by name within a kind", async () => {
    await using tmp = await tmpdir()

    await recordEntry(tmp.path, "userPrefs", { name: "language", body: "first" })
    await recordEntry(tmp.path, "userPrefs", { name: "language", body: "second" })

    const entries = await listEntries(tmp.path, "userPrefs")
    expect(entries).toHaveLength(1)
    expect(entries[0]?.body).toBe("second")
  })

  test("removeEntry deletes by name", async () => {
    await using tmp = await tmpdir()

    await recordEntry(tmp.path, "decisions", { name: "auth-rewrite", body: "compliance driven" })
    expect(await removeEntry(tmp.path, "decisions", "auth-rewrite")).toBe(true)
    expect(await listEntries(tmp.path, "decisions")).toHaveLength(0)
    expect(await removeEntry(tmp.path, "decisions", "auth-rewrite")).toBe(false)
  })

  test("buildContext orders feedback first, then user prefs, then decisions", async () => {
    await using tmp = await tmpdir()

    await recordEntry(tmp.path, "userPrefs", { name: "language", body: "TW Chinese" })
    await recordEntry(tmp.path, "feedback", { name: "tests", body: "no mocks", why: "regressions" })
    await recordEntry(tmp.path, "decisions", { name: "auth", body: "rewrite for compliance" })

    const memory = await store.load(tmp.path)
    expect(memory).not.toBeNull()
    const ctx = buildContext(memory!)

    const feedbackIdx = ctx.indexOf("Feedback Rules")
    const userIdx = ctx.indexOf("User Preferences")
    const decisionsIdx = ctx.indexOf("Project Decisions")

    expect(feedbackIdx).toBeGreaterThan(-1)
    expect(userIdx).toBeGreaterThan(feedbackIdx)
    expect(decisionsIdx).toBeGreaterThan(userIdx)
    expect(ctx).toContain("Why: regressions")
  })

  test("generate preserves recorded entries across warmup", async () => {
    await using tmp = await tmpdir()
    await Bun.write(`${tmp.path}/package.json`, JSON.stringify({ name: "pkg", version: "1.0.0" }))

    await recordEntry(tmp.path, "userPrefs", { name: "language", body: "TW Chinese" })

    const fresh = await generate(tmp.path)
    expect(fresh.sections.userPrefs?.entries).toHaveLength(1)
    expect(fresh.sections.userPrefs?.entries[0]?.name).toBe("language")
    expect(fresh.sections.config).toBeDefined()
  })

  test("rejects empty name or body", async () => {
    await using tmp = await tmpdir()
    await expect(recordEntry(tmp.path, "userPrefs", { name: "  ", body: "x" })).rejects.toThrow(/non-empty/)
    await expect(recordEntry(tmp.path, "userPrefs", { name: "x", body: "" })).rejects.toThrow(/non-empty/)
  })

  test("agent-conditional: entries with agents allow-list filter on buildContext", async () => {
    await using tmp = await tmpdir()

    await recordEntry(tmp.path, "feedback", {
      name: "no-mocks",
      body: "Don't mock the database in tests",
      agents: ["test", "debug"],
    })
    await recordEntry(tmp.path, "feedback", {
      name: "lint-clean",
      body: "Always run lint before commit",
      // no agents → applies to all
    })

    const memory = await store.load(tmp.path)
    expect(memory).not.toBeNull()

    const forTest = buildContext(memory!, { agent: "test" })
    expect(forTest).toContain("no-mocks")
    expect(forTest).toContain("lint-clean")

    const forSecurity = buildContext(memory!, { agent: "security" })
    expect(forSecurity).not.toContain("no-mocks")
    expect(forSecurity).toContain("lint-clean")

    const noAgent = buildContext(memory!)
    expect(noAgent).toContain("no-mocks")
    expect(noAgent).toContain("lint-clean")
  })

  test("agent-conditional: empty agents array is treated as 'all'", async () => {
    await using tmp = await tmpdir()
    await recordEntry(tmp.path, "userPrefs", {
      name: "language",
      body: "Reply in TW Chinese",
      agents: [],
    })
    const memory = await store.load(tmp.path)
    const ctx = buildContext(memory!, { agent: "debug" })
    expect(ctx).toContain("language")
  })

  test("budget: large entries shrink scanned sections, totalTokens stays within maxTokens", async () => {
    await using tmp = await tmpdir()
    await Bun.write(
      `${tmp.path}/package.json`,
      JSON.stringify({
        name: "pkg",
        version: "1.0.0",
        scripts: Object.fromEntries(Array.from({ length: 50 }, (_, i) => [`script-${i}`, "echo hi"])),
        dependencies: Object.fromEntries(
          ["react", "next", "drizzle-orm", "zod", "tailwindcss"].map((k) => [k, "1.0.0"]),
        ),
      }),
    )
    await Bun.write(`${tmp.path}/README.md`, "x".repeat(20_000))

    // Record an entry large enough to dominate the small budget
    await recordEntry(tmp.path, "feedback", {
      name: "core",
      body: "y".repeat(800),
    })

    const memory = await generate(tmp.path, { maxTokens: 300 })
    expect(memory.totalTokens).toBeLessThanOrEqual(300)
    // Entry preserved
    expect(memory.sections.feedback?.entries[0]?.body).toContain("y")
    // Scanned sections shrank or got dropped
    const scannedTokens =
      (memory.sections.patterns?.tokens ?? 0) +
      (memory.sections.config?.tokens ?? 0) +
      (memory.sections.structure?.tokens ?? 0) +
      (memory.sections.readme?.tokens ?? 0)
    expect(scannedTokens).toBeLessThanOrEqual(300 - (memory.sections.feedback?.tokens ?? 0))
  })

  test("budget: when entries exceed maxTokens, scanned sections drop entirely", async () => {
    await using tmp = await tmpdir()
    await Bun.write(`${tmp.path}/package.json`, JSON.stringify({ name: "pkg", version: "1.0.0" }))

    await recordEntry(tmp.path, "feedback", { name: "huge", body: "z".repeat(2000) })

    const memory = await generate(tmp.path, { maxTokens: 100 })
    // Entry kept verbatim (user-curated)
    expect(memory.sections.feedback?.entries[0]?.body).toBeTruthy()
    // No scanned sections fit
    expect(memory.sections.patterns).toBeUndefined()
    expect(memory.sections.config).toBeUndefined()
    expect(memory.sections.structure).toBeUndefined()
    expect(memory.sections.readme).toBeUndefined()
  })

  test("budget: tiny maxTokens never overruns even when budget < truncation suffix", async () => {
    await using tmp = await tmpdir()
    await Bun.write(
      `${tmp.path}/package.json`,
      JSON.stringify({
        name: "pkg",
        version: "1.0.0",
        dependencies: { react: "1.0.0", next: "1.0.0", "drizzle-orm": "1.0.0" },
      }),
    )

    for (const max of [1, 2, 3, 4, 5, 10, 20]) {
      const memory = await generate(tmp.path, { maxTokens: max })
      expect(memory.totalTokens).toBeLessThanOrEqual(max)
    }
  })

  test("budget: with no entries, behaves identically to pre-budget logic", async () => {
    await using tmp = await tmpdir()
    await Bun.write(`${tmp.path}/package.json`, JSON.stringify({ name: "pkg", version: "1.0.0" }))

    const memory = await generate(tmp.path, { maxTokens: 4000 })
    expect(memory.totalTokens).toBeLessThanOrEqual(4000)
    expect(memory.sections.config).toBeDefined()
  })

  test("agent-conditional: section header is omitted when no entries apply", async () => {
    await using tmp = await tmpdir()
    await recordEntry(tmp.path, "decisions", {
      name: "internal",
      body: "Architecture decision",
      agents: ["architect"],
    })
    const memory = await store.load(tmp.path)
    const forSecurity = buildContext(memory!, { agent: "security" })
    expect(forSecurity).not.toContain("Project Decisions")
  })
})
