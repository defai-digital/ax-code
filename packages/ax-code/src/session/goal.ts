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

  // NOTE: creation is blocked by active AND paused goals (a paused goal is
  // resumable and must not be silently discarded), so the recovery advice
  // must not include "pause" — only terminal states unblock creation.
  const ACTIVE_GOAL_ERROR =
    "session already has an active goal; complete, block, or clear it before creating another goal (a paused goal also blocks creation — resume it or clear it)"

  function canReplaceWithoutExplicitReplace(row: typeof SessionGoalTable.$inferSelect) {
    return row.status === "complete" || row.status === "blocked" || row.status === "budget_limited"
  }

  function assertCanSetStatus(row: typeof SessionGoalTable.$inferSelect, status: Status) {
    // Guard the budget exhaustion condition regardless of current status so that
    // the budget_limited → pause → resume path cannot silently bypass this check.
    if (status === "active" && row.token_budget !== null && row.tokens_used >= row.token_budget) {
      throw new Error(
        "Cannot resume a budget-limited goal without increasing the token budget. Start a new goal with a larger budget or clear the current goal first.",
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
    if (input.tokenBudget !== undefined && (!Number.isSafeInteger(input.tokenBudget) || input.tokenBudget <= 0)) {
      throw new Error("Goal token budget must be a positive integer")
    }
    const now = Date.now()
    const values = {
      session_id: input.sessionID,
      objective,
      status: "active",
      token_budget: input.tokenBudget,
      tokens_used: 0,
      time_used_seconds: 0,
      time_created: now,
      time_updated: now,
    } satisfies typeof SessionGoalTable.$inferInsert
    const goal = Database.transaction((db) => {
      if (input.replace) {
        db.insert(SessionGoalTable)
          .values(values)
          .onConflictDoUpdate({
            target: SessionGoalTable.session_id,
            set: {
              objective,
              status: "active",
              token_budget: input.tokenBudget ?? null,
              tokens_used: 0,
              time_used_seconds: 0,
              time_created: now,
              time_updated: now,
            },
          })
          .run()
        return fromRow(
          db.select().from(SessionGoalTable).where(eq(SessionGoalTable.session_id, input.sessionID)).get()!,
        )
      }

      const inserted = db.insert(SessionGoalTable).values(values).onConflictDoNothing().returning().get()
      if (inserted) return fromRow(inserted)
      const row = db.select().from(SessionGoalTable).where(eq(SessionGoalTable.session_id, input.sessionID)).get()
      if (!row || !canReplaceWithoutExplicitReplace(row)) {
        throw new Error(ACTIVE_GOAL_ERROR)
      }
      db.update(SessionGoalTable)
        .set({
          objective,
          status: "active",
          token_budget: input.tokenBudget ?? null,
          tokens_used: 0,
          time_used_seconds: 0,
          time_created: now,
          time_updated: now,
        })
        .where(eq(SessionGoalTable.session_id, input.sessionID))
        .run()
      return fromRow(db.select().from(SessionGoalTable).where(eq(SessionGoalTable.session_id, input.sessionID)).get()!)
    })
    publish(goal)
    return goal
  }

  export async function setStatus(input: { sessionID: SessionID; status: Status }): Promise<Info> {
    const now = Date.now()
    const goal = Database.transaction((db) => {
      const row = db.select().from(SessionGoalTable).where(eq(SessionGoalTable.session_id, input.sessionID)).get()
      if (!row) throw new Error("No goal is set for this session")
      assertCanSetStatus(row, input.status)
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

  /**
   * Clone the goal onto a forked session. The fork inherits the full
   * message history, so status, budget, and usage counters carry over
   * verbatim — only the creation timestamp is fresh. No-op when the
   * source session has no goal.
   */
  export async function copyTo(input: { from: SessionID; to: SessionID }): Promise<Info | undefined> {
    const now = Date.now()
    const goal = Database.transaction((db) => {
      const row = db.select().from(SessionGoalTable).where(eq(SessionGoalTable.session_id, input.from)).get()
      if (!row) return undefined
      const values = {
        objective: row.objective,
        status: row.status,
        token_budget: row.token_budget,
        tokens_used: row.tokens_used,
        time_used_seconds: row.time_used_seconds,
        time_created: now,
        time_updated: now,
      }
      db.insert(SessionGoalTable)
        .values({ session_id: input.to, ...values })
        .onConflictDoUpdate({ target: SessionGoalTable.session_id, set: values })
        .run()
      return fromRow(db.select().from(SessionGoalTable).where(eq(SessionGoalTable.session_id, input.to)).get()!)
    })
    if (goal) publish(goal)
    return goal
  }

  export async function addUsage(input: {
    sessionID: SessionID
    message: MessageV2.Assistant
  }): Promise<Info | undefined> {
    // Goal budgets measure NEW work: net input + output + reasoning.
    // The reported `total` deliberately includes cache read/write tokens
    // (see Session.getUsage), and goal auto-continuations re-send the whole
    // conversation from cache — counting those would burn the budget on
    // re-reading context rather than on work, at a rate proportional to
    // context size. `total` is only a fallback for providers that report
    // no per-component token counts at all.
    const componentTokens =
      nonnegativeFinite(input.message.tokens.input) +
      nonnegativeFinite(input.message.tokens.output) +
      nonnegativeFinite(input.message.tokens.reasoning)
    const reportedTotal = nonnegativeFinite(input.message.tokens.total)
    const tokens = componentTokens > 0 ? componentTokens : reportedTotal
    const tokenDelta = nonnegativeFinite(tokens)

    const elapsedMs =
      input.message.time.completed === undefined ? 0 : input.message.time.completed - input.message.time.created
    const elapsedSeconds =
      input.message.time.completed === undefined
        ? 0
        : Number.isFinite(elapsedMs)
          ? Math.max(0, Math.round(elapsedMs / 1000))
          : 0
    const shouldUpdate = tokenDelta > 0 || input.message.time.completed !== undefined
    const now = Date.now()

    const updated = Database.transaction((db) => {
      const row = db.select().from(SessionGoalTable).where(eq(SessionGoalTable.session_id, input.sessionID)).get()
      if (!row) return undefined
      // Only goals doing work accrue usage: active goals and the single
      // budget_limited wrap-up turn. Paused and terminal goals must not be
      // charged for unrelated turns in the same session — a paused goal
      // drifting past its budget becomes permanently un-resumable
      // (assertCanSetStatus), and a completed goal would report
      // ever-growing final usage.
      if (row.status !== "active" && row.status !== "budget_limited") return fromRow(row)
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

  function nonnegativeFinite(value: number | null | undefined) {
    return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 0
  }

  export function format(goal: Info | undefined): string {
    if (!goal) return "No goal is set for this session."
    const remaining =
      goal.tokenBudget === undefined ? "" : ` Remaining tokens: ${Math.max(0, goal.tokenBudget - goal.tokensUsed)}.`
    return `Goal ${goal.status}: ${goal.objective}\nTokens used: ${goal.tokensUsed}${goal.tokenBudget === undefined ? "" : `/${goal.tokenBudget}`}.${remaining}`
  }
}
