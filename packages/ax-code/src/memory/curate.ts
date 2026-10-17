// Read-only curation proposals for memory entries and skills (ADR-249).
//
// Nothing here runs in the background and nothing calls a model. `propose`
// only reads; `apply` and `undo` run only from the explicit CLI flags and
// always leave a before/after record so a change can be reversed.
import fs from "fs/promises"
import path from "path"
import z from "zod"
import { Filesystem } from "@/util/filesystem"
import { parseJsonResult } from "@/util/json-value"
import { UsageRecord } from "./usage"
import * as store from "./store"
import type { MemoryEntry, MemoryEntryKind } from "./types"

export namespace Curation {
  export const STALE_DAYS = 90
  const DAY_MS = 24 * 60 * 60 * 1000

  export const Proposal = z.object({
    id: z.string(),
    target: z.enum(["memory", "skill"]),
    rule: z.enum(["unused", "duplicate_name"]),
    /** Entry kind for memory proposals; absent for skills. */
    kind: z.string().optional(),
    name: z.string(),
    scope: z.enum(["project", "global"]),
    /** Why the proposal was raised. Static text, never entry content. */
    reason: z.string(),
    last_used_at: z.string().nullable(),
    use_count: z.number().int().nonnegative(),
    /** Status of the last applied change for this proposal, if any. */
    applied: z.boolean(),
    /** SKILL.md path for skill proposals; used only by --apply to archive the skill directory. */
    location: z.string().optional(),
  })
  export type Proposal = z.infer<typeof Proposal>

  export const Report = z.object({
    target: z.enum(["memory", "skill"]),
    thresholdDays: z.number().int(),
    checked: z.number().int(),
    proposals: z.array(Proposal),
    /** Rules that cannot run because the data has no reliable signal. */
    skippedRules: z.array(z.string()),
  })
  export type Report = z.infer<typeof Report>

  export interface Options {
    /** Clock injection for tests. */
    now?: () => Date
    /** Project root whose state dir holds usage and undo records. */
    projectRoot: string
    scope?: "project" | "global" | "all"
  }

  const kinds: MemoryEntryKind[] = ["userPrefs", "feedback", "decisions", "reference"]

  function recordFile(projectRoot: string): string {
    return path.join(UsageRecord.directory(projectRoot), "applied.json")
  }

  const AppliedRecord = z.object({
    id: z.string(),
    target: z.enum(["memory", "skill"]),
    kind: z.string().optional(),
    name: z.string(),
    scope: z.enum(["project", "global"]),
    appliedAt: z.string(),
    before: z.unknown(),
    after: z.unknown(),
    undoneAt: z.string().optional(),
  })
  export type AppliedRecord = z.infer<typeof AppliedRecord>

  const AppliedFile = z.object({
    version: z.literal(1),
    records: z.array(AppliedRecord),
  })
  type AppliedFile = z.infer<typeof AppliedFile>

  async function readApplied(projectRoot: string): Promise<AppliedFile> {
    const text = await Filesystem.readText(recordFile(projectRoot)).catch(() => undefined)
    if (text === undefined) return { version: 1, records: [] }
    const parsed = parseJsonResult(text)
    if (!parsed.ok) return { version: 1, records: [] }
    const result = AppliedFile.safeParse(parsed.value)
    return result.success ? result.data : { version: 1, records: [] }
  }

  async function writeApplied(projectRoot: string, data: AppliedFile): Promise<void> {
    await Filesystem.writeJson(recordFile(projectRoot), data)
  }

  function ageDays(iso: string | undefined | null, now: Date): number | undefined {
    if (!iso) return undefined
    const time = new Date(iso).getTime()
    if (!Number.isFinite(time)) return undefined
    return Math.floor((now.getTime() - time) / DAY_MS)
  }

  function memoryId(kind: string, scope: string, name: string): string {
    return `mem-${scope}-${kind}-${name}`.toLowerCase().replace(/[^a-z0-9-]+/g, "-")
  }

  function skillId(scope: string, name: string): string {
    return `skill-${scope}-${name}`.toLowerCase().replace(/[^a-z0-9-]+/g, "-")
  }

  /**
   * Memory proposals: entries whose last use is older than the threshold,
   * falling back to `savedAt` when the entry was never injected.
   *
   * A "contradicts a newer entry" rule is deliberately NOT implemented:
   * entries are keyed by (kind, name) only, so there is no reliable signal
   * that two entries disagree rather than merely coexist.
   */
  export async function proposeMemory(opts: Options): Promise<Report> {
    const now = (opts.now ?? (() => new Date()))()
    const scope = opts.scope ?? "project"
    const usage = await UsageRecord.read(opts.projectRoot)
    const applied = new Set((await readApplied(opts.projectRoot)).records.filter((r) => !r.undoneAt).map((r) => r.id))
    const scopes: ("project" | "global")[] = scope === "all" ? ["project", "global"] : [scope]
    const proposals: Proposal[] = []
    let checked = 0

    for (const current of scopes) {
      const memory = current === "global" ? await store.loadGlobal() : await store.load(opts.projectRoot)
      if (!memory) continue
      for (const kind of kinds) {
        for (const entry of memory.sections[kind]?.entries ?? []) {
          checked++
          const usageEntry = usage.entries[UsageRecord.memoryKey(kind, entry.name)]
          const last = usageEntry?.last_used_at ?? entry.savedAt
          const age = ageDays(last, now)
          if (age === undefined || age < STALE_DAYS) continue
          const source = usageEntry ? `last used ${age} days ago` : `never injected and saved ${age} days ago`
          proposals.push({
            id: memoryId(kind, current, entry.name),
            target: "memory",
            rule: "unused",
            kind,
            name: entry.name,
            scope: current,
            reason: `${source} (threshold ${STALE_DAYS} days)`,
            last_used_at: usageEntry?.last_used_at ?? null,
            use_count: usageEntry?.use_count ?? 0,
            applied: applied.has(memoryId(kind, current, entry.name)),
          })
        }
      }
    }

    return {
      target: "memory",
      thresholdDays: STALE_DAYS,
      checked,
      proposals,
      skippedRules: ["contradiction: entries are keyed by (kind, name) only, with no reliable contradiction signal"],
    }
  }

  export interface SkillLike {
    name: string
    location: string
    scope?: string
  }

  /** Skill proposals: never invoked within the threshold, or duplicated by name. */
  export async function proposeSkills(
    opts: Options & { skills: SkillLike[]; duplicateNames: Set<string> },
  ): Promise<Report> {
    const now = (opts.now ?? (() => new Date()))()
    const usage = await UsageRecord.read(opts.projectRoot)
    const applied = new Set((await readApplied(opts.projectRoot)).records.filter((r) => !r.undoneAt).map((r) => r.id))
    const proposals: Proposal[] = []
    const checked = opts.skills.length

    for (const skill of opts.skills) {
      const id = skillId(skill.scope ?? "project", skill.name)
      const usageEntry = usage.entries[UsageRecord.skillKey(skill.name)]
      const duplicate = opts.duplicateNames.has(skill.name)
      let reason: string | undefined
      if (duplicate) {
        reason = "skill name is duplicated across scopes; only one definition can be reached by name"
      } else if (usageEntry) {
        const age = ageDays(usageEntry.last_used_at, now)
        if (age !== undefined && age >= STALE_DAYS)
          reason = `last invoked ${age} days ago (threshold ${STALE_DAYS} days)`
      } else {
        // Never invoked: use the skill file age so brand-new skills are not proposed.
        const stat = await fs.stat(skill.location).catch(() => undefined)
        const age = ageDays(stat?.mtime.toISOString(), now)
        if (age !== undefined && age >= STALE_DAYS) reason = `never invoked and file unchanged for ${age} days`
      }
      if (!reason) continue
      proposals.push({
        id,
        target: "skill",
        rule: duplicate ? "duplicate_name" : "unused",
        name: skill.name,
        scope: skill.scope === "global" || skill.scope === "user" ? "global" : "project",
        reason,
        last_used_at: usageEntry?.last_used_at ?? null,
        use_count: usageEntry?.use_count ?? 0,
        applied: applied.has(id),
        location: skill.location,
      })
    }

    return { target: "skill", thresholdDays: STALE_DAYS, checked, proposals, skippedRules: [] }
  }

  /**
   * Apply one proposal by id. Memory entries are removed from the store and
   * the removed entry is kept in the before/after record for `undo`.
   * Skill proposals archive the skill directory (a reversible move into the
   * project state directory) and `undo` moves it back.
   */
  export async function apply(
    opts: Options,
    params: { id: string; kind: string; name: string; scope: "project" | "global"; location?: string },
  ): Promise<AppliedRecord> {
    const now = (opts.now ?? (() => new Date()))()
    const isMemory = params.id.startsWith("mem-")
    if (!isMemory) {
      // Archive the skill directory (a move, never a delete) so it is no longer loaded; undo moves it back.
      // Only skills that live inside this project are touched: user-level and built-in skills are managed
      // outside the project and are never moved from here.
      const location = params.location ? path.resolve(params.location) : undefined
      if (!location) throw new Error("the skill location is required to archive it")
      const directory = path.dirname(location)
      if (
        !Filesystem.contains(path.resolve(opts.projectRoot), directory) ||
        directory === path.resolve(opts.projectRoot)
      )
        throw new Error("only skills that live inside this project can be archived from here")
      const stamp = now.toISOString().replace(/[:.]/g, "-")
      const archivedTo = path.join(UsageRecord.directory(opts.projectRoot), "archive", `${params.id}-${stamp}`)
      await fs.mkdir(path.dirname(archivedTo), { recursive: true })
      try {
        await fs.rename(directory, archivedTo)
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EXDEV") throw error
        await fs.cp(directory, archivedTo, { recursive: true, errorOnExist: true, force: false })
        await fs.rm(directory, { recursive: true })
      }
      const record: AppliedRecord = {
        id: params.id,
        target: "skill",
        name: params.name,
        scope: params.scope,
        appliedAt: now.toISOString(),
        before: { directory, location },
        after: { archivedTo },
      }
      const data = await readApplied(opts.projectRoot)
      data.records.push(record)
      await writeApplied(opts.projectRoot, data)
      return record
    }

    const memory = params.scope === "global" ? await store.loadGlobal() : await store.load(opts.projectRoot)
    const kind = params.kind as MemoryEntryKind
    const entry: MemoryEntry | undefined = memory?.sections[kind]?.entries.find(
      (item) => item.name.toLowerCase() === params.name.toLowerCase(),
    )
    if (!memory || !entry) throw new Error(`memory entry not found: ${kind}/${params.name}`)

    // Reuse the recorder so the per-file write lock and metrics stay correct.
    const { removeEntry } = await import("./recorder")
    const removed = await removeEntry(opts.projectRoot, kind, entry.name, params.scope)
    if (!removed) throw new Error(`memory entry not found: ${kind}/${params.name}`)

    const record: AppliedRecord = {
      id: params.id,
      target: "memory",
      kind,
      name: entry.name,
      scope: params.scope,
      appliedAt: now.toISOString(),
      before: entry,
      after: null,
    }
    const data = await readApplied(opts.projectRoot)
    data.records.push(record)
    await writeApplied(opts.projectRoot, data)
    return record
  }

  /** Restore the entry removed by `apply`. Returns the record that was undone. */
  export async function undo(opts: Options, id: string): Promise<AppliedRecord> {
    const data = await readApplied(opts.projectRoot)
    const record = [...data.records].reverse().find((item) => item.id === id && !item.undoneAt)
    if (!record) throw new Error(`no applied proposal with id: ${id}`)

    if (record.target === "memory") {
      const entry = record.before as MemoryEntry
      const { recordEntry } = await import("./recorder")
      await recordEntry(opts.projectRoot, record.kind as MemoryEntryKind, {
        name: entry.name,
        body: entry.body,
        why: entry.why,
        howToApply: entry.howToApply,
        agents: entry.agents,
        tags: entry.tags,
        pathGlobs: entry.pathGlobs,
        expiresAt: entry.expiresAt,
        confidence: entry.confidence,
        sourceSessionId: entry.sourceSessionId,
        scope: record.scope,
      })
      // recordEntry stamps a fresh savedAt; restore the original one so the
      // entry does not look freshly reviewed.
      const memory = record.scope === "global" ? await store.loadGlobal() : await store.load(opts.projectRoot)
      const section = memory?.sections[record.kind as MemoryEntryKind]
      const restored = section?.entries.find((item) => item.name.toLowerCase() === entry.name.toLowerCase())
      if (memory && restored && restored.savedAt !== entry.savedAt) {
        restored.savedAt = entry.savedAt
        if (record.scope === "global") await store.saveGlobal(memory)
        else await store.save(opts.projectRoot, memory)
      }
    }

    if (record.target === "skill") {
      const before = record.before as { directory?: string }
      const after = record.after as { archivedTo?: string }
      if (!before.directory || !after.archivedTo) throw new Error("the archive record is incomplete")
      if (await fs.stat(before.directory).catch(() => undefined))
        throw new Error(`cannot restore: ${before.directory} already exists`)
      await fs.mkdir(path.dirname(before.directory), { recursive: true })
      try {
        await fs.rename(after.archivedTo, before.directory)
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EXDEV") throw error
        await fs.cp(after.archivedTo, before.directory, { recursive: true, errorOnExist: true, force: false })
        await fs.rm(after.archivedTo, { recursive: true })
      }
    }

    record.undoneAt = new Date().toISOString()
    await writeApplied(opts.projectRoot, data)
    return record
  }
}
