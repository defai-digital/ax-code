import z from "zod"
import { Bus } from "@/bus"
import { BusEvent } from "@/bus/bus-event"
import { Database, eq, sql } from "@/storage/db"
import { SessionGoalTable } from "./session.sql"
import { SessionID } from "./schema"
import type { MessageV2 } from "./message-v2"

export namespace SessionGoal {
  export const Status = z.enum(["active", "paused", "complete", "blocked", "budget_limited"])
  export type Status = z.infer<typeof Status>

  export const Info = z.object({
    sessionID: SessionID.zod,
    objective: z.string(),
    status: Status,
    tokenBudget: z.number().int().positive().optional(),
    tokensUsed: z.number().int().min(0),
    timeUsedSeconds: z.number().int().min(0),
    time: z.object({
      created: z.number(),
      updated: z.number().optional(),
    }),
  })
  export type Info = z.infer<typeof Info>

  export const PublicInfo = Info.extend({
    remainingTokens: z.number().int().min(0).optional(),
  })
  export type PublicInfo = z.infer<typeof PublicInfo>

  export const Event = {
    Updated: BusEvent.define(
      "session.goal",
      z.object({
        sessionID: SessionID.zod,
        goal: PublicInfo.nullable(),
      }),
    ),
  }

  function fromRow(row: typeof SessionGoalTable.$inferSelect): Info {
    return Info.parse({
      sessionID: row.session_id,
      objective: row.objective,
      status: row.status,
      tokenBudget: row.token_budget ?? undefined,
      tokensUsed: row.tokens_used,
      timeUsedSeconds: row.time_used_seconds,
      time: {
        created: row.time_created,
        updated: row.time_updated ?? undefined,
      },
    })
  }

  function toPublic(goal: Info | undefined): PublicInfo | undefined {
    if (!goal) return undefined
    return PublicInfo.parse({
      sessionID: goal.sessionID,
      objective: goal.objective,
      status: goal.status,
      tokenBudget: goal.tokenBudget,
      tokensUsed: goal.tokensUsed,
      remainingTokens: goal.tokenBudget === undefined ? undefined : Math.max(0, goal.tokenBudget - goal.tokensUsed),
      timeUsedSeconds: goal.timeUsedSeconds,
      time: goal.time,
    })
  }

  export function publicInfo(goal: Info | undefined) {
    return toPublic(goal)
  }

  function publish(goal: Info | undefined, sessionID?: SessionID) {
    const targetSessionID = goal?.sessionID ?? sessionID
    if (!targetSessionID) return
    Bus.publishDetached(Event.Updated, {
      sessionID: targetSessionID,
      goal: publicInfo(goal) ?? null,
    })
  }

  export async function get(sessionID: SessionID): Promise<Info | undefined> {
    return Database.use((db) => {
      const row = db.select().from(SessionGoalTable).where(eq(SessionGoalTable.session_id, sessionID)).get()
      return row ? fromRow(row) : undefined
    })
  }

  export async function requireActiveSlot(sessionID: SessionID) {
    const existing = await get(sessionID)
    if (
      existing &&
      existing.status !== "complete" &&
      existing.status !== "blocked" &&
      existing.status !== "budget_limited"
    ) {
      throw new Error(
        "session already has an active goal; pause, complete, block, or clear it before creating another goal",
      )
    }
  }

  export async function create(input: {
    sessionID: SessionID
    objective: string
    tokenBudget?: number
    replace?: boolean
  }): Promise<Info> {
    const objective = input.objective.trim()
    if (!objective) throw new Error("Goal objective is required")
    if (input.tokenBudget !== undefined && (!Number.isInteger(input.tokenBudget) || input.tokenBudget <= 0)) {
      throw new Error("Goal token budget must be a positive integer")
    }
    if (!input.replace) await requireActiveSlot(input.sessionID)

    const now = Date.now()
    const goal = Database.use((db) => {
      db.insert(SessionGoalTable)
        .values({
          session_id: input.sessionID,
          objective,
          status: "active",
          token_budget: input.tokenBudget,
          tokens_used: 0,
          time_used_seconds: 0,
          time_created: now,
          time_updated: now,
        })
        .onConflictDoUpdate({
          target: SessionGoalTable.session_id,
          set: {
            objective,
            status: "active",
            token_budget: input.tokenBudget ?? null,
            tokens_used: 0,
            time_used_seconds: 0,
            time_updated: now,
          },
        })
        .run()
      return fromRow(db.select().from(SessionGoalTable).where(eq(SessionGoalTable.session_id, input.sessionID)).get()!)
    })
    publish(goal)
    return goal
  }

  export async function setStatus(input: { sessionID: SessionID; status: Status }): Promise<Info> {
    const now = Date.now()
    const goal = Database.use((db) => {
      const row = db.select().from(SessionGoalTable).where(eq(SessionGoalTable.session_id, input.sessionID)).get()
      if (!row) throw new Error("No goal is set for this session")
      db.update(SessionGoalTable)
        .set({ status: input.status, time_updated: now })
        .where(eq(SessionGoalTable.session_id, input.sessionID))
        .run()
      return fromRow(db.select().from(SessionGoalTable).where(eq(SessionGoalTable.session_id, input.sessionID)).get()!)
    })
    publish(goal)
    return goal
  }

  export async function pause(sessionID: SessionID) {
    return setStatus({ sessionID, status: "paused" })
  }

  export async function resume(sessionID: SessionID) {
    return setStatus({ sessionID, status: "active" })
  }

  export async function clear(sessionID: SessionID) {
    Database.use((db) => {
      db.delete(SessionGoalTable).where(eq(SessionGoalTable.session_id, sessionID)).run()
    })
    publish(undefined, sessionID)
  }

  export async function addUsage(input: {
    sessionID: SessionID
    message: MessageV2.Assistant
  }): Promise<Info | undefined> {
    const tokens =
      input.message.tokens.total ??
      input.message.tokens.input + input.message.tokens.output + input.message.tokens.reasoning
    const tokenDelta = Math.max(0, tokens)

    const elapsedSeconds =
      input.message.time.completed === undefined
        ? 0
        : Math.max(0, Math.round((input.message.time.completed - input.message.time.created) / 1000))
    const shouldUpdate = tokenDelta > 0 || input.message.time.completed !== undefined
    const now = Date.now()

    const updated = Database.transaction((db) => {
      const row = db.select().from(SessionGoalTable).where(eq(SessionGoalTable.session_id, input.sessionID)).get()
      if (!row) return undefined
      if (!shouldUpdate) return fromRow(row)

      db.update(SessionGoalTable)
        .set({
          tokens_used: sql`${SessionGoalTable.tokens_used} + ${tokenDelta}`,
          time_used_seconds: sql`${SessionGoalTable.time_used_seconds} + ${elapsedSeconds}`,
          status: sql`case
            when ${SessionGoalTable.status} = 'active'
              and ${SessionGoalTable.token_budget} is not null
              and ${SessionGoalTable.tokens_used} + ${tokenDelta} >= ${SessionGoalTable.token_budget}
            then 'budget_limited'
            else ${SessionGoalTable.status}
          end`,
          time_updated: now,
        })
        .where(eq(SessionGoalTable.session_id, input.sessionID))
        .run()
      return fromRow(db.select().from(SessionGoalTable).where(eq(SessionGoalTable.session_id, input.sessionID)).get()!)
    })
    publish(updated)
    return updated
  }

  export function format(goal: Info | undefined): string {
    if (!goal) return "No goal is set for this session."
    const remaining =
      goal.tokenBudget === undefined ? "" : ` Remaining tokens: ${Math.max(0, goal.tokenBudget - goal.tokensUsed)}.`
    return `Goal ${goal.status}: ${goal.objective}\nTokens used: ${goal.tokensUsed}${goal.tokenBudget === undefined ? "" : `/${goal.tokenBudget}`}.${remaining}`
  }
}
