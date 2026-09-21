import { afterEach, describe, expect, test, vi } from "vitest"
import path from "node:path"
import { mkdir, readFile, symlink } from "node:fs/promises"
import { tmpdir } from "../fixture/fixture"
import { getContext } from "../../src/memory/injector"
import * as store from "../../src/memory/store"
import type { ProjectMemory } from "../../src/memory/types"

function memory(root: string): ProjectMemory {
  return {
    version: 1,
    created: "2026-09-21",
    updated: "2026-09-21",
    projectRoot: root,
    contentHash: "fixture",
    maxTokens: 10000,
    totalTokens: 100,
    sections: {
      feedback: {
        tokens: 20,
        entries: [{ name: "verify", body: "Preserve all verification rules", savedAt: "2026-09-21" }],
      },
      userPrefs: { tokens: 20, entries: [{ name: "style", body: "Keep concise answers", savedAt: "2026-09-21" }] },
      decisions: { tokens: 20, entries: [{ name: "scope", body: "Preserve scope boundaries", savedAt: "2026-09-21" }] },
      reference: {
        tokens: 20,
        entries: [{ name: "source", body: "Use authoritative references", savedAt: "2026-09-21" }],
      },
      structure: { content: "Scanned structure stays available", tokens: 10 },
    },
  }
}

afterEach(() => {
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
  store._resetReadCache()
})

describe("memory injection source identity", () => {
  test("home sessions load a shared store once, retaining every section without rewriting it", async () => {
    await using home = await tmpdir()
    vi.stubEnv("AX_CODE_TEST_HOME", home.path)
    await store.save(home.path, memory(home.path))
    const before = await readFile(store.getMemoryPath(home.path), "utf8")
    const project = vi.spyOn(store, "load")
    const global = vi.spyOn(store, "loadGlobal")
    const context = await getContext(home.path, { agent: "build" })
    for (const text of [
      "Preserve all verification rules",
      "Keep concise answers",
      "Preserve scope boundaries",
      "Use authoritative references",
      "Scanned structure stays available",
    ])
      expect(context.split(text)).toHaveLength(2)
    expect(context).toContain("## Global Settings")
    expect(context).toContain("## Directory Structure")
    expect(project).toHaveBeenCalledTimes(1)
    expect(global).not.toHaveBeenCalled()
    expect(await readFile(store.getMemoryPath(home.path), "utf8")).toBe(before)
  })

  test("symlinked home paths share one store and retain scoped-entry filtering", async () => {
    await using tmp = await tmpdir()
    const home = path.join(tmp.path, "home")
    const alias = path.join(tmp.path, "alias")
    await mkdir(home)
    vi.stubEnv("AX_CODE_TEST_HOME", home)
    const data = memory(home)
    data.sections.feedback!.entries.push({
      name: "private",
      body: "Security only",
      agents: ["security"],
      savedAt: "2026-09-21",
    })
    await store.save(home, data)
    await symlink(home, alias, process.platform === "win32" ? "junction" : "dir")
    const context = await getContext(alias, { agent: "build" })
    expect(context.split("Preserve all verification rules")).toHaveLength(2)
    expect(context).not.toContain("Security only")
    expect(context).toContain("Scanned structure stays available")
  })

  test("equal content in distinct stores keeps both scopes", async () => {
    await using home = await tmpdir()
    await using project = await tmpdir()
    vi.stubEnv("AX_CODE_TEST_HOME", home.path)
    const data = memory(project.path)
    await store.save(project.path, data)
    await store.saveGlobal(data)
    const context = await getContext(project.path)
    expect(context.split("Preserve all verification rules")).toHaveLength(3)
    expect(context).toContain("## Global Settings")
    expect(context).toContain("## Feedback Rules")
  })

  test("missing stores stay empty and updates remain visible", async () => {
    await using home = await tmpdir()
    vi.stubEnv("AX_CODE_TEST_HOME", home.path)
    expect(await getContext(home.path)).toBe("")
    const data = memory(home.path)
    await store.saveGlobal(data)
    expect(await getContext(home.path)).toContain("Keep concise answers")
    data.sections.userPrefs!.entries[0].body = "Updated preference"
    await store.saveGlobal(data)
    const context = await getContext(home.path)
    expect(context.split("Updated preference")).toHaveLength(2)
    expect(context).not.toContain("Keep concise answers")
  })

  test("one unavailable scope preserves the other, including malformed runtime roots", async () => {
    await using home = await tmpdir()
    await using project = await tmpdir()
    vi.stubEnv("AX_CODE_TEST_HOME", home.path)
    await store.saveGlobal(memory(home.path))
    expect(await getContext(project.path)).toContain("## Global Settings")
    expect(await getContext(undefined as unknown as string)).toContain("Keep concise answers")
    await store.clearGlobal()
    await store.save(project.path, memory(project.path))
    const context = await getContext(project.path)
    expect(context).toContain("## Feedback Rules")
    expect(context).not.toContain("## Global Settings")
  })

  test("shared-source filtering and scanned staleness remain intact", async () => {
    await using home = await tmpdir()
    vi.stubEnv("AX_CODE_TEST_HOME", home.path)
    const data = memory(home.path)
    data.sections.structure!.scannedAt = "2000-01-01T00:00:00Z"
    data.sections.feedback!.entries.push(
      { name: "expired", body: "Expired instruction", expiresAt: "2000-01-01T00:00:00Z", savedAt: "1999-01-01" },
      { name: "rust", body: "Rust scoped instruction", pathGlobs: ["**/*.rs"], savedAt: "2026-09-21" },
    )
    await store.save(home.path, data)
    const context = await getContext(home.path, { agent: "build", paths: ["source.ts"] })
    expect(context).not.toContain("Expired instruction")
    expect(context).not.toContain("Rust scoped instruction")
    expect(context).toContain("Scanned structure stays available")
    expect(context).toContain("over 30 days old")
  })
})
