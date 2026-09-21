import { createHash } from "node:crypto"
import z from "zod"
import { HTTPException } from "hono/http-exception"
import { Log } from "@/util/log"
import type { TaskQueueID } from "./schema"
import { SessionSteering } from "./steering"
import { TaskQueue } from "./task-queue"
import { TaskQueueExecutor } from "./task-queue-executor"

const log = Log.create({ service: "task-queue-steer" })

/**
 * Steer-now for a saved follow-up: admit the queued row's text into the
 * session's running generation at its next step boundary and cancel the queue
 * row, atomically from the caller's point of view (ADR-106 D5 transitions).
 *
 * The client-composed alternative (pause -> read steering state -> steer ->
 * cancel over separate requests) races the executor and the turn boundary:
 * a turn ending mid-sequence leaves the row either duplicated (steered AND
 * later executed) or lost. Holding the row first and letting the single
 * request converge every failure path keeps the invariant that a row is
 * never duplicated and never lost:
 *
 * - no active generation: row untouched, reason "generation_not_active" (the
 *   caller may then fall back to prioritizing the row);
 * - admission rejected (hook veto, stale generation): the held row is
 *   restored to the queue so nothing is dropped;
 * - admitted: the row is cancelled with a `steeredInto`/`steeredAt` audit
 *   trail. Steered text is not undoable; the cancelled row keeps the record.
 */
export namespace TaskQueueSteer {
  export const Result = z
    .object({
      item: TaskQueue.Info,
      receipt: SessionSteering.Receipt.nullable(),
      reason: z.string().optional(),
    })
    .meta({ ref: "TaskQueueSteerResult" })
  export type Result = z.infer<typeof Result>

  const HOLD_STATUSES: readonly TaskQueue.Status[] = ["queued", "waiting_for_idle"]
  const STEERABLE_STATUSES: readonly TaskQueue.Status[] = [...HOLD_STATUSES, "paused"]
  const MAX_TEXT_LENGTH = 16_000

  const FollowUpBody = z
    .object({
      parts: z.array(z.object({ type: z.string(), text: z.string().optional() }).passthrough()),
    })
    .passthrough()

  function notSteerable(message: string) {
    return new HTTPException(400, { message })
  }

  /**
   * The text a follow-up row would inject mid-turn, or a 400 describing why
   * the row is a barrier. Non-text parts cannot ride the text-only steering
   * contract. The body's agent/model/variant/system fields are the composer
   * snapshot every follow-up carries, not a deliberate override — steering
   * deliberately applies the running turn's context instead, exactly like the
   * composer-draft steer, so they are not barriers here.
   */
  export function steerableText(item: TaskQueue.Info): string {
    if (item.kind !== "followup") {
      throw notSteerable(`Task queue item ${item.id} is ${item.kind}, not a follow-up.`)
    }
    const parsed = FollowUpBody.safeParse(item.payload.body)
    if (!parsed.success) {
      throw notSteerable(`Follow-up ${item.id} has no readable prompt body.`)
    }
    const text =
      parsed.data.parts.length === 1 && parsed.data.parts[0]!.type === "text"
        ? parsed.data.parts[0]!.text?.trim()
        : undefined
    if (!text) {
      throw notSteerable(`Follow-up ${item.id} is not text-only; attachments cannot steer the running turn.`)
    }
    if (text.length > MAX_TEXT_LENGTH) {
      throw notSteerable(
        `Follow-up ${item.id} is ${text.length} characters; steering accepts at most ${MAX_TEXT_LENGTH}.`,
      )
    }
    return text
  }

  export async function steer(id: TaskQueueID): Promise<Result> {
    const item = await TaskQueue.get(id)
    if (!STEERABLE_STATUSES.includes(item.status)) {
      throw notSteerable(`Cannot steer task queue item ${id} while it is ${item.status}.`)
    }
    const text = steerableText(item)
    const sessionID = item.sessionID
    if (!sessionID) {
      throw notSteerable(`Follow-up ${id} has no target session.`)
    }

    const generation = SessionSteering.view(sessionID).generation
    if (!generation) return { item, receipt: null, reason: "generation_not_active" }

    const clientID = `tq_${id}_${createHash("sha256").update(text).digest("hex").slice(0, 12)}`

    // Hold the row so the executor cannot claim it between the generation
    // check and admission. pause() is the guarded atomic transition, and a
    // turn ending after the hold cannot start the row.
    const wasPaused = item.status === "paused"
    const held = wasPaused ? item : await TaskQueue.pause(id)

    async function restore(): Promise<TaskQueue.Info> {
      if (wasPaused) return held
      try {
        const resumed = await TaskQueue.resume(id)
        // Re-evaluate immediately (mirroring retry): the row returns to
        // waiting_for_idle while the session is busy, or starts when the turn
        // already ended.
        return await TaskQueueExecutor.start(resumed)
      } catch (error) {
        log.warn("steer restore failed; returning the latest row state", { id, error })
        return TaskQueue.get(id).catch(() => held)
      }
    }

    const { SessionPrompt } = await import("./prompt")
    let receipt: SessionSteering.Receipt
    try {
      receipt = await SessionPrompt.steer(sessionID, { expectedGeneration: generation, clientID, text })
    } catch (error) {
      await restore()
      throw error
    }

    if (receipt.status === "accepted" || receipt.status === "applied") {
      const steeredAt = Date.now()
      try {
        const cancelled = await TaskQueue.cancelSteered(id, { steeredInto: generation, steeredAt })
        return { item: cancelled, receipt }
      } catch (error) {
        // The steer is already admitted and durable; a failed audit write must
        // not mask that. Report the admitted receipt with the row as held.
        log.warn("steered follow-up could not be marked cancelled", { id, error })
        return {
          item: {
            ...held,
            status: "cancelled",
            payload: { ...held.payload, steeredInto: generation, steeredAt },
            time: { ...held.time, updated: steeredAt },
          },
          receipt,
        }
      }
    }

    const restored = await restore()
    return { item: restored, receipt }
  }
}
