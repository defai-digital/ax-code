import { abortError } from "@/util/abort"
import { Log } from "@/util/log"
import { sleep } from "@/util/timeout"
import { NotFoundError } from "@/storage/db"
import { Session } from "."
import { MessageV2 } from "./message-v2"
import { SessionPrompt } from "./prompt"
import { SessionExecutionContext } from "./execution-context"
import { MessageID, PartID, SessionID } from "./schema"
import { TaskQueue } from "./task-queue"
import { childVisibleText, formatBackgroundTaskHandoff, isEmptySubagentResultText } from "./background-subagent-handoff"

const log = Log.create({ service: "session.background-subagent-delivery" })

export function isLiveTaskSubagent(item: TaskQueue.Info) {
  return item.kind === "subagent" && item.payload["source"] === "task"
}

const TERMINAL_QUEUE_STATUSES: readonly TaskQueue.Status[] = ["completed", "failed", "cancelled"]
const ACTIVE_QUEUE_STATUSES: TaskQueue.Status[] = TaskQueue.Status.options.filter(
  (status) => !TERMINAL_QUEUE_STATUSES.includes(status),
)
// A task's direct background subagents deliver their evidence into that
// task's session. Until every such delivery settles, a final answer would be
// written without their evidence, so both the direct task path and the queued
// executor wait here before their final turn.
const NESTED_RESULT_POLL_MS = 50
const nestedResultCollections = new Set<string>()

/** Process-local guard while a direct task path collects its nested results. */
export function beginNestedResultCollection(sessionID: SessionID): Disposable {
  nestedResultCollections.add(sessionID)
  return {
    [Symbol.dispose]() {
      nestedResultCollections.delete(sessionID)
    },
  }
}

export function isCollectingNestedResults(sessionID: SessionID): boolean {
  return nestedResultCollections.has(sessionID)
}

/**
 * Classifies the direct child task-subagent rows of `sessionID`:
 * `pending` means a handoff delivery has not settled yet (any active row, or
 * any terminal row still pending/delivering), so the caller must wait;
 * `settled` means the automatic handoff route created a terminal row at or
 * after `since`, so its evidence landed during this execution and still needs
 * a synthesis turn. A waitfor-consumed row already reached the child as a tool
 * result and needs none. Non-task rows (prompts, workflows, monitors) are not
 * this task's evidence.
 */
export async function nestedSubagentWork(input: {
  sessionID: SessionID
  since: number
}): Promise<{ pending: boolean; settled: boolean }> {
  const { active, terminal } = await nestedSubagentRows(input.sessionID)
  return {
    pending: active.length > 0 || terminal.some(hasPendingDelivery),
    // A row from a previous execution was already synthesized (or has its own
    // wake), so counting it here would finalize the same evidence again.
    settled: terminal.some(
      (item) => item.time.created >= input.since && TaskQueue.resultDeliveryClaim(item)?.owner !== "waitfor",
    ),
  }
}

/**
 * Whether a direct child of `sessionID` still needs its background-handoff
 * delivery to settle. Delivered or blocked rows are settled and never make the
 * wait loop wait for them.
 */
export async function hasPendingNestedSubagentResults(sessionID: SessionID): Promise<boolean> {
  const { active, terminal } = await nestedSubagentRows(sessionID)
  return active.length > 0 || terminal.some(hasPendingDelivery)
}

function hasPendingDelivery(item: TaskQueue.Info) {
  const delivery = TaskQueue.DeliveryStatus.safeParse(item.payload["deliveryStatus"])
  return delivery.success && (delivery.data === "pending" || delivery.data === "delivering")
}

async function nestedSubagentRows(sessionID: SessionID) {
  // A task-subagent row belongs to the child session it runs, not to the
  // parent that launched it, so query only this parent's direct children.
  // A project-wide bounded query let unrelated terminal rows crowd an owned
  // row out of the limit and hide real nested work.
  const children = await Session.children(sessionID)
  const rows = (
    await Promise.all(
      children.map((child) =>
        TaskQueue.list({
          sessionID: child.id,
          statuses: [...ACTIVE_QUEUE_STATUSES, ...TERMINAL_QUEUE_STATUSES],
          limit: 500,
          descending: true,
        }),
      ),
    )
  )
    .flat()
    .filter((item) => isOwnedBackgroundSubagent(item, sessionID))
  return {
    active: rows.filter((item) => !TERMINAL_QUEUE_STATUSES.includes(item.status)),
    terminal: rows.filter((item) => TERMINAL_QUEUE_STATUSES.includes(item.status)),
  }
}

/**
 * Bounded, abort-aware wait for the direct background subagents of
 * `sessionID`. Returns "timeout" when the caller's budget runs out; the
 * caller then keeps its existing explicit ongoing/partial result path.
 */
export async function waitForNestedSubagentResults(input: {
  sessionID: SessionID
  signal?: AbortSignal
  timeoutMs: number
}): Promise<"completed" | "timeout"> {
  if (input.signal?.aborted) throw abortError()
  const deadline = Date.now() + Math.max(0, input.timeoutMs)
  for (;;) {
    if (input.signal?.aborted) throw abortError()
    if (!(await hasPendingNestedSubagentResults(input.sessionID))) return "completed"
    const remaining = deadline - Date.now()
    if (remaining <= 0) return "timeout"
    await sleep(Math.min(NESTED_RESULT_POLL_MS, remaining), { signal: input.signal })
  }
}

function isOwnedBackgroundSubagent(item: TaskQueue.Info, parentSessionID: SessionID) {
  return isLiveTaskSubagent(item) && item.payload["parentSessionID"] === parentSessionID
}

async function hasActiveQueueRow(sessionID: SessionID) {
  // Filter by kind after the bounded read: an unrelated active prompt row must
  // not hide the task-subagent row that owns the pending collection.
  const items = await TaskQueue.list({
    sessionID,
    statuses: ACTIVE_QUEUE_STATUSES,
    limit: 500,
    descending: true,
  })
  return items.some(isLiveTaskSubagent)
}

export const BackgroundSubagentDeliveryInternals = {
  async afterPersist(_item: TaskQueue.Info): Promise<void> {},
}

export async function deliverBackgroundSubagentHandoff(input: {
  item: TaskQueue.Info
  outcome:
    | { status: "completed"; result: unknown }
    | { status: "failed"; error: string }
    | { status: "cancelled"; error: string }
}) {
  const { item, outcome } = input
  if (!isLiveTaskSubagent(item)) return item

  const requestedClaim: TaskQueue.ResultDeliveryClaim = {
    owner: "handoff",
    messageID: MessageID.ascending(),
    partID: PartID.ascending(),
    time: Date.now(),
  }
  const selection = await TaskQueue.claimResultDelivery({ id: item.id, claim: requestedClaim })
  if (!selection.accepted || selection.claim?.owner !== "handoff") return selection.item
  const claim = selection.claim

  const parentSessionID = await resolveParentSessionID(item)
  if (!parentSessionID || !item.sessionID) {
    return TaskQueue.blockResultDelivery({
      id: item.id,
      claim,
      error: "Background subagent has no parent session to deliver to.",
    }).then((result) => result.item)
  }

  const failed = outcome.status === "failed" || outcome.status === "cancelled"
  const text = outcome.status === "completed" ? childVisibleText(outcome.result) : ""
  const errorMessage = failed ? outcome.error : undefined
  const handoff = formatBackgroundTaskHandoff({
    taskID: item.sessionID,
    title: item.title,
    state: failed ? "error" : "completed",
    text,
    errorMessage,
  })

  try {
    await persistParentHandoff(parentSessionID, handoff, item, claim)
    await BackgroundSubagentDeliveryInternals.afterPersist(item)
    const delivered = await TaskQueue.completeResultDelivery({
      id: item.id,
      claim,
      resultEmpty: failed || isEmptySubagentResultText(text),
    })
    wakeParent(parentSessionID)
    return delivered.item
  } catch (error) {
    log.warn("failed to deliver background subagent handoff", {
      taskQueueID: item.id,
      sessionID: item.sessionID,
      parentSessionID,
      error,
    })
    return TaskQueue.blockResultDelivery({
      id: item.id,
      claim,
      error: error instanceof Error ? error.message : "Failed to deliver background subagent result.",
    }).then((result) => result.item)
  }
}

export async function recoverBackgroundSubagentHandoffs() {
  const items = await TaskQueue.listBackgroundResultDeliveriesForRecovery()
  let delivered = 0
  let preserved = 0
  let blocked = 0

  for (const item of items) {
    try {
      let current = item
      const claim = TaskQueue.resultDeliveryClaim(current)
      if (claim?.owner === "waitfor") {
        if (await waitForResultWasPersisted(item, claim)) {
          await TaskQueue.completeResultDelivery({ id: item.id, claim })
          preserved++
          continue
        }
        const released = await TaskQueue.releaseWaitForResultDelivery({ id: item.id, claim })
        if (!released.released) {
          preserved++
          continue
        }
        current = released.item
      }

      const recovered = await deliverBackgroundSubagentHandoff({
        item: current,
        outcome: await recoveryOutcome(current),
      })
      if (recovered.payload["deliveryStatus"] === "delivered") delivered++
      else blocked++
    } catch (error) {
      blocked++
      log.warn("failed to recover background subagent handoff", {
        taskQueueID: item.id,
        sessionID: item.sessionID,
        error,
      })
    }
  }

  return { delivered, preserved, blocked }
}

async function resolveParentSessionID(item: TaskQueue.Info) {
  const fromPayload = item.payload["parentSessionID"]
  if (typeof fromPayload === "string" && fromPayload.startsWith("ses_")) return SessionID.make(fromPayload)
  if (!item.sessionID) return undefined
  const child = await Session.get(item.sessionID).catch(() => undefined)
  return child?.parentID
}

async function persistParentHandoff(
  parentSessionID: SessionID,
  text: string,
  item: TaskQueue.Info,
  claim: Extract<TaskQueue.ResultDeliveryClaim, { owner: "handoff" }>,
) {
  const messages = await Session.messages({ sessionID: parentSessionID })
  const lastUser = messages.findLast(
    (message) => message.info.role === "user" && !message.parts.some((part) => part.type === "compaction"),
  )
  const existing = await MessageV2.get({ sessionID: parentSessionID, messageID: claim.messageID }).catch(
    (error: unknown) => {
      if (NotFoundError.isInstance(error)) return undefined
      throw error
    },
  )
  const sourceUser =
    existing?.info.role === "user" ? existing.info : lastUser?.info.role === "user" ? lastUser.info : undefined
  const user = (await Session.updateMessage({
    id: claim.messageID,
    sessionID: parentSessionID,
    role: "user",
    time: { created: existing?.info.role === "user" ? existing.info.time.created : Date.now() },
    agent: sourceUser?.agent ?? item.agent ?? "build",
    model: sourceUser?.model ?? queueModel(item.model),
    tools: sourceUser?.tools,
    isolation: sourceUser?.isolation,
    system: sourceUser?.system,
    format: sourceUser?.format,
    variant: sourceUser?.variant,
    requestedDepth: sourceUser?.requestedDepth,
  })) as MessageV2.User
  await Session.updatePart({
    id: claim.partID,
    messageID: user.id,
    sessionID: user.sessionID,
    type: "text",
    text,
    synthetic: true,
    metadata: {
      source: "background_subagent_handoff",
      taskQueueID: item.id,
    },
  })
}

async function waitForResultWasPersisted(
  item: TaskQueue.Info,
  claim: Extract<TaskQueue.ResultDeliveryClaim, { owner: "waitfor" }>,
) {
  const message = await MessageV2.get({ sessionID: claim.sessionID, messageID: claim.messageID }).catch(
    (error: unknown) => {
      if (NotFoundError.isInstance(error)) return undefined
      throw error
    },
  )
  return message?.parts.some(
    (part) =>
      part.type === "tool" &&
      part.tool === "waitfor" &&
      part.callID === claim.callID &&
      part.state.status === "completed" &&
      part.state.metadata?.["taskID"] === item.id &&
      part.state.metadata?.["delivered"] === true,
  )
}

async function recoveryOutcome(
  item: TaskQueue.Info,
): Promise<
  | { status: "completed"; result: unknown }
  | { status: "failed"; error: string }
  | { status: "cancelled"; error: string }
> {
  if (item.status === "failed") {
    return { status: "failed", error: item.error ?? "Background subagent failed before delivery." }
  }
  if (item.status === "cancelled") {
    return { status: "cancelled", error: item.error ?? "Background subagent was cancelled before delivery." }
  }
  if (!item.sessionID) return { status: "completed", result: { parts: [] } }
  const messages = await Session.messages({ sessionID: item.sessionID }).catch((error: unknown) => {
    if (NotFoundError.isInstance(error)) return [] as MessageV2.WithParts[]
    throw error
  })
  return {
    status: "completed",
    result: messages.findLast((message) => message.info.role === "assistant") ?? { parts: [] },
  }
}

export function queueModel(model: unknown): MessageV2.User["model"] {
  if (!model || typeof model !== "object") {
    return { providerID: "unknown" as never, modelID: "unknown" as never }
  }
  const record = model as { providerID?: unknown; modelID?: unknown }
  if (typeof record.providerID === "string" && typeof record.modelID === "string") {
    return { providerID: record.providerID as never, modelID: record.modelID as never }
  }
  return { providerID: "unknown" as never, modelID: "unknown" as never }
}

function wakeParent(parentSessionID: SessionID) {
  // A direct parent that is collecting nested results finalizes on its own, and
  // a queued parent still has an active row that will drain and finalize. A
  // loop here would race that finalization and spend a turn on evidence the
  // parent is already folding in. Root sessions have neither and still wake.
  if (isCollectingNestedResults(parentSessionID)) return
  void SessionExecutionContext.detached(async () => {
    if (isCollectingNestedResults(parentSessionID)) return
    if (await hasActiveQueueRow(parentSessionID)) return
    await SessionPrompt.loop({ sessionID: parentSessionID })
  }).catch((error) => {
    log.warn("failed to wake parent after background subagent handoff", {
      sessionID: parentSessionID,
      error,
    })
  })
}
