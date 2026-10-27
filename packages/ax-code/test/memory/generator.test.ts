import { describe, expect, test } from "vitest"
import path from "path"
import fs from "fs/promises"
import {
  decodeMemoryPackageJsonValue,
  generate,
  parseMemoryPackageJson,
  saveGenerated,
} from "../../src/memory/generator"
import { listEntries, recordEntry, takeEntry } from "../../src/memory/recorder"
import * as store from "../../src/memory/store"
import { tmpdir } from "../fixture/fixture"

describe("memory.generator", () => {
  test("decodeMemoryPackageJsonValue decodes already-parsed package metadata safely", () => {
    expect(
      decodeMemoryPackageJsonValue({
        name: "pkg",
        version: "1.0.0",
        scripts: { typecheck: "tsc --noEmit", lint: true },
        dependencies: { react: "^19.0.0" },
        devDependencies: { vitest: "^3.0.0" },
      }),
    ).toEqual({
      name: "pkg",
      version: "1.0.0",
      scripts: ["typecheck"],
      dependencies: ["react"],
      devDependencies: ["vitest"],
      allDependencies: ["react", "vitest"],
    })

    expect(decodeMemoryPackageJsonValue(null)).toEqual({
      scripts: [],
      dependencies: [],
      devDependencies: [],
      allDependencies: [],
    })
  })

  test("parseMemoryPackageJson decodes package metadata safely", () => {
    expect(
      parseMemoryPackageJson(
        JSON.stringify({
          name: "pkg",
          version: "1.0.0",
          scripts: { typecheck: "tsc --noEmit", lint: true },
          dependencies: { react: "^19.0.0" },
          devDependencies: { vitest: "^3.0.0" },
        }),
      ),
    ).toEqual({
      name: "pkg",
      version: "1.0.0",
      scripts: ["typecheck"],
      dependencies: ["react"],
      devDependencies: ["vitest"],
      allDependencies: ["react", "vitest"],
    })

    expect(parseMemoryPackageJson(JSON.stringify(null))).toEqual({
      scripts: [],
      dependencies: [],
      devDependencies: [],
      allDependencies: [],
    })
    expect(parseMemoryPackageJson(JSON.stringify({ scripts: [] }))).toEqual({
      scripts: [],
      dependencies: [],
      devDependencies: [],
      allDependencies: [],
    })
    expect(() => parseMemoryPackageJson("{not json")).toThrow(SyntaxError)
  })

  test("generate uses decoded package metadata for config and patterns", async () => {
    await using tmp = await tmpdir()
    await fs.writeFile(
      path.join(tmp.path, "package.json"),
      JSON.stringify({
        name: "pkg",
        version: "1.0.0",
        scripts: { typecheck: "tsc --noEmit", test: false },
        dependencies: { react: "^19.0.0" },
        devDependencies: { vitest: "^3.0.0" },
      }),
    )

    const memory = await generate(tmp.path, { maxTokens: 4000 })

    expect(memory.sections.config?.content).toContain("Name: pkg")
    expect(memory.sections.config?.content).toContain("Version: 1.0.0")
    expect(memory.sections.config?.content).toContain("Scripts: typecheck")
    expect(memory.sections.config?.content).toContain("Dependencies: 1 packages")
    expect(memory.sections.patterns?.content).toContain("Framework: React")
    expect(memory.sections.patterns?.content).toContain("Testing: configured")
  })

  test("keeps a CJK section within the token budget", async () => {
    await using tmp = await tmpdir()
    // 20k CJK characters are ~20k tokens, five times the 4000-token budget; a
    // chars/4 budget let the whole section through un-truncated.
    await fs.writeFile(path.join(tmp.path, "README.md"), "字".repeat(20_000))

    const memory = await generate(tmp.path, { maxTokens: 4000 })

    expect(memory.totalTokens).toBeLessThanOrEqual(4000)
    expect(memory.sections.readme?.tokens ?? 0).toBeLessThanOrEqual(4000)
  })

  test("saveGenerated keeps an entry recorded while the scan was running", async () => {
    await using tmp = await tmpdir()
    await recordEntry(tmp.path, "feedback", { name: "a", body: "existing entry" })

    // generate() snapshots memory.json here, before its project scan.
    const draft = await generate(tmp.path, { maxTokens: 4000 })
    expect(draft.sections.feedback?.entries.map((entry) => entry.name)).toEqual(["a"])

    // A concurrent `memory remember` lands after that snapshot, before the save.
    await recordEntry(tmp.path, "feedback", { name: "b", body: "recorded during the scan" })

    const { memory, savePath } = await saveGenerated(tmp.path, draft)

    expect(savePath).toBe(store.getMemoryPath(tmp.path))
    expect((await listEntries(tmp.path, "feedback")).map((entry) => entry.name).sort()).toEqual(["a", "b"])
    expect(memory.sections.feedback?.entries.map((entry) => entry.name).sort()).toEqual(["a", "b"])

    // The persisted file is the merged memory, not the stale draft.
    const persisted = await store.load(tmp.path)
    expect(persisted?.sections.feedback?.entries.map((entry) => entry.name).sort()).toEqual(["a", "b"])
    expect(persisted?.contentHash).toBe(memory.contentHash)
    expect(persisted?.totalTokens).toBe(memory.totalTokens)
  })

  test("saveGenerated does not resurrect an entry removed during the scan", async () => {
    await using tmp = await tmpdir()
    await recordEntry(tmp.path, "feedback", { name: "a", body: "existing entry" })

    const draft = await generate(tmp.path, { maxTokens: 4000 })
    expect(draft.sections.feedback?.entries).toHaveLength(1)
    expect(await takeEntry(tmp.path, "feedback", "a")).toBeDefined()

    await saveGenerated(tmp.path, draft)

    expect(await listEntries(tmp.path, "feedback")).toEqual([])
  })

  test("saveGenerated racing a recordEntry keeps both entries", async () => {
    await using tmp = await tmpdir()
    await recordEntry(tmp.path, "feedback", { name: "a", body: "existing entry" })

    await Promise.all([
      generate(tmp.path, { maxTokens: 4000 }).then((draft) => saveGenerated(tmp.path, draft)),
      recordEntry(tmp.path, "feedback", { name: "b", body: "racing record" }),
    ])

    expect((await listEntries(tmp.path, "feedback")).map((entry) => entry.name).sort()).toEqual(["a", "b"])
  })
})
