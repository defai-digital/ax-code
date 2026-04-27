import { Slug } from "@ax-code/util/slug"
import path from "path"
import { BusEvent } from "@/bus/bus-event"
import { Bus } from "@/bus"
import z from "zod"
import { type ProviderMetadata } from "ai"
import { Config } from "../config/config"
import { Flag } from "../flag/flag"
import { Installation } from "../installation"

import { Database, NotFoundError, eq, and, or, gte, isNull, desc, like, inArray, lt } from "../storage/db"
import type { SQL } from "../storage/db"
import { SessionTable, MessageTable, PartTable } from "./session.sql"
import { ProjectTable } from "../project/project.sql"
import { Storage } from "@/storage/storage"
import { Log } from "../util/log"
import { MessageV2 } from "./message-v2"
import { Instance } from "../project/instance"
import { SessionPrompt } from "./prompt"
import { SelfCorrection } from "./correction"
import { fn } from "@/util/fn"
import { Command } from "../command"
import { Snapshot } from "@/snapshot"
import { ProjectID } from "../project/schema"
import { SessionID, MessageID, PartID } from "./schema"

import type { Provider } from "@/provider/provider"
import { ModelID, ProviderID } from "@/provider/schema"
import { Permission } from "@/permission"
import { Global } from "@/global"
import type { LanguageModelV2Usage } from "@ai-sdk/provider"

export namespace Session {
  const log = Log.create({ service: "session" })

  const parentTitlePrefix = "New session - "
  const childTitlePrefix = "Child session - "

  function createDefaultTitle(isChild = false) {
    return (isChild ? childTitlePrefix : parentTitlePrefix) + new Date().toISOString()
  }

  // Pre-compiled at module init. Previously `isDefaultTitle` built a
  // fresh RegExp on every call, which showed up in session list/route
  // hot paths.
  const DEFAULT_TITLE_RE = new RegExp(
    `^(${parentTitlePrefix}|${childTitlePrefix})\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}\\.\\d{3}Z$`,
  )

  export function isDefaultTitle(title: string) {
    return DEFAULT_TITLE_RE.test(title)
  }

  // Escape SQL LIKE metacharacters so a user search string containing
  // `%` or `_` matches those characters literally. Without this, a
  // search for `%` matches all sessions and `_` matches any single
  // character — not a SQL injection (Drizzle parameterizes the value)
  // but a semantic-injection bug that changes query behavior.
  function escapeLike(input: string) {
    return input.replace(/[\\%_]/g, "\\$&")
  }

  type SessionRow = typeof SessionTable.$inferSelect

  function parseRow(row: SessionRow) {
    const summary =
      row.summary_additions !== null || row.summary_deletions !== null || row.summary_files !== null
        ? {
            additions: row.summary_additions ?? 0,
            deletions: row.summary_deletions ?? 0,
            files: row.summary_files ?? 0,
            diffs: row.summary_diffs ?? undefined,
          }
        : undefined
    const share = row.share_url ? { url: row.share_url } : undefined
    const revert = row.revert ?? undefined
    const next = Info.safeParse({
      id: row.id,
      slug: row.slug,
      projectID: row.project_id,
      directory: row.directory,
      parentID: row.parent_id ?? undefined,
      title: row.title,
      version: row.version,
      summary,
      share,
      revert,
      permission: row.permission ?? undefined,
      time: {
        created: row.time_created,
        updated: row.time_updated,
        compacting: row.time_compacting ?? undefined,
        archived: row.time_archived ?? undefined,
      },
    })
    if (next.success) return next.data
    log.error("invalid session row — session will not appear in list views", {
      sessionID: row.id,
      issues: next.error.issues.map((i) => ({
        path: i.path.join("."),
        code: i.code,
        message: i.message,
      })),
    })
  }

  /** Count of sessions skipped due to schema validation failures in the most recent list call. */
  export let lastSkippedCount = 0

  export function fromRow(row: SessionRow): Info {
    const next = parseRow(row)
    if (next) return next
    throw new Error(`Invalid session row: ${row.id}`)
  }

  export function safe(row: SessionRow) {
    return parseRow(row)
  }

  export function toRow(info: Info) {
    return {
      id: info.id,
      project_id: info.projectID,
      parent_id: info.parentID,
      slug: info.slug,
      directory: info.directory,
      title: info.title,
      version: info.version,
      share_url: info.share?.url,
      summary_additions: info.summary?.additions,
      summary_deletions: info.summary?.deletions,
      summary_files: info.summary?.files,
      summary_diffs: info.summary?.diffs,
      revert: info.revert ?? null,
      permission: info.permission,
      time_created: info.time.created,
      time_updated: info.time.updated,
      time_compacting: info.time.compacting,
      time_archived: info.time.archived,
    }
  }

  function getForkedTitle(title: string): string {
    const match = title.match(/^(.+) \(fork #(\d+)\)$/)
    if (match) {
      const base = match[1]
      const num = parseInt(match[2], 10)
      return `${base} (fork #${num + 1})`
    }
    return `${title} (fork #1)`
  }

  export const Info = z
    .object({
      id: SessionID.zod,
      slug: z.string(),
      projectID: ProjectID.zod,
      directory: z.string(),
      parentID: SessionID.zod.optional(),
      summary: z
        .object({
          additions: z.number(),
          deletions: z.number(),
          files: z.number(),
          diffs: Snapshot.FileDiff.array().optional(),
        })
        .optional(),
      share: z
        .object({
          url: z.string(),
        })
        .optional(),
      title: z.string(),
      version: z.string(),
      time: z.object({
        created: z.number(),
        updated: z.number(),
        compacting: z.number().optional(),
        archived: z.number().optional(),
      }),
      permission: Permission.Ruleset.optional(),
      revert: z
        .object({
          messageID: MessageID.zod,
          partID: PartID.zod.optional(),
          snapshot: z.string().optional(),
          diff: z.string().optional(),
        })
        .optional(),
    })
    .meta({
      ref: "Session",
    })
  export type Info = z.output<typeof Info>

  export const ProjectInfo = z
    .object({
      id: ProjectID.zod,
      name: z.string().optional(),
      worktree: z.string(),
    })
    .meta({
      ref: "ProjectSummary",
    })
  export type ProjectInfo = z.output<typeof ProjectInfo>

  export const GlobalInfo = Info.extend({
    project: ProjectInfo.nullable(),
  }).meta({
    ref: "GlobalSession",
  })
  export type GlobalInfo = z.output<typeof GlobalInfo>

  export const Event = {
    Created: BusEvent.define(
      "session.created",
      z.object({
        info: Info,
      }),
    ),
    Updated: BusEvent.define(
      "session.updated",
      z.object({
        info: Info,
      }),
    ),
    Deleted: BusEvent.define(
      "session.deleted",
      z.object({
        info: Info,
      }),
    ),
    Diff: BusEvent.define(
      "session.diff",
      z.object({
        sessionID: SessionID.zod,
        diff: Snapshot.FileDiff.array(),
      }),
    ),
    Error: BusEvent.define(
      "session.error",
      z.object({
        sessionID: SessionID.zod.optional(),
        error: MessageV2.Assistant.shape.error,
      }),
    ),
  }

  export const create = fn(
    z
      .object({
        parentID: SessionID.zod.optional(),
        title: z.string().optional(),
        permission: Info.shape.permission,
      })
      .optional(),
    async (input) => {
      return createNext({
        parentID: input?.parentID,
        directory: Instance.directory,
        title: input?.title,
        permission: input?.permission,
      })
    },
  )

  export const fork = fn(
    z.object({
      sessionID: SessionID.zod,
      messageID: MessageID.zod.optional(),
    }),
    async (input) => {
      const original = await get(input.sessionID)
      if (!original) throw new Error("session not found")
      const title = getForkedTitle(original.title)
      const session = await createNext({
        directory: Instance.directory,
        title,
        permission: original.permission,
      })
      const msgs = await messages({ sessionID: input.sessionID })
      const idMap = new Map<string, MessageID>()

      // Pre-compute all new IDs
      const filtered = msgs.filter((msg) => !(input.messageID && msg.info.id >= input.messageID))
      for (const msg of filtered) {
        idMap.set(msg.info.id, MessageID.ascending())
      }

      // Pre-compute the full insert plan so we can commit every message and
      // every part in a single atomic transaction. If anything throws
      // mid-fork (process crash, I/O error), SQLite rolls back and no
      // partial session is left behind — the previous loop issued one
      // auto-commit write per message/part, so a crash after the first few
      // messages left an un-resumable half-fork.
      const plan = filtered
        .filter((msg) => {
          if (msg.info.role === "assistant" && msg.info.parentID && !idMap.has(msg.info.parentID)) return false
          return true
        })
        .map((msg) => {
          const newID = idMap.get(msg.info.id)
          if (!newID) throw new Error(`message ${msg.info.id} missing from session fork id map`)
          const parentID = msg.info.role === "assistant" && msg.info.parentID ? idMap.get(msg.info.parentID) : undefined
          const info = {
            ...msg.info,
            sessionID: session.id,
            id: newID,
            ...(parentID && { parentID }),
          } as MessageV2.Info
          const parts = msg.parts.map(
            (part) =>
              ({
                ...part,
                id: PartID.ascending(),
                messageID: newID,
                sessionID: session.id,
              }) as MessageV2.Part,
          )
          return { info, parts }
        })

      Database.transaction((db) => {
        for (const { info } of plan) {
          const { id, sessionID, ...data } = info
          db.insert(MessageTable)
            .values({ id, session_id: sessionID, time_created: info.time.created, data })
            .onConflictDoUpdate({ target: MessageTable.id, set: { data } })
            .run()
        }
        const partTime = Date.now()
        for (const { parts } of plan) {
          for (const part of parts) {
            const { id, messageID, sessionID, ...data } = part
            db.insert(PartTable)
              .values({ id, message_id: messageID, session_id: sessionID, time_created: partTime, data })
              .onConflictDoUpdate({ target: PartTable.id, set: { data } })
              .run()
          }
        }
      })

      // Publish events after the transaction commits so subscribers never
      // observe a partial fork.
      for (const { info, parts } of plan) {
        await Bus.publish(MessageV2.Event.Updated, { info })
        for (const part of parts) {
          await Bus.publish(MessageV2.Event.PartUpdated, { part })
        }
      }

      return session
    },
  )

  export const touch = fn(SessionID.zod, async (sessionID) => {
    const now = Date.now()
    Database.use((db) => {
      const row = db
        .update(SessionTable)
        .set({ time_updated: now })
        .where(eq(SessionTable.id, sessionID))
        .returning()
        .get()
      if (!row) throw new NotFoundError({ message: `Session not found: ${sessionID}` })
      const info = fromRow(row)
      Database.effect(() => Bus.publishDetached(Event.Updated, { info }))
    })
  })

  export async function createNext(input: {
    id?: SessionID
    title?: string
    parentID?: SessionID
    directory: string
    permission?: Permission.Ruleset
  }) {
    const result: Info = {
      id: SessionID.descending(input.id),
      slug: Slug.create(),
      version: Installation.VERSION,
      projectID: Instance.project.id,
      directory: input.directory,
      parentID: input.parentID,
      title: input.title ?? createDefaultTitle(!!input.parentID),
      permission: input.permission,
      time: {
        created: Date.now(),
        updated: Date.now(),
      },
    }
    log.info("created", result)
    Database.use((db) => {
      db.insert(SessionTable).values(toRow(result)).run()
      Database.effect(() =>
        Bus.publishDetached(Event.Created, {
          info: result,
        }),
      )
    })
    const cfg = await Config.get()
    if (!result.parentID && (Flag.AX_CODE_AUTO_SHARE || cfg.share === "auto"))
      share(result.id).catch((e) => {
        log.warn("auto-share failed for session", { sessionID: result.id, error: e })
      })
    // Event.Created already fired in the transaction above — skip redundant Updated
    return result
  }

  export function plan(input: { slug: string; time: { created: number } }) {
    const base = Instance.project.vcs
      ? path.join(Instance.worktree, ".ax-code", "plans")
      : path.join(Global.Path.data, "plans")
    return path.join(base, [input.time.created, input.slug].join("-") + ".md")
  }

  export const get = fn(SessionID.zod, async (id) => {
    const row = Database.use((db) => db.select().from(SessionTable).where(eq(SessionTable.id, id)).get())
    if (!row) throw new NotFoundError({ message: `Session not found: ${id}` })
    const next = parseRow(row)
    if (!next) throw new NotFoundError({ message: `Session not found: ${id}` })
    return next
  })

  export const share = fn(SessionID.zod, async (id) => {
    const cfg = await Config.get()
    if (cfg.share === "disabled") {
      throw new Error("Sharing is disabled in configuration")
    }
    const { ShareNext } = await import("@/share/share-next")
    const share = await ShareNext.create(id)
    Database.use((db) => {
      const row = db.update(SessionTable).set({ share_url: share.url }).where(eq(SessionTable.id, id)).returning().get()
      if (!row) throw new NotFoundError({ message: `Session not found: ${id}` })
      const info = fromRow(row)
      Database.effect(() => Bus.publishDetached(Event.Updated, { info }))
    })
    return share
  })

  export const unshare = fn(SessionID.zod, async (id) => {
    // Use ShareNext to remove the share (same as share function uses ShareNext to create)
    const { ShareNext } = await import("@/share/share-next")
    await ShareNext.remove(id)
    Database.use((db) => {
      const row = db.update(SessionTable).set({ share_url: null }).where(eq(SessionTable.id, id)).returning().get()
      if (!row) throw new NotFoundError({ message: `Session not found: ${id}` })
      const info = fromRow(row)
      Database.effect(() => Bus.publishDetached(Event.Updated, { info }))
    })
  })

  function updateAndPublish(sessionID: SessionID, fields: Record<string, unknown>): Info {
    return Database.use((db) => {
      const row = db.update(SessionTable).set(fields).where(eq(SessionTable.id, sessionID)).returning().get()
      if (!row) throw new NotFoundError({ message: `Session not found: ${sessionID}` })
      const info = fromRow(row)
      Database.effect(() => Bus.publishDetached(Event.Updated, { info }))
      return info
    })
  }

  export const setTitle = fn(z.object({ sessionID: SessionID.zod, title: z.string().min(1) }), async (input) =>
    updateAndPublish(input.sessionID, { title: input.title }),
  )

  export const setArchived = fn(z.object({ sessionID: SessionID.zod, time: z.number().optional() }), async (input) =>
    updateAndPublish(input.sessionID, { time_archived: input.time, time_updated: Date.now() }),
  )

  export const setPermission = fn(
    z.object({ sessionID: SessionID.zod, permission: Permission.Ruleset }),
    async (input) => updateAndPublish(input.sessionID, { permission: input.permission, time_updated: Date.now() }),
  )

  export const setRevert = fn(
    z.object({ sessionID: SessionID.zod, revert: Info.shape.revert, summary: Info.shape.summary }),
    async (input) =>
      updateAndPublish(input.sessionID, {
        revert: input.revert ?? null,
        summary_additions: input.summary?.additions,
        summary_deletions: input.summary?.deletions,
        summary_files: input.summary?.files,
        time_updated: Date.now(),
      }),
  )

  export const clearRevert = fn(SessionID.zod, async (sessionID) =>
    updateAndPublish(sessionID, { revert: null, time_updated: Date.now() }),
  )

  export const setSummary = fn(z.object({ sessionID: SessionID.zod, summary: Info.shape.summary }), async (input) =>
    updateAndPublish(input.sessionID, {
      summary_additions: input.summary?.additions,
      summary_deletions: input.summary?.deletions,
      summary_files: input.summary?.files,
      time_updated: Date.now(),
    }),
  )

  export const diff = fn(SessionID.zod, async (sessionID) =>
    Storage.read<Snapshot.FileDiff[]>(["session_diff", sessionID]).catch((err) => {
      // NotFound is expected — sessions without recorded diffs return [].
      if (Storage.NotFoundError.isInstance(err)) return []
      // Any other error (corrupt JSON, I/O, permission) must propagate so
      // the caller can decide how to handle it. Do NOT overwrite the file
      // with [] — that permanently destroys recoverable diff history on
      // transient errors.
      log.error("session diff read failed", { sessionID, err })
      throw err
    }),
  )

  export const messages = fn(
    z.object({
      sessionID: SessionID.zod,
      limit: z.number().optional(),
    }),
    async (input) => {
      const result = [] as MessageV2.WithParts[]
      for await (const msg of MessageV2.stream(input.sessionID)) {
        if (input.limit && result.length >= input.limit) break
        result.push(msg)
      }
      result.reverse()
      return result
    },
  )

  export function* list(input?: {
    directory?: string
    roots?: boolean
    start?: number
    search?: string
    limit?: number
  }) {
    const project = Instance.project
    const conditions = [eq(SessionTable.project_id, project.id)]
    if (input?.directory) {
      conditions.push(eq(SessionTable.directory, input.directory))
    }
    if (input?.roots) {
      conditions.push(isNull(SessionTable.parent_id))
    }
    if (input?.start) {
      conditions.push(gte(SessionTable.time_updated, input.start))
    }
    if (input?.search) {
      conditions.push(like(SessionTable.title, `%${escapeLike(input.search)}%`))
    }

    const limit = input?.limit ?? 100

    const rows = Database.use((db) =>
      db
        .select()
        .from(SessionTable)
        .where(and(...conditions))
        .orderBy(desc(SessionTable.time_updated))
        .limit(limit)
        .all(),
    )
    let skipped = 0
    for (const row of rows) {
      const next = parseRow(row)
      if (next) yield next
      else skipped++
    }
    lastSkippedCount = skipped
    if (skipped > 0) {
      log.warn("sessions skipped due to schema validation failure", { skipped })
    }
  }

  export function* listGlobal(input?: {
    directory?: string
    roots?: boolean
    start?: number
    cursor?: number
    search?: string
    limit?: number
    archived?: boolean
  }) {
    const conditions: SQL[] = []

    if (input?.directory) {
      conditions.push(eq(SessionTable.directory, input.directory))
    }
    if (input?.roots) {
      conditions.push(isNull(SessionTable.parent_id))
    }
    if (input?.start) {
      conditions.push(gte(SessionTable.time_updated, input.start))
    }
    if (input?.cursor) {
      conditions.push(lt(SessionTable.time_updated, input.cursor))
    }
    if (input?.search) {
      conditions.push(like(SessionTable.title, `%${escapeLike(input.search)}%`))
    }
    if (!input?.archived) {
      conditions.push(isNull(SessionTable.time_archived))
    }

    const limit = input?.limit ?? 100

    const rows = Database.use((db) => {
      const query =
        conditions.length > 0
          ? db
              .select()
              .from(SessionTable)
              .where(and(...conditions))
          : db.select().from(SessionTable)
      return query.orderBy(desc(SessionTable.time_updated), desc(SessionTable.id)).limit(limit).all()
    })

    const ids = [...new Set(rows.map((row) => row.project_id))]
    const projects = new Map<string, ProjectInfo>()

    if (ids.length > 0) {
      const items = Database.use((db) =>
        db
          .select({ id: ProjectTable.id, name: ProjectTable.name, worktree: ProjectTable.worktree })
          .from(ProjectTable)
          .where(inArray(ProjectTable.id, ids))
          .all(),
      )
      for (const item of items) {
        projects.set(item.id, {
          id: item.id,
          name: item.name ?? undefined,
          worktree: item.worktree,
        })
      }
    }

    let skipped = 0
    for (const row of rows) {
      const next = parseRow(row)
      if (!next) {
        skipped++
        continue
      }
      const project = projects.get(row.project_id) ?? null
      yield { ...next, project }
    }
    lastSkippedCount = skipped
    if (skipped > 0) {
      log.warn("sessions skipped due to schema validation failure", { skipped })
    }
  }

  export const children = fn(SessionID.zod, async (parentID) => {
    const project = Instance.project
    const rows = Database.use((db) =>
      db
        .select()
        .from(SessionTable)
        .where(and(eq(SessionTable.project_id, project.id), eq(SessionTable.parent_id, parentID)))
        .all(),
    )
    return rows.flatMap((row) => {
      const next = parseRow(row)
      return next ? [next] : []
    })
  })

  export const remove = fn(SessionID.zod, async (sessionID) => {
    const session = await get(sessionID)
    // Collect descendants and delete them inside the same transaction to
    // avoid a TOCTOU window where a new child session created between
    // collection and deletion becomes an orphan.
    const allDescendants: Info[] = []
    Database.transaction((db) => {
      const ids = [sessionID]
      while (ids.length > 0) {
        const parentID = ids.pop()!
        const rows = db
          .select()
          .from(SessionTable)
          .where(and(eq(SessionTable.project_id, Instance.project.id), eq(SessionTable.parent_id, parentID)))
          .all()
        for (const row of rows) {
          const next = parseRow(row)
          if (!next) continue
          allDescendants.push(next)
          ids.push(next.id)
        }
      }
      for (const desc of allDescendants) {
        db.delete(SessionTable).where(eq(SessionTable.id, desc.id)).run()
      }
      db.delete(SessionTable).where(eq(SessionTable.id, sessionID)).run()
    })
    // Publish events after the transaction commits so subscribers never
    // observe a deletion event while the rows are still present.
    for (const desc of allDescendants) {
      Database.effect(() => Bus.publishDetached(Event.Deleted, { info: desc }))
    }
    Database.effect(() => Bus.publishDetached(Event.Deleted, { info: session }))
    const items = [...allDescendants, session]
    for (const item of items) {
      await unshare(item.id).catch((e) => log.warn("session unshare failed", { sessionID: item.id, error: e }))
    }
    for (const desc of allDescendants) {
      SelfCorrection.reset(desc.id)
      await SessionPrompt.cancel(desc.id).catch((e) =>
        log.warn("session cancel failed", { sessionID: desc.id, error: e }),
      )
    }
    SelfCorrection.reset(sessionID)
    await SessionPrompt.cancel(sessionID).catch((e) => log.warn("session cancel failed", { sessionID, error: e }))
  })

  /**
   * Prune sessions older than `ttlDays`. Returns the count of pruned
   * sessions. Uses `time_updated` (not `time_created`) so active
   * sessions are never pruned regardless of age.
   */
  export async function pruneExpired(ttlDays: number): Promise<number> {
    const cutoff = Date.now() - ttlDays * 24 * 60 * 60 * 1000
    const project = Instance.project
    const rows = Database.use((db) =>
      db
        .select({ id: SessionTable.id })
        .from(SessionTable)
        .where(and(eq(SessionTable.project_id, project.id), lt(SessionTable.time_updated, cutoff)))
        .all(),
    )
    for (const row of rows) {
      await remove(row.id as SessionID).catch((err) => log.warn("prune remove failed", { id: row.id, err }))
    }
    if (rows.length > 0) log.info("session prune completed", { pruned: rows.length, ttlDays })
    return rows.length
  }

  export const updateMessage = fn(MessageV2.Info, async (msg) => {
    const time_created = msg.time.created
    const { id, sessionID, ...data } = msg
    Database.use((db) => {
      db.insert(MessageTable)
        .values({
          id,
          session_id: sessionID,
          time_created,
          data,
        })
        .onConflictDoUpdate({ target: MessageTable.id, set: { data } })
        .run()
      Database.effect(() =>
        Bus.publishDetached(MessageV2.Event.Updated, {
          info: msg,
        }),
      )
    })
    return msg
  })

  export const removeMessage = fn(
    z.object({
      sessionID: SessionID.zod,
      messageID: MessageID.zod,
    }),
    async (input) => {
      // CASCADE delete handles parts automatically
      Database.use((db) => {
        db.delete(MessageTable)
          .where(and(eq(MessageTable.id, input.messageID), eq(MessageTable.session_id, input.sessionID)))
          .run()
        Database.effect(() =>
          Bus.publishDetached(MessageV2.Event.Removed, {
            sessionID: input.sessionID,
            messageID: input.messageID,
          }),
        )
      })
      return input.messageID
    },
  )

  export const removePart = fn(
    z.object({
      sessionID: SessionID.zod,
      messageID: MessageID.zod,
      partID: PartID.zod,
    }),
    async (input) => {
      Database.use((db) => {
        db.delete(PartTable)
          .where(
            and(
              eq(PartTable.id, input.partID),
              eq(PartTable.session_id, input.sessionID),
              eq(PartTable.message_id, input.messageID),
            ),
          )
          .run()
        Database.effect(() =>
          Bus.publishDetached(MessageV2.Event.PartRemoved, {
            sessionID: input.sessionID,
            messageID: input.messageID,
            partID: input.partID,
          }),
        )
      })
      return input.partID
    },
  )

  const UpdatePartInput = MessageV2.Part

  export const updatePart = fn(UpdatePartInput, async (part) => {
    const { id, messageID, sessionID, ...data } = part
    const time = Date.now()
    Database.use((db) => {
      db.insert(PartTable)
        .values({
          id,
          message_id: messageID,
          session_id: sessionID,
          time_created: time,
          data,
        })
        .onConflictDoUpdate({ target: PartTable.id, set: { data } })
        .run()
      Database.effect(() =>
        Bus.publishDetached(MessageV2.Event.PartUpdated, {
          part: { ...part },
        }),
      )
    })
    return part
  })

  export const updatePartDelta = fn(
    z.object({
      sessionID: SessionID.zod,
      messageID: MessageID.zod,
      partID: PartID.zod,
      field: z.string(),
      delta: z.string().max(100_000),
    }),
    async (input) => {
      const part = Database.use((db) =>
        db
          .select({ id: PartTable.id })
          .from(PartTable)
          .where(
            and(
              eq(PartTable.id, input.partID),
              eq(PartTable.session_id, input.sessionID),
              eq(PartTable.message_id, input.messageID),
            ),
          )
          .get(),
      )
      if (!part) throw new NotFoundError({ message: `Part not found: ${input.partID}` })
      Bus.publishDetached(MessageV2.Event.PartDelta, input)
    },
  )

  export const getUsage = fn(
    z.object({
      model: z.custom<Provider.Model>(),
      usage: z.custom<LanguageModelV2Usage>(),
      metadata: z.custom<ProviderMetadata>().optional(),
    }),
    (input) => {
      const safe = (value: unknown): number => {
        if (typeof value === "number" && Number.isFinite(value)) return value
        if (value && typeof value === "object" && "total" in value) return safe((value as { total: unknown }).total)
        return 0
      }
      const inputTokens = safe(input.usage?.inputTokens ?? 0)
      const outputTokens = safe(input.usage?.outputTokens ?? 0)
      const reasoningTokens = safe(input.usage?.reasoningTokens ?? 0)

      const cacheReadInputTokens = safe(input.usage?.cachedInputTokens ?? 0)

      const anthropicMeta = (input.metadata as Record<string, unknown>)?.["anthropic"] as
        | Record<string, number>
        | undefined
      const cacheWriteInputTokens = safe(
        (anthropicMeta?.["cacheCreationInputTokens"] ??
          // @ts-expect-error
          input.metadata?.["venice"]?.["usage"]?.["cacheCreationInputTokens"] ??
          0) as number,
      )

      // Anthropic already reports NET input tokens (excluding cached). Other providers report
      // total (including cached), so we subtract cache tokens to get net for those.
      // Also, Anthropic's totalTokens excludes cache tokens, so we add them back.
      const adjustedInputTokens = anthropicMeta
        ? safe(inputTokens)
        : Math.max(0, safe(inputTokens - cacheReadInputTokens - cacheWriteInputTokens))

      const rawTotal = anthropicMeta
        ? (input.usage.totalTokens ?? 0) + cacheReadInputTokens + cacheWriteInputTokens
        : input.usage.totalTokens
      const total = rawTotal != null && Number.isFinite(rawTotal) ? rawTotal : undefined

      const tokens = {
        total,
        input: adjustedInputTokens,
        output: outputTokens,
        reasoning: reasoningTokens,
        cache: {
          write: cacheWriteInputTokens,
          read: cacheReadInputTokens,
        },
      }

      return { tokens }
    },
  )

  export class BusyError extends Error {
    constructor(public readonly sessionID: string) {
      super(`Session ${sessionID} is busy`)
    }
  }

  export const initialize = fn(
    z.object({
      sessionID: SessionID.zod,
      modelID: ModelID.zod,
      providerID: ProviderID.zod,
      messageID: MessageID.zod,
    }),
    async (input) => {
      await SessionPrompt.command({
        sessionID: input.sessionID,
        messageID: input.messageID,
        model: input.providerID + "/" + input.modelID,
        command: Command.Default.INIT,
        arguments: "",
      })
    },
  )
}
