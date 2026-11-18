import { Instance } from "@/project/instance"
import { abortError } from "@/util/abort"
import { Log } from "@/util/log"
import { sleep } from "@/util/timeout"
import { NotFoundError } from "@/storage/db"
import { Session } from "."
import { SessionExecution } from "./execution"
import { MessageV2 } from "./message-v2"
import { SessionPrompt } from "./prompt"
import {
  runInBackgroundSubagentSession,
  wakeBackgroundSubagentSession,
  writeBackgroundSubagentMessage,
  type BackgroundSubagentRecipient,
} from "./background-subagent-message"
import { MessageID, PartID, SessionID } from "./schema"
import { TaskQueue } from "./task-queue"
import { childVisibleText, formatBackgroundTaskHandoff, isEmptySubagentResultText } from "./background-subagent-handoff"

const log = Log.create({ service: "session.background-subagent-delivery" })

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
          kind: "subagent",
          source: "task",
          parentSessionID: sessionID,
          limit: 500,
          descending: true,
        }),
      ),
    )
  ).flat()
  return {
    active: rows.filter((item) => !TaskQueue.isTerminalStatus(item.status)),
    terminal: rows.filter((item) => TaskQueue.isTerminalStatus(item.status)),
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

async function hasActiveQueueRow(sessionID: SessionID): Promise<boolean> {
  const items = await TaskQueue.list({
    sessionID,
    kind: "subagent",
    source: "task",
    statuses: [...TaskQueue.nonterminalStatuses],
    limit: 500,
  })
  return items.length > 0
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
  const { outcome } = input
  if (!TaskQueue.isTaskSubagent(input.item)) return input.item

  const requestedClaim: TaskQueue.ResultDeliveryClaim = {
    owner: "handoff",
    messageID: MessageID.ascending(),
    partID: PartID.ascending(),
    time: Date.now(),
  }
  const selection = await TaskQueue.claimResultDelivery({ id: input.item.id, claim: requestedClaim })
  const { item, claim } = selection
  if (!selection.accepted || claim?.owner !== "handoff") return item

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
    const parent = await Session.get(parentSessionID)
    if (parent.projectID !== item.projectID) {
      throw new Error("Background subagent handoff has a parent in a different project.")
    }
    await writeBackgroundSubagentMessage({
      recipient: parent,
      messageID: claim.messageID,
      item,
      part: {
        id: claim.partID,
        text: handoff,
        synthetic: true,
        metadata: { source: "background_subagent_handoff", taskQueueID: item.id },
      },
      afterCommit: (message) => SessionPrompt.recordContinuation(message),
    })
    await BackgroundSubagentDeliveryInternals.afterPersist(item)
    const delivered = await TaskQueue.completeResultDelivery({
      id: item.id,
      claim,
      resultEmpty: failed || isEmptySubagentResultText(text),
    })
    if (delivered.completed) wakeParent(parent)
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
  const saved: SavedHandoff[] = []

  for (const item of items) {
    try {
      let current = item
      const claim = TaskQueue.resultDeliveryClaim(current)
      if (current.payload["deliveryStatus"] === "delivered" && claim?.owner === "handoff") {
        const parentID = await resolveParentSessionID(current)
        if (parentID) saved.push({ parentID, taskID: current.id, claim })
        continue
      }
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

  for (const handoff of saved) {
    await recoverParentWake(handoff).catch((error) => {
      log.warn("failed to recover parent wake after background subagent handoff", {
        sessionID: handoff.parentID,
        error,
      })
    })
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

type SavedHandoff = {
  parentID: SessionID
  taskID: TaskQueue.Info["id"]
  claim: Extract<TaskQueue.ResultDeliveryClaim, { owner: "handoff" }>
}

async function isUnansweredHandoff(handoff: SavedHandoff): Promise<boolean> {
  for await (const { info, parts } of MessageV2.stream(handoff.parentID)) {
    if (info.role === "assistant") {
      const interrupted =
        MessageV2.AbortedError.isInstance(info.error) && info.error.data.metadata?.reason === "backend_restart"
      if (interrupted) continue
      // Respect a terminal response or deliberate stop. An intermediate
      // tool step can still need the ordinary prompt loop to finish.
      if (info.error || (info.time.completed !== undefined && info.finish !== "tool-calls")) return false
      continue
    }

    // A later request supersedes the handoff. Match both parts of the
    // durable claim before letting startup recovery drive the transcript.
    return (
      info.id === handoff.claim.messageID &&
      parts.some(
        (part) =>
          part.id === handoff.claim.partID &&
          part.type === "text" &&
          part.synthetic === true &&
          part.metadata?.["source"] === "background_subagent_handoff" &&
          part.metadata?.["taskQueueID"] === handoff.taskID,
      )
    )
  }
  return false
}

async function recoverParentWake(handoff: SavedHandoff): Promise<void> {
  const parent = await Session.get(handoff.parentID).catch((error: unknown) => {
    if (NotFoundError.isInstance(error)) return undefined
    throw error
  })
  if (!parent || parent.projectID !== Instance.project.id || parent.time.archived !== undefined) return
  // Read only the tail before entering a workspace. Historical handoffs
  // that already have a response should not boot a workspace at startup.
  if (!(await isUnansweredHandoff(handoff)) || !(await canWakeParent(parent.id))) return
  void runInBackgroundSubagentSession(parent, () =>
    SessionExecution.withRun(parent.id, async () => {
      // Hold the foreground lease while checking for a newer turn. A peer
      // can finish or supersede the handoff between discovery and admission.
      const current = await Session.get(parent.id)
      if (
        current.directory !== parent.directory ||
        current.projectID !== parent.projectID ||
        current.time.archived !== undefined
      )
        return
      if (!(await canWakeParent(parent.id)) || !(await isUnansweredHandoff(handoff))) return

      const item = await TaskQueue.get(handoff.taskID)
      const claim = TaskQueue.resultDeliveryClaim(item)
      if (
        item.payload["deliveryStatus"] !== "delivered" ||
        claim?.owner !== "handoff" ||
        claim.messageID !== handoff.claim.messageID ||
        claim.partID !== handoff.claim.partID ||
        (await resolveParentSessionID(item)) !== parent.id
      )
        return
      await SessionPrompt.loop({ sessionID: parent.id })
    }),
  ).catch((error) => {
    if (error instanceof Session.BusyError) return
    logParentWakeFailure(parent, error)
  })
}

async function canWakeParent(sessionID: SessionID): Promise<boolean> {
  // Direct parents collecting nested results and queued parents finalize in
  // their own execution once the handoffs land.
  return !isCollectingNestedResults(sessionID) && !(await hasActiveQueueRow(sessionID))
}

function logParentWakeFailure(parent: BackgroundSubagentRecipient, error: unknown): void {
  log.warn("failed to wake parent after background subagent handoff", {
    sessionID: parent.id,
    directory: parent.directory,
    error,
  })
}

function wakeParent(parent: BackgroundSubagentRecipient): void {
  if (isCollectingNestedResults(parent.id)) return
  void wakeBackgroundSubagentSession(parent, () => canWakeParent(parent.id)).catch((error) =>
    logParentWakeFailure(parent, error),
  )
}
