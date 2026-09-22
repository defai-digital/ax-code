import { createHash } from "node:crypto"
import z from "zod"
import { HTTPException } from "hono/http-exception"
import { Log } from "@/util/log"
import { TaskQueueID } from "./schema"
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

  // `tq_<row id>_<generation prefix>_<text hash>`; the trailing two fields are
  // fixed-width hex, so the row id can be recovered from the receipt alone.
  const CLIENT_ID = /^tq_(.+)_[0-9a-f]{8}_[0-9a-f]{12}$/

  function clientIDFor(id: TaskQueueID, generation: string, text: string) {
    return `tq_${id}_${generation.slice(0, 8)}_${createHash("sha256").update(text).digest("hex").slice(0, 12)}`
  }

  /**
   * Called by SessionSteering.finish for receipts that were admitted but never
   * applied. The queue row was cancelled on admission with `steeredInto` set
   * to that generation; put it back in the queue so the follow-up runs on the
   * next turn instead of vanishing. Rows already applied, retried, or edited
   * by the user are left alone. When the generation ended because the user
   * interrupted it, the recovered row is parked as paused, matching how an
   * interrupt treats every other waiting follow-up, rather than auto-started.
   */
  export async function reconcileDiscarded(
    sessionID: string,
    receipts: readonly SessionSteering.Receipt[],
    options: { aborted?: boolean } = {},
  ) {
    for (const receipt of receipts) {
      // Only receipts the generation actually discarded qualify; an applied
      // or otherwise rejected receipt must never resurrect a row.
      if (receipt.status !== "rejected" || receipt.reason !== "generation_ended_before_application") continue
      const match = CLIENT_ID.exec(receipt.clientID)
      if (!match) continue
      const parsed = TaskQueueID.zod.safeParse(match[1])
      if (!parsed.success) continue
      const id = parsed.data
      try {
        const row = await TaskQueue.get(id)
        if (row.sessionID !== sessionID) continue
        if (row.status !== "cancelled" || row.payload["steeredInto"] !== receipt.generation) continue
        const retried = await TaskQueue.retry(id)
        if (options.aborted) {
          await TaskQueue.pause(id)
          log.info("parked follow-up whose steer was interrupted before application", {
            id,
            generation: receipt.generation,
          })
          continue
        }
        await TaskQueueExecutor.start(retried)
        log.info("requeued follow-up whose steer ended before application", { id, generation: receipt.generation })
      } catch (error) {
        log.warn("could not requeue a discarded steered follow-up", { id, error })
      }
    }
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

    // Receipts dedupe by clientID against a digest that includes the
    // generation, so the id must vary per generation: a row restored after an
    // admission rejection would otherwise hit a permanent conflict when
    // steered again during a later turn. Within one generation retries of the
    // same row and text still collapse onto the first receipt.
    const clientID = clientIDFor(id, generation, text)
    // Resolve the prompt module before holding the row: an import failure
    // after pause() would leave the row parked with no restore path.
    const { SessionPrompt } = await import("./prompt")

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
        // not mask that. Report the fresh row when it can be read: a raced
        // claim between the hold and the cancel leaves the row running, and a
        // synthetic "cancelled" would hide that the follow-up will also run.
        log.warn("steered follow-up could not be marked cancelled", { id, error })
        const fresh = await TaskQueue.get(id).catch(() => undefined)
        if (fresh) return { item: fresh, receipt }
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
