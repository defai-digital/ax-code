import { describe, expect, test, beforeEach, afterEach, vi, onTestFinished } from "vitest"
import fs from "node:fs/promises"
import path from "node:path"
import { tmpdir } from "../fixture/fixture"
import { UsageRecord } from "../../src/memory/usage"
import { Curation } from "../../src/memory/curate"
import { recordEntry, listEntries } from "../../src/memory/recorder"
import * as store from "../../src/memory/store"
import { Filesystem } from "../../src/util/filesystem"

const DAY = 24 * 60 * 60 * 1000

function home(projectRoot: string) {
  return path.dirname(path.dirname(UsageRecord.directory(projectRoot)))
}

describe("memory.usage", () => {
  test("records use counts and keeps last_used_at monotonic", async () => {
    await using tmp = await tmpdir()
    const t0 = new Date("2026-01-01T00:00:00Z")
    const t1 = new Date("2026-02-01T00:00:00Z")

    UsageRecord.record(tmp.path, ["memory:feedback/tests"], () => t0)
    await UsageRecord.flush(tmp.path)
    let data = await UsageRecord.read(tmp.path)
    expect(data.entries["memory:feedback/tests"]).toEqual({ last_used_at: t0.toISOString(), use_count: 1 })

    UsageRecord.record(tmp.path, ["memory:feedback/tests"], () => t1)
    await UsageRecord.flush(tmp.path)
    data = await UsageRecord.read(tmp.path)
    expect(data.entries["memory:feedback/tests"]).toEqual({ last_used_at: t1.toISOString(), use_count: 2 })

    // An out-of-order stamp must not move last_used_at backwards.
    UsageRecord.record(tmp.path, ["memory:feedback/tests"], () => t0)
    await UsageRecord.flush(tmp.path)
    data = await UsageRecord.read(tmp.path)
    expect(data.entries["memory:feedback/tests"]?.last_used_at).toBe(t1.toISOString())
    expect(data.entries["memory:feedback/tests"]?.use_count).toBe(3)
  })

  test("scopes records per project and uses atomic writes", async () => {
    await using a = await tmpdir()
    await using b = await tmpdir()
    UsageRecord.record(a.path, ["skill:alpha"])
    UsageRecord.record(b.path, ["skill:beta"])
    await Promise.all([UsageRecord.flush(a.path), UsageRecord.flush(b.path)])

    expect(Object.keys((await UsageRecord.read(a.path)).entries)).toEqual(["skill:alpha"])
    expect(Object.keys((await UsageRecord.read(b.path)).entries)).toEqual(["skill:beta"])
    expect(UsageRecord.directory(a.path)).not.toBe(UsageRecord.directory(b.path))

    // No temp files may survive the atomic write.
    const files = await fs.readdir(UsageRecord.directory(a.path))
    expect(files).toEqual(["usage.json"])
  })

  test("bounds the record to the most recently used entries", async () => {
    await using tmp = await tmpdir()
    const base = new Date("2026-01-01T00:00:00Z").getTime()
    const keys = Array.from({ length: UsageRecord.MAX_ENTRIES + 50 }, (_, i) => `skill:s${i}`)
    for (const [i, key] of keys.entries()) {
      UsageRecord.record(tmp.path, [key], () => new Date(base + i * 1000))
    }
    await UsageRecord.flush(tmp.path)

    const data = await UsageRecord.read(tmp.path)
    const names = Object.keys(data.entries)
    expect(names).toHaveLength(UsageRecord.MAX_ENTRIES)
    // The oldest 50 were evicted; the newest survive.
    expect(names).not.toContain("skill:s0")
    expect(names).toContain(`skill:s${UsageRecord.MAX_ENTRIES + 49}`)
  })

  test("treats a corrupt record as empty instead of throwing", async () => {
    await using tmp = await tmpdir()
    await fs.mkdir(UsageRecord.directory(tmp.path), { recursive: true })
    await fs.writeFile(UsageRecord.file(tmp.path), "{not json")

    await expect(UsageRecord.read(tmp.path)).resolves.toEqual({ version: 1, entries: {} })
    UsageRecord.record(tmp.path, ["skill:recover"])
    await expect(UsageRecord.flush(tmp.path)).resolves.toBeUndefined()
  })
})

describe("memory.curate proposals", () => {
  const now = new Date("2026-06-01T00:00:00Z")

  test("proposes entries unused for 90 days and keeps fresh ones", async () => {
    await using tmp = await tmpdir()
    await recordEntry(tmp.path, "feedback", { name: "stale", body: "old rule" })
    await recordEntry(tmp.path, "feedback", { name: "fresh", body: "new rule" })

    // Backdate savedAt directly: entries are keyed by (kind, name), so the
    // usage record is the only other signal.
    const memory = await store.load(tmp.path)
    memory!.sections.feedback!.entries = memory!.sections.feedback!.entries.map((entry) => ({
      ...entry,
      savedAt: entry.name === "stale" ? new Date(now.getTime() - 120 * DAY).toISOString() : now.toISOString(),
    }))
    await store.save(tmp.path, memory!)

    const report = await Curation.proposeMemory({ projectRoot: tmp.path, now: () => now })
    expect(report.proposals.map((p) => p.name)).toEqual(["stale"])
    expect(report.proposals[0]?.rule).toBe("unused")
    expect(report.proposals[0]?.kind).toBe("feedback")
    expect(report.skippedRules).toEqual([])
  })

  async function seed(
    root: string,
    entries: Array<{ name: string; body: string; daysAgo: number; agents?: string[] }>,
  ) {
    for (const entry of entries) await recordEntry(root, "feedback", { name: entry.name, body: entry.body })
    const memory = await store.load(root)
    memory!.sections.feedback!.entries = memory!.sections.feedback!.entries.map((stored) => {
      const spec = entries.find((entry) => entry.name === stored.name)!
      return {
        ...stored,
        savedAt: new Date(now.getTime() - spec.daysAgo * DAY).toISOString(),
        ...(spec.agents ? { agents: spec.agents } : {}),
      }
    })
    await store.save(root, memory!)
  }

  test("topicKey ignores separators, case and trailing version, date or old/new words", () => {
    expect(Curation.topicKey("Test Command")).toBe("test-command")
    expect(Curation.topicKey("test_command-v2")).toBe("test-command")
    expect(Curation.topicKey("test-command-old")).toBe("test-command")
    expect(Curation.topicKey("deploy-2026-10")).toBe("deploy")
    expect(Curation.topicKey("v2")).toBeUndefined()
    expect(Curation.topicKey("a")).toBeUndefined()
  })

  test("proposes the older of two same-topic entries with different content as superseded", async () => {
    await using tmp = await tmpdir()
    await seed(tmp.path, [
      { name: "test-command-old", body: "run npm test", daysAgo: 20 },
      { name: "test-command", body: "run pnpm test", daysAgo: 2 },
    ])
    const report = await Curation.proposeMemory({ projectRoot: tmp.path, now: () => now })
    expect(report.proposals.map((p) => [p.name, p.rule])).toEqual([["test-command-old", "superseded"]])
    expect(report.proposals[0]?.reason).toContain("test-command")
  })

  test("a superseded proposal replaces the unused one for the same entry", async () => {
    await using tmp = await tmpdir()
    await seed(tmp.path, [
      { name: "style-v1", body: "tabs", daysAgo: 200 },
      { name: "style-v2", body: "spaces", daysAgo: 1 },
    ])
    const report = await Curation.proposeMemory({ projectRoot: tmp.path, now: () => now })
    expect(report.proposals.map((p) => [p.name, p.rule])).toEqual([["style-v1", "superseded"]])
  })

  test("same content, different agents, same timestamp, or different topics are never superseded", async () => {
    await using tmp = await tmpdir()
    await seed(tmp.path, [
      { name: "alpha-v1", body: "same body", daysAgo: 10 },
      { name: "alpha-v2", body: "same   body", daysAgo: 1 },
      { name: "beta-v1", body: "one", daysAgo: 10, agents: ["build"] },
      { name: "beta-v2", body: "two", daysAgo: 1, agents: ["plan"] },
      { name: "gamma-v1", body: "one", daysAgo: 5 },
      { name: "gamma-v2", body: "two", daysAgo: 5 },
      { name: "delta", body: "one", daysAgo: 10 },
      { name: "epsilon", body: "two", daysAgo: 1 },
    ])
    const report = await Curation.proposeMemory({ projectRoot: tmp.path, now: () => now })
    expect(report.proposals).toEqual([])
  })

  test("apply removes only the superseded entry and undo restores it", async () => {
    await using tmp = await tmpdir()
    await seed(tmp.path, [
      { name: "build-old", body: "run make", daysAgo: 20 },
      { name: "build", body: "run pnpm build", daysAgo: 1 },
    ])
    const report = await Curation.proposeMemory({ projectRoot: tmp.path, now: () => now })
    const proposal = report.proposals[0]!
    const options = { projectRoot: tmp.path, now: () => now }
    const record = await Curation.apply(options, {
      id: proposal.id,
      kind: proposal.kind!,
      name: proposal.name,
      scope: proposal.scope,
    })
    expect(record.name).toBe("build-old")
    store._resetReadCache()
    expect((await listEntries(tmp.path)).map((entry) => entry.name)).toEqual(["build"])
    await Curation.undo(options, proposal.id)
    store._resetReadCache()
    expect((await listEntries(tmp.path)).map((entry) => entry.name).sort()).toEqual(["build", "build-old"])
  })

  test("prefers the usage record over savedAt", async () => {
    await using tmp = await tmpdir()
    await recordEntry(tmp.path, "decisions", { name: "recent", body: "decided" })
    const memory = await store.load(tmp.path)
    memory!.sections.decisions!.entries[0]!.savedAt = new Date(now.getTime() - 200 * DAY).toISOString()
    await store.save(tmp.path, memory!)

    UsageRecord.record(tmp.path, [UsageRecord.memoryKey("decisions", "recent")], () => now)
    await UsageRecord.flush(tmp.path)

    const report = await Curation.proposeMemory({ projectRoot: tmp.path, now: () => now })
    expect(report.proposals).toEqual([])
    expect(report.checked).toBe(1)
  })

  test("proposes skills that are unused, never invoked, or duplicated", async () => {
    await using tmp = await tmpdir()
    const old = path.join(tmp.path, "old-skill.md")
    const young = path.join(tmp.path, "young-skill.md")
    await fs.writeFile(old, "# old")
    await fs.writeFile(young, "# young")
    const oldTime = new Date(now.getTime() - 120 * DAY)
    await fs.utimes(old, oldTime, oldTime)

    UsageRecord.record(tmp.path, ["skill:used"], () => oldTime)
    await UsageRecord.flush(tmp.path)

    const report = await Curation.proposeSkills({
      projectRoot: tmp.path,
      now: () => now,
      skills: [
        { name: "used", location: old, scope: "project" },
        { name: "fresh-file", location: young, scope: "project" },
        { name: "stale-file", location: old, scope: "project" },
      ],
      duplicateNames: new Set(["stale-file"]),
    })

    const byName = new Map(report.proposals.map((p) => [p.name, p]))
    expect([...byName.keys()].sort()).toEqual(["stale-file", "used"])
    expect(byName.get("used")?.rule).toBe("unused")
    expect(byName.get("stale-file")?.rule).toBe("duplicate_name")
    expect(byName.has("fresh-file")).toBe(false)
  })
})

describe("memory.curate apply/undo", () => {
  beforeEach(() => {
    store._resetReadCache()
  })

  afterEach(() => {
    store._resetReadCache()
  })

  test("apply removes an entry and undo restores it byte for byte", async () => {
    await using tmp = await tmpdir()
    await recordEntry(tmp.path, "userPrefs", {
      name: "language",
      body: "Reply in English",
      why: "user asked",
      tags: ["comms"],
    })
    const before = (await listEntries(tmp.path, "userPrefs"))[0]!

    const record = await Curation.apply(
      { projectRoot: tmp.path },
      { id: "mem-project-userprefs-language", kind: "userPrefs", name: "language", scope: "project" },
    )
    expect(record.target).toBe("memory")
    expect(await listEntries(tmp.path, "userPrefs")).toEqual([])

    await Curation.undo({ projectRoot: tmp.path }, record.id)
    const restored = (await listEntries(tmp.path, "userPrefs"))[0]
    expect(restored).toEqual(before)
  })

  test("concurrent applies keep every undo record", async () => {
    await using tmp = await tmpdir()
    const names = ["alpha", "beta", "gamma", "delta"]
    for (const name of names) await recordEntry(tmp.path, "userPrefs", { name, body: `body ${name}` })
    // Widen the read-modify-write window on applied.json.
    const writeJson = Filesystem.writeJson.bind(Filesystem)
    const spy = vi.spyOn(Filesystem, "writeJson").mockImplementation(async (file, data, ...rest) => {
      if (String(file).endsWith("applied.json")) await new Promise((resolve) => setTimeout(resolve, 50))
      return writeJson(file, data, ...rest)
    })
    onTestFinished(() => spy.mockRestore())

    await Promise.all(
      names.map((name) =>
        Curation.apply(
          { projectRoot: tmp.path },
          { id: `mem-project-userprefs-${name}`, kind: "userPrefs", name, scope: "project" },
        ),
      ),
    )

    for (const name of names) await Curation.undo({ projectRoot: tmp.path }, `mem-project-userprefs-${name}`)
    expect((await listEntries(tmp.path, "userPrefs")).map((entry) => entry.name).sort()).toEqual([...names].sort())
  })

  test("concurrent undos of one record restore it once and report one success", async () => {
    await using tmp = await tmpdir()
    await recordEntry(tmp.path, "userPrefs", { name: "solo", body: "only once" })
    const record = await Curation.apply(
      { projectRoot: tmp.path },
      { id: "mem-project-userprefs-solo", kind: "userPrefs", name: "solo", scope: "project" },
    )

    const results = await Promise.allSettled([
      Curation.undo({ projectRoot: tmp.path }, record.id),
      Curation.undo({ projectRoot: tmp.path }, record.id),
    ])
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1)
    expect(await listEntries(tmp.path, "userPrefs")).toHaveLength(1)
  })

  test("an undo claim left by a crashed undo is retryable once stale", async () => {
    await using tmp = await tmpdir()
    await recordEntry(tmp.path, "userPrefs", { name: "crashy", body: "restore me" })
    const record = await Curation.apply(
      { projectRoot: tmp.path },
      { id: "mem-project-userprefs-crashy", kind: "userPrefs", name: "crashy", scope: "project" },
    )
    const file = path.join(UsageRecord.directory(tmp.path), "applied.json")
    const claim = async (at: string) => {
      const data = JSON.parse(await fs.readFile(file, "utf8"))
      data.records[0].undoingAt = at
      await fs.writeFile(file, JSON.stringify(data))
    }

    await claim(new Date().toISOString())
    await expect(Curation.undo({ projectRoot: tmp.path }, record.id)).rejects.toThrow("in progress")

    await claim(new Date(Date.now() - 60 * 60 * 1000).toISOString())
    await expect(Curation.undo({ projectRoot: tmp.path }, record.id)).resolves.toMatchObject({ id: record.id })
    expect((await listEntries(tmp.path, "userPrefs")).map((entry) => entry.name)).toEqual(["crashy"])
    const stored = JSON.parse(await fs.readFile(file, "utf8")).records[0]
    expect(stored.undoneAt).toBeDefined()
    expect(stored.undoingAt).toBeUndefined()
  })

  test("proposals are read-only and apply requires an existing id", async () => {
    await using tmp = await tmpdir()
    await recordEntry(tmp.path, "feedback", { name: "keep", body: "keep me" })

    const report = await Curation.proposeMemory({ projectRoot: tmp.path })
    expect(report.proposals).toEqual([])
    expect(await listEntries(tmp.path, "feedback")).toHaveLength(1)

    await expect(
      Curation.apply(
        { projectRoot: tmp.path },
        { id: "mem-project-feedback-missing", kind: "feedback", name: "missing", scope: "project" },
      ),
    ).rejects.toThrow(/not found/)
    expect(await listEntries(tmp.path, "feedback")).toHaveLength(1)
  })

  test("undo without a matching applied record throws", async () => {
    await using tmp = await tmpdir()
    await expect(Curation.undo({ projectRoot: tmp.path }, "mem-project-feedback-nope")).rejects.toThrow(/no applied/)
  })

  async function makeSkill(root: string, name: string) {
    const directory = path.join(root, ".ax-code", "skills", name)
    await fs.mkdir(directory, { recursive: true })
    await fs.writeFile(path.join(directory, "SKILL.md"), `---\nname: ${name}\ndescription: test\n---\nbody\n`)
    await fs.writeFile(path.join(directory, "extra.txt"), "keep me")
    return { directory, location: path.join(directory, "SKILL.md") }
  }

  test("applying a skill proposal archives the whole directory and undo restores it", async () => {
    await using tmp = await tmpdir()
    const skill = await makeSkill(tmp.path, "unused")
    const record = await Curation.apply(
      { projectRoot: tmp.path },
      { id: "skill-project-unused", kind: "", name: "unused", scope: "project", location: skill.location },
    )
    expect(record.target).toBe("skill")
    // Moved, not deleted: gone from the project, present in the state directory.
    await expect(fs.stat(skill.directory)).rejects.toThrow()
    const archivedTo = (record.after as { archivedTo: string }).archivedTo
    expect(archivedTo.startsWith(tmp.path)).toBe(false)
    expect(await fs.readFile(path.join(archivedTo, "extra.txt"), "utf8")).toBe("keep me")

    const undone = await Curation.undo({ projectRoot: tmp.path }, "skill-project-unused")
    expect(undone.undoneAt).toBeTruthy()
    expect(await fs.readFile(path.join(skill.directory, "extra.txt"), "utf8")).toBe("keep me")
    // A second undo finds nothing live to revert.
    await expect(Curation.undo({ projectRoot: tmp.path }, "skill-project-unused")).rejects.toThrow(/no applied/)
  })

  test("undo refuses to overwrite a directory that reappeared at the original location", async () => {
    await using tmp = await tmpdir()
    const skill = await makeSkill(tmp.path, "again")
    await Curation.apply(
      { projectRoot: tmp.path },
      { id: "skill-project-again", kind: "", name: "again", scope: "project", location: skill.location },
    )
    await makeSkill(tmp.path, "again")
    await expect(Curation.undo({ projectRoot: tmp.path }, "skill-project-again")).rejects.toThrow(/already exists/)
  })

  test("skills outside the project and a missing location are never archived", async () => {
    await using tmp = await tmpdir()
    await using other = await tmpdir()
    const foreign = await makeSkill(other.path, "foreign")
    await expect(
      Curation.apply(
        { projectRoot: tmp.path },
        { id: "skill-global-foreign", kind: "", name: "foreign", scope: "global", location: foreign.location },
      ),
    ).rejects.toThrow(/inside this project/)
    await expect(
      Curation.apply({ projectRoot: tmp.path }, { id: "skill-project-x", kind: "", name: "x", scope: "project" }),
    ).rejects.toThrow(/location is required/)
    expect((await fs.stat(foreign.directory)).isDirectory()).toBe(true)
  })

  test("usage and applied records live under the project state directory", async () => {
    await using tmp = await tmpdir()
    await recordEntry(tmp.path, "feedback", { name: "x", body: "y" })
    await Curation.apply(
      { projectRoot: tmp.path },
      { id: "mem-project-feedback-x", kind: "feedback", name: "x", scope: "project" },
    )
    const files = await fs.readdir(UsageRecord.directory(tmp.path))
    expect(files).toContain("applied.json")
    // The state dir is outside the project tree.
    expect(UsageRecord.directory(tmp.path).startsWith(tmp.path)).toBe(false)
  })
})
