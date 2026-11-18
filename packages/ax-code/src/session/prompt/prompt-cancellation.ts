import { Log } from "@/util/log"
import type { SessionID } from "../schema"
import type { TaskQueue } from "../task-queue"
import type { createPromptRunState } from "./prompt-run-state"

const log = Log.create({ service: "session.prompt-cancellation" })

export type PromptCancelOptions = {
  interrupt?: boolean
  cancelQueueItems?: boolean
  silent?: boolean
  shouldInterrupt?: () => boolean
}

type Target = {
  sessionID: SessionID
  signal?: AbortSignal
  queue: readonly TaskQueue.Info[]
  children: Target[]
}

export async function cancelPromptTree(
  sessionID: SessionID,
  options: PromptCancelOptions,
  runState: Pick<ReturnType<typeof createPromptRunState>, "cancellationSignal" | "cancel">,
): Promise<boolean> {
  const signal = runState.cancellationSignal(sessionID)
  if (options.shouldInterrupt?.() === false) return false
  const { Session } = await import("..")
  const { TaskQueue } = await import("../task-queue")
  const seen = new Set([sessionID])

  async function capture(id: SessionID, signal: AbortSignal | undefined, readQueue: boolean): Promise<Target> {
    const queue = readQueue
      ? await TaskQueue.captureSessionCancellation(id).catch((error) => {
          log.warn("failed to capture task queue items during session abort", { sessionID: id, error })
          return []
        })
      : []
    const children = await Session.children(id).catch((error) => {
      log.warn("failed to list child sessions during cancel cascade", { sessionID: id, error })
      return []
    })
    const descendants = children.flatMap(({ id }) => {
      if (seen.has(id)) return []
      seen.add(id)
      return [{ id, signal: runState.cancellationSignal(id) }]
    })
    const targets: Target[] = []
    for (const child of descendants) targets.push(await capture(child.id, child.signal, true))
    return { sessionID: id, signal, queue, children: targets }
  }

  const root = await capture(sessionID, signal, options.cancelQueueItems !== false || options.interrupt === true)
  async function cancel(target: Target, opts: PromptCancelOptions = {}): Promise<boolean> {
    const current = () =>
      opts.shouldInterrupt?.() !== false && runState.cancellationSignal(target.sessionID) === target.signal
    if (!current()) return false
    if (opts.interrupt) {
      // Park the captured followups before publishing idle. A replacement
      // admitted during this wait has its own queue and prompt identity.
      await TaskQueue.pauseFollowupsForSession(target.sessionID, target.queue).catch((error) => {
        log.warn("failed to pause pending follow-ups before session abort", { sessionID: target.sessionID, error })
      })
      if (!current()) return false
    }
    await runState.cancel(target.sessionID, { interrupted: opts.interrupt, silent: opts.silent })
    for (const child of target.children) {
      await cancel(child).catch((error) => {
        log.warn("failed to cancel child session", { sessionID: target.sessionID, childID: child.sessionID, error })
      })
    }
    if (opts.cancelQueueItems !== false) {
      await TaskQueue.cancelForSession(target.sessionID, undefined, {
        preservePausedFollowups: opts.interrupt,
        targets: target.queue,
      }).catch((error) => {
        log.warn("failed to cancel task queue items during session abort", { sessionID: target.sessionID, error })
      })
    }
    return true
  }
  return cancel(root, options)
}
