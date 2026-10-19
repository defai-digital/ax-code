// Read-only curation proposals for memory entries and skills (ADR-249).
//
// Nothing here runs in the background and nothing calls a model. `propose`
// only reads; `apply` and `undo` run only from the explicit CLI flags and
// always leave a before/after record so a change can be reversed.
import fs from "fs/promises"
import path from "path"
import z from "zod"
import { Filesystem } from "@/util/filesystem"
import { FileLock } from "@/util/filelock"
import { Lock } from "@/util/lock"
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
    rule: z.enum(["unused", "duplicate_name", "superseded"]),
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
    /** Set while an undo is restoring; a stale claim (crashed undo) is retryable. */
    undoingAt: z.string().optional(),
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

  // apply and undo can run from separate processes (CLI and Desktop). An
  // unserialized read-modify-write of applied.json lets the later writer drop
  // the earlier record, which then can never be undone.
  async function updateApplied<T>(projectRoot: string, fn: (data: AppliedFile) => T): Promise<T> {
    const file = recordFile(projectRoot)
    using _process = await Lock.write(file)
    using _crossProcess = await FileLock.acquire(file)
    const data = await readApplied(projectRoot)
    const result = fn(data)
    await writeApplied(projectRoot, data)
    return result
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
   * "superseded" is the contradiction rule. It is deterministic and conservative: within one scope
   * and kind, two entries with the same topic key (the name lower-cased, separators ignored and
   * trailing version, date or old/new words dropped), the same agents and path globs, and different
   * bodies conflict. The older one is proposed for removal in favour of the newer one. Bodies are
   * never interpreted, so unrelated entries are never flagged.
   */
  const TOPIC_NOISE = /^(v?\d+|old|new|legacy|deprecated|draft|final|current|latest|previous|prev|updated|copy)$/

  /** Stable topic key for contradiction matching; undefined when the name carries no topic. */
  export function topicKey(name: string): string | undefined {
    const tokens = name
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter(Boolean)
    while (tokens.length > 1 && TOPIC_NOISE.test(tokens[tokens.length - 1]!)) tokens.pop()
    const key = tokens.join("-")
    return key.length >= 3 ? key : undefined
  }

  const normalizeBody = (value: string) => value.replace(/\s+/g, " ").trim()
  const listKey = (values?: string[]) => [...(values ?? [])].sort().join("\u0000")

  export async function proposeMemory(opts: Options): Promise<Report> {
    const now = (opts.now ?? (() => new Date()))()
    const scope = opts.scope ?? "project"
    const usage = await UsageRecord.read(opts.projectRoot)
    const applied = new Set((await readApplied(opts.projectRoot)).records.filter((r) => !r.undoneAt).map((r) => r.id))
    const scopes: ("project" | "global")[] = scope === "all" ? ["project", "global"] : [scope]
    const proposals = new Map<string, Proposal>()
    let checked = 0

    for (const current of scopes) {
      const memory = current === "global" ? await store.loadGlobal() : await store.load(opts.projectRoot)
      if (!memory) continue
      for (const kind of kinds) {
        const entries = memory.sections[kind]?.entries ?? []
        const groups = new Map<string, MemoryEntry[]>()
        for (const entry of entries) {
          const key = topicKey(entry.name)
          if (!key) continue
          const group = `${key}\u0000${listKey(entry.agents)}\u0000${listKey(entry.pathGlobs)}`
          groups.set(group, [...(groups.get(group) ?? []), entry])
        }
        for (const group of groups.values()) {
          if (group.length < 2) continue
          const dated = group
            .map((entry) => ({ entry, time: Date.parse(entry.savedAt) }))
            .filter((item) => Number.isFinite(item.time))
            .sort((a, b) => b.time - a.time)
          const newest = dated[0]
          if (!newest) continue
          for (const older of dated.slice(1)) {
            if (older.time === newest.time) continue
            if (normalizeBody(older.entry.body) === normalizeBody(newest.entry.body)) continue
            const id = memoryId(kind, current, older.entry.name)
            const usageEntry = usage.entries[UsageRecord.memoryKey(kind, older.entry.name)]
            proposals.set(id, {
              id,
              target: "memory",
              rule: "superseded",
              kind,
              name: older.entry.name,
              scope: current,
              reason: `superseded by newer entry "${newest.entry.name}" on the same topic with different content`,
              last_used_at: usageEntry?.last_used_at ?? null,
              use_count: usageEntry?.use_count ?? 0,
              applied: applied.has(id),
            })
          }
        }
        for (const entry of entries) {
          checked++
          const usageEntry = usage.entries[UsageRecord.memoryKey(kind, entry.name)]
          const last = usageEntry?.last_used_at ?? entry.savedAt
          const age = ageDays(last, now)
          if (age === undefined || age < STALE_DAYS) continue
          if (proposals.has(memoryId(kind, current, entry.name))) continue
          const source = usageEntry ? `last used ${age} days ago` : `never injected and saved ${age} days ago`
          proposals.set(memoryId(kind, current, entry.name), {
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
      proposals: [...proposals.values()],
      skippedRules: [],
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
      await moveDirectory(directory, archivedTo)
      const record: AppliedRecord = {
        id: params.id,
        target: "skill",
        name: params.name,
        scope: params.scope,
        appliedAt: now.toISOString(),
        before: { directory, location },
        after: { archivedTo },
      }
      await updateApplied(opts.projectRoot, (data) => data.records.push(record)).catch(async (error) => {
        // Without the record the archive cannot be undone; put the skill back.
        await moveDirectory(archivedTo, directory).catch((rollback) => {
          throw rollbackFailed(error, rollback, `the skill remains archived at ${archivedTo}`)
        })
        throw error
      })
      return record
    }

    const kind = params.kind as MemoryEntryKind
    // Reuse the recorder so the per-file write lock and metrics stay correct.
    // The undo snapshot is the entry as removed under that lock, so a write
    // that lands between a lookup and the removal is not lost on undo.
    const { takeEntry } = await import("./recorder")
    const entry = await takeEntry(opts.projectRoot, kind, params.name, params.scope)
    if (!entry) throw new Error(`memory entry not found: ${kind}/${params.name}`)

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
    await updateApplied(opts.projectRoot, (data) => data.records.push(record)).catch(async (error) => {
      // Without the record the removal cannot be undone; restore the entry.
      await restoreMemoryEntry(opts.projectRoot, record).catch((rollback) => {
        throw rollbackFailed(error, rollback, `memory entry ${kind}/${entry.name} stays removed`)
      })
      throw error
    })
    return record
  }

  async function restoreMemoryEntry(projectRoot: string, record: AppliedRecord) {
    const entry = record.before as MemoryEntry
    const { recordEntry } = await import("./recorder")
    await recordEntry(projectRoot, record.kind as MemoryEntryKind, {
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
      // Keep the original savedAt so the entry does not look freshly
      // reviewed; set under the recorder's write lock, not a second save.
      restoreSavedAt: entry.savedAt,
    })
  }

  // Archive moves can cross devices (project on a mounted volume, state on the
  // boot volume), so every direction falls back from rename to copy + remove.
  async function moveDirectory(from: string, to: string) {
    await fs.mkdir(path.dirname(to), { recursive: true })
    try {
      await fs.rename(from, to)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EXDEV") throw error
      await fs.cp(from, to, { recursive: true, errorOnExist: true, force: false })
      await fs.rm(from, { recursive: true })
    }
  }

  function rollbackFailed(error: unknown, rollback: unknown, detail: string) {
    return new Error(
      `${error instanceof Error ? error.message : String(error)}; rollback also failed (${detail}): ${
        rollback instanceof Error ? rollback.message : String(rollback)
      }`,
      { cause: error },
    )
  }

  /** Restore the entry removed by `apply`. Returns the record that was undone. */
  // An undo claim older than this belongs to a process that died mid-restore.
  const UNDO_CLAIM_STALE_MS = 5 * 60 * 1000

  export async function undo(opts: Options, id: string): Promise<AppliedRecord> {
    // Claim the record under the applied.json lock before restoring, so two
    // concurrent undos cannot both restore the same change. The claim is an
    // intermediate state: only a completed restore sets undoneAt, and a claim
    // left by a crashed undo becomes retryable once stale.
    const record = await updateApplied(opts.projectRoot, (data) => {
      const found = [...data.records].reverse().find((item) => item.id === id && !item.undoneAt)
      if (!found) throw new Error(`no applied proposal with id: ${id}`)
      if (found.undoingAt && Date.now() - new Date(found.undoingAt).getTime() < UNDO_CLAIM_STALE_MS)
        throw new Error(`undo already in progress for: ${id}`)
      // Stamped under the lock, so time spent waiting for it cannot age the claim.
      found.undoingAt = new Date().toISOString()
      return { ...found }
    })
    const claimedAt = record.undoingAt
    const settle = (done: boolean) =>
      updateApplied(opts.projectRoot, (data) => {
        const stored = data.records.find(
          (item) => item.id === record.id && item.appliedAt === record.appliedAt && item.undoingAt === claimedAt,
        )
        // The claim is gone only if another undo took it over as stale.
        if (!stored) throw new Error(`undo claim for ${id} was taken over by another undo`)
        delete stored.undoingAt
        if (done) stored.undoneAt = new Date().toISOString()
        return stored.undoneAt
      })

    try {
      if (record.target === "memory") await restoreMemoryEntry(opts.projectRoot, record)

      if (record.target === "skill") {
        const before = record.before as { directory?: string }
        const after = record.after as { archivedTo?: string }
        if (!before.directory || !after.archivedTo) throw new Error("the archive record is incomplete")
        // Only absence counts as missing; any other stat failure must not be
        // read as "already restored".
        const statOrMissing = (target: string) =>
          fs.stat(target).catch((error: NodeJS.ErrnoException) => {
            if (error.code === "ENOENT") return undefined
            throw error
          })
        const archived = await statOrMissing(after.archivedTo)
        const restored = await statOrMissing(before.directory)
        // A crashed undo may already have moved the directory back.
        if (!(restored && !archived)) {
          if (restored) throw new Error(`cannot restore: ${before.directory} already exists`)
          await moveDirectory(after.archivedTo, before.directory)
        }
      }
    } catch (error) {
      // The change was not restored; make the record undoable again.
      await settle(false).catch(() => undefined)
      throw error
    }
    const undoneAt = await settle(true).catch((error) => {
      throw new Error(
        `undo restored ${record.target} ${record.name} but could not record it (${
          error instanceof Error ? error.message : String(error)
        }); rerun undo after the claim expires to record it`,
        { cause: error },
      )
    })
    const { undoingAt: _claim, ...done } = record
    return { ...done, undoneAt }
  }
}
