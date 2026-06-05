import z from "zod"
import { HTTPException } from "hono/http-exception"
import { Bus } from "@/bus"
import { BusEvent } from "@/bus/bus-event"
import { Instance } from "@/project/instance"
import { ProjectID } from "@/project/schema"
import { Database, NotFoundError, and, asc, desc, eq, inArray, sql } from "@/storage/db"
import { Log } from "@/util/log"
import { Session } from "."
import { SessionID, TaskQueueID } from "./schema"
import { TaskQueueTable } from "./session.sql"

const log = Log.create({ service: "task-queue" })

export namespace TaskQueue {
  export const Kind = z.enum(["prompt", "command", "shell", "followup", "subagent", "review", "automation"])
  export type Kind = z.infer<typeof Kind>

  export const Status = z.enum([
    "queued",
    "waiting_for_idle",
    "running",
    "blocked_permission",
    "blocked_question",
    "paused",
    "failed",
    "completed",
    "cancelled",
  ])
  export type Status = z.infer<typeof Status>

  export const Payload = z.record(z.string(), z.unknown())
  export type Payload = z.infer<typeof Payload>

  export const Info = z.object({
    id: TaskQueueID.zod,
    projectID: ProjectID.zod,
    directory: z.string(),
    worktree: z.string().optional(),
    sessionID: SessionID.zod.optional(),
    kind: Kind,
    status: Status,
    priority: z.number().int(),
    position: z.number().int().min(0),
    title: z.string(),
    agent: z.string().optional(),
    model: z.unknown().optional(),
    sourceMessageID: z.string().optional(),
    sourceTaskID: z.string().optional(),
    payload: Payload,
    error: z.string().optional(),
    time: z.object({
      created: z.number(),
      updated: z.number().optional(),
      started: z.number().optional(),
      completed: z.number().optional(),
    }),
  })
  export type Info = z.infer<typeof Info>

  export const EnqueueInput = z.object({
    sessionID: SessionID.zod.optional(),
    kind: Kind,
    title: z.string().trim().min(1).max(200),
    worktree: z.string().trim().min(1).max(500).optional(),
    agent: z.string().optional(),
    model: z.unknown().optional(),
    sourceMessageID: z.string().optional(),
    sourceTaskID: z.string().optional(),
    payload: Payload.optional().default({}),
    priority: z.number().int().min(-1000).max(1000).optional().default(0),
  })
  export type EnqueueInput = z.input<typeof EnqueueInput>

  export const ListInput = z.object({
    sessionID: SessionID.zod.optional(),
    status: Status.optional(),
    limit: z.number().int().positive().max(500).optional(),
  })
  export type ListInput = z.infer<typeof ListInput>

  export const ReorderInput = z.object({
    id: TaskQueueID.zod,
    position: z.number().int().min(0),
  })
  export type ReorderInput = z.infer<typeof ReorderInput>

  export const EditBody = z
    .object({
      title: z.string().trim().min(1).max(200).optional(),
      worktree: z.string().trim().min(1).max(500).nullable().optional(),
      agent: z.string().trim().min(1).nullable().optional(),
      model: z.unknown().optional(),
      payload: Payload.optional(),
      priority: z.number().int().min(-1000).max(1000).optional(),
    })
    .refine((input) => Object.keys(input).length > 0, {
      message: "At least one editable queue field is required",
    })
  export type EditBody = z.infer<typeof EditBody>

  export const EditInput = EditBody.and(z.object({ id: TaskQueueID.zod }))
  export type EditInput = z.infer<typeof EditInput>

  export const Event = {
    Created: BusEvent.define("task.queue.created", z.object({ item: Info })),
    Updated: BusEvent.define("task.queue.updated", z.object({ item: Info })),
    Deleted: BusEvent.define(
      "task.queue.deleted",
      z.object({
        id: TaskQueueID.zod,
        projectID: ProjectID.zod,
        sessionID: SessionID.zod.optional(),
      }),
    ),
  }

  function fromRow(row: typeof TaskQueueTable.$inferSelect): Info {
    return Info.parse({
      id: row.id,
      projectID: row.project_id,
      directory: row.directory,
      worktree: row.worktree ?? undefined,
      sessionID: row.session_id ?? undefined,
      kind: row.kind,
      status: row.status,
      priority: row.priority,
      position: row.position,
      title: row.title,
      agent: row.agent ?? undefined,
      model: row.model ?? undefined,
      sourceMessageID: row.source_message_id ?? undefined,
      sourceTaskID: row.source_task_id ?? undefined,
      payload: row.payload,
      error: row.error ?? undefined,
      time: {
        created: row.time_created,
        updated: row.time_updated ?? undefined,
        started: row.time_started ?? undefined,
        completed: row.time_completed ?? undefined,
      },
    })
  }

  function publishCreated(item: Info) {
    Bus.publishDetached(Event.Created, { item })
  }

  function publishUpdated(item: Info) {
    Bus.publishDetached(Event.Updated, { item })
  }

  function publishDeleted(item: Pick<Info, "id" | "projectID" | "sessionID">) {
    Bus.publishDetached(Event.Deleted, item)
  }

  async function assertSessionCompatible(sessionID: SessionID) {
    const session = await Session.get(sessionID)
    if (Session.isCompatibleWithCurrentProject(session)) return session
    throw new HTTPException(409, {
      message: `Session ${sessionID} belongs to a different project directory; queue work from that project instead.`,
    })
  }

  function queueMetadataSource(item: Info): "manual" | "scheduled" | "workflow" {
    if (item.sourceTaskID?.startsWith("sch_")) return "scheduled"
    if (item.payload["workflow"]) return "workflow"
    return "manual"
  }

  async function syncSessionQueueMetadata(item: Info) {
    if (!item.sessionID) return
    try {
      await Session.setProductMetadata({
        sessionID: item.sessionID,
        namespace: "queue",
        value: {
          queueItemId: item.id,
          groupId: item.sourceTaskID,
          source: queueMetadataSource(item),
        },
      })
    } catch (error) {
      log.warn("failed to sync session queue metadata", {
        taskQueueID: item.id,
        sessionID: item.sessionID,
        error,
      })
    }
  }

  function assertProjectItem(item: Info) {
    if (item.projectID === Instance.project.id) return
    throw new HTTPException(409, {
      message: `Task queue item ${item.id} belongs to a different project.`,
    })
  }

  function nextPosition(projectID: ProjectID) {
    return Database.use((db) => {
      const row = db
        .select({ value: sql<number>`coalesce(max(${TaskQueueTable.position}), -1)` })
        .from(TaskQueueTable)
        .where(eq(TaskQueueTable.project_id, projectID))
        .get()
      return Number(row?.value ?? -1) + 1
    })
  }

  export async function list(input: Partial<ListInput> = {}): Promise<Info[]> {
    const parsed = ListInput.partial().parse(input)
    if (parsed.sessionID) await assertSessionCompatible(parsed.sessionID)
    const conditions = [eq(TaskQueueTable.project_id, Instance.project.id)]
    if (parsed.sessionID) conditions.push(eq(TaskQueueTable.session_id, parsed.sessionID))
    if (parsed.status) conditions.push(eq(TaskQueueTable.status, parsed.status))
    return Database.use((db) => {
      let query = db
        .select()
        .from(TaskQueueTable)
        .where(and(...conditions))
        .orderBy(asc(TaskQueueTable.position), desc(TaskQueueTable.time_created), desc(TaskQueueTable.id))
        .$dynamic()
      if (parsed.limit) query = query.limit(parsed.limit)
      return query.all().map(fromRow)
    })
  }

  export async function enqueue(input: EnqueueInput): Promise<Info> {
    const parsed = EnqueueInput.parse(input)
    if (parsed.sessionID) await assertSessionCompatible(parsed.sessionID)

    const now = Date.now()
    const projectID = Instance.project.id
    const item = Database.transaction((db) => {
      const values: typeof TaskQueueTable.$inferInsert = {
        id: TaskQueueID.ascending(),
        project_id: projectID,
        session_id: parsed.sessionID,
        directory: Instance.directory,
        worktree: parsed.worktree,
        kind: parsed.kind,
        status: "queued",
        priority: parsed.priority,
        position: nextPosition(projectID),
        title: parsed.title,
        agent: parsed.agent,
        model: parsed.model,
        source_message_id: parsed.sourceMessageID,
        source_task_id: parsed.sourceTaskID,
        payload: parsed.payload,
        time_created: now,
        time_updated: now,
      }
      const row = db.insert(TaskQueueTable).values(values).returning().get()
      return fromRow(row)
    })
    publishCreated(item)
    await syncSessionQueueMetadata(item)
    return item
  }

  export async function get(id: TaskQueueID): Promise<Info> {
    const item = Database.use((db) => {
      const row = db.select().from(TaskQueueTable).where(eq(TaskQueueTable.id, id)).get()
      if (!row) throw new NotFoundError({ message: `Task queue item not found: ${id}` })
      return fromRow(row)
    })
    assertProjectItem(item)
    return item
  }

  export async function setStatus(input: { id: TaskQueueID; status: Status; error?: string }): Promise<Info> {
    const current = await get(input.id)
    const now = Date.now()
    const updates: Partial<typeof TaskQueueTable.$inferInsert> = {
      status: input.status,
      error: input.error,
      time_updated: now,
    }
    if (input.status === "running" && current.time.started === undefined) updates.time_started = now
    if (input.status === "completed" || input.status === "cancelled" || input.status === "failed") {
      updates.time_completed = now
    }
    const item = Database.use((db) => {
      const row = db.update(TaskQueueTable).set(updates).where(eq(TaskQueueTable.id, input.id)).returning().get()
      if (!row) throw new NotFoundError({ message: `Task queue item not found: ${input.id}` })
      return fromRow(row)
    })
    assertProjectItem(item)
    publishUpdated(item)
    await syncWorkflowStatusIfNeeded(item)
    return item
  }

  export async function claimForExecution(id: TaskQueueID): Promise<Info | undefined> {
    const current = await get(id)
    if (current.status !== "queued" && current.status !== "waiting_for_idle") return undefined

    const now = Date.now()
    const item = Database.use((db) => {
      const row = db
        .update(TaskQueueTable)
        .set({
          status: "running",
          time_updated: now,
          time_started: current.time.started ?? now,
        })
        .where(
          and(
            eq(TaskQueueTable.id, id),
            eq(TaskQueueTable.project_id, current.projectID),
            inArray(TaskQueueTable.status, ["queued", "waiting_for_idle"]),
          ),
        )
        .returning()
        .get()
      return row ? fromRow(row) : undefined
    })
    if (!item) return undefined
    assertProjectItem(item)
    publishUpdated(item)
    await syncWorkflowStatusIfNeeded(item)
    return item
  }

  export async function pause(id: TaskQueueID): Promise<Info> {
    const current = await get(id)
    assertActionStatus(current, "pause", ["queued", "waiting_for_idle"])
    return setStatus({ id, status: "paused" })
  }

  export async function resume(id: TaskQueueID): Promise<Info> {
    const current = await get(id)
    assertActionStatus(current, "resume", ["paused"])
    return setStatus({ id, status: "queued" })
  }

  export async function cancel(id: TaskQueueID): Promise<Info> {
    const current = await get(id)
    assertActionStatus(current, "cancel", ["queued", "waiting_for_idle", "paused"])
    return setStatus({ id, status: "cancelled" })
  }

  export async function retry(id: TaskQueueID): Promise<Info> {
    const current = await get(id)
    assertActionStatus(current, "retry", ["failed", "cancelled"])
    const now = Date.now()
    const item = Database.use((db) => {
      const row = db
        .update(TaskQueueTable)
        .set({
          status: "queued",
          error: null,
          time_started: null,
          time_completed: null,
          time_updated: now,
        })
        .where(eq(TaskQueueTable.id, id))
        .returning()
        .get()
      if (!row) throw new NotFoundError({ message: `Task queue item not found: ${id}` })
      return fromRow(row)
    })
    assertProjectItem(item)
    publishUpdated(item)
    await syncWorkflowStatusIfNeeded(item)
    return item
  }

  export async function recoverInterrupted(): Promise<{ failed: Info[]; requeued: Info[]; preserved: Info[] }> {
    const now = Date.now()
    const interruptedStatuses = ["running", "blocked_permission", "blocked_question"] as const
    const recoverableStatuses = [...interruptedStatuses, "waiting_for_idle"] as const
    const changed = Database.transaction((db) => {
      const rows = db
        .select()
        .from(TaskQueueTable)
        .where(
          and(eq(TaskQueueTable.project_id, Instance.project.id), inArray(TaskQueueTable.status, recoverableStatuses)),
        )
        .all()

      const failed: Info[] = []
      const requeued: Info[] = []
      const preserved: Info[] = []
      for (const row of rows) {
        const workflowItem = hasWorkflowPayload(row.payload)
        if (row.status === "waiting_for_idle" || (workflowItem && row.status === "running")) {
          const updated = db
            .update(TaskQueueTable)
            .set({
              status: "queued",
              error: null,
              time_started: null,
              time_completed: null,
              time_updated: now,
            })
            .where(eq(TaskQueueTable.id, row.id))
            .returning()
            .get()
          if (updated) requeued.push(fromRow(updated))
          continue
        }
        if (workflowItem) {
          preserved.push(fromRow(row))
          continue
        }

        const updated = db
          .update(TaskQueueTable)
          .set({
            status: "failed",
            error: "Task interrupted by backend restart; inspect output and retry when safe.",
            time_completed: now,
            time_updated: now,
          })
          .where(eq(TaskQueueTable.id, row.id))
          .returning()
          .get()
        if (updated) failed.push(fromRow(updated))
      }

      return { failed, requeued, preserved }
    })

    for (const item of [...changed.failed, ...changed.requeued]) {
      publishUpdated(item)
      await syncWorkflowStatusIfNeeded(item)
    }
    for (const item of changed.preserved) {
      await syncWorkflowStatusIfNeeded(item)
    }
    return changed
  }

  function hasWorkflowPayload(payload: Payload) {
    const workflow = payload["workflow"]
    return !!workflow && typeof workflow === "object"
  }

  export async function edit(input: EditInput): Promise<Info> {
    const parsed = EditInput.parse(input)
    const current = await get(parsed.id)
    if (!isEditableStatus(current.status)) {
      throw new HTTPException(409, {
        message: `Task queue item ${parsed.id} cannot be edited while it is ${current.status}.`,
      })
    }

    const now = Date.now()
    const updates: Partial<typeof TaskQueueTable.$inferInsert> = {
      time_updated: now,
    }
    if (parsed.title !== undefined) updates.title = parsed.title
    if ("worktree" in parsed) updates.worktree = parsed.worktree ?? null
    if ("agent" in parsed) updates.agent = parsed.agent ?? null
    if ("model" in parsed) updates.model = parsed.model ?? null
    if (parsed.payload !== undefined) updates.payload = parsed.payload
    if (parsed.priority !== undefined) updates.priority = parsed.priority

    const item = Database.use((db) => {
      const row = db.update(TaskQueueTable).set(updates).where(eq(TaskQueueTable.id, parsed.id)).returning().get()
      if (!row) throw new NotFoundError({ message: `Task queue item not found: ${parsed.id}` })
      return fromRow(row)
    })
    assertProjectItem(item)
    publishUpdated(item)
    await syncSessionQueueMetadata(item)
    await syncWorkflowStatusIfNeeded(item)
    return item
  }

  export async function reorder(input: ReorderInput): Promise<Info> {
    const parsed = ReorderInput.parse(input)
    const current = await get(parsed.id)
    const now = Date.now()
    const changed = Database.transaction((db) => {
      const rows = db
        .select()
        .from(TaskQueueTable)
        .where(eq(TaskQueueTable.project_id, current.projectID))
        .orderBy(asc(TaskQueueTable.position), desc(TaskQueueTable.time_created), desc(TaskQueueTable.id))
        .all()
      const currentIndex = rows.findIndex((row) => row.id === parsed.id)
      if (currentIndex < 0) throw new NotFoundError({ message: `Task queue item not found: ${parsed.id}` })

      const [row] = rows.splice(currentIndex, 1)
      const nextIndex = Math.min(parsed.position, rows.length)
      rows.splice(nextIndex, 0, row!)

      const changedItems: Info[] = []
      for (let index = 0; index < rows.length; index++) {
        const currentRow = rows[index]!
        if (currentRow.position === index && currentRow.id !== parsed.id) continue
        const updated = db
          .update(TaskQueueTable)
          .set({ position: index, time_updated: now })
          .where(eq(TaskQueueTable.id, currentRow.id))
          .returning()
          .get()
        if (updated) changedItems.push(fromRow(updated))
      }
      return changedItems
    })
    for (const item of changed) publishUpdated(item)
    const item = changed.find((candidate) => candidate.id === parsed.id) ?? (await get(parsed.id))
    return item
  }

  export async function sendNow(id: TaskQueueID): Promise<Info> {
    const current = await get(id)
    assertActionStatus(current, "send now", ["queued", "waiting_for_idle", "paused"])
    const now = Date.now()
    const item = Database.transaction((db) => {
      db.update(TaskQueueTable)
        .set({ position: sql`${TaskQueueTable.position} + 1` })
        .where(eq(TaskQueueTable.project_id, current.projectID))
        .run()
      const row = db
        .update(TaskQueueTable)
        .set({ status: "queued", position: 0, time_updated: now })
        .where(eq(TaskQueueTable.id, id))
        .returning()
        .get()
      if (!row) throw new NotFoundError({ message: `Task queue item not found: ${id}` })
      return fromRow(row)
    })
    assertProjectItem(item)
    publishUpdated(item)
    return item
  }

  export async function remove(id: TaskQueueID): Promise<boolean> {
    const item = await get(id)
    Database.use((db) => {
      db.delete(TaskQueueTable).where(eq(TaskQueueTable.id, id)).run()
    })
    publishDeleted(item)
    return true
  }

  function isEditableStatus(status: Status) {
    return (
      status === "queued" ||
      status === "waiting_for_idle" ||
      status === "paused" ||
      status === "failed" ||
      status === "cancelled"
    )
  }

  function assertActionStatus(item: Info, action: string, allowed: Status[]) {
    if (allowed.includes(item.status)) return
    throw new HTTPException(409, {
      message: `Cannot ${action} task queue item ${item.id} while it is ${item.status}.`,
    })
  }

  async function syncWorkflowStatusIfNeeded(item: Info) {
    const workflow = item.payload["workflow"]
    if (!workflow || typeof workflow !== "object") return
    await import("../workflow/task-queue").then((mod) => mod.WorkflowTaskQueue.syncItem(item)).catch(() => undefined)
  }
}
