import { Database } from "../storage/db"
import { Instance } from "../project/instance"
import { Session } from "."
import { SessionExecutionContext } from "./execution-context"
import { SessionExecutionRecovery } from "./execution-recovery"
import { ForegroundOwnership } from "./foreground-ownership"
import type { SessionID } from "./schema"

export namespace SessionExecution {
  type Owner = {
    lease: ForegroundOwnership.Lease
    stamp: SessionExecutionContext.Stamp
    references: number
    sessionID: SessionID
    directory: string
  }
  type Turn = { context: SessionExecutionContext.Turn; owner: Owner; references: number; handoff: boolean }
  const turns = new WeakMap<SessionExecutionContext.Turn, Turn>()

  function originating(sessionID: SessionID) {
    const context = SessionExecutionContext.peek()
    const turn = context?.sessionID === sessionID ? turns.get(context) : undefined
    return turn?.owner.directory === Instance.directory ? turn : undefined
  }

  function acquire(sessionID: SessionID) {
    // Initialize the registry before resolving its canonical filesystem path.
    Database.use(() => {})
    try {
      return ForegroundOwnership.acquire(Database.Path, sessionID)
    } catch (error) {
      if (ForegroundOwnership.BusyError.isInstance(error)) throw new Session.BusyError(sessionID)
      throw error
    }
  }

  export function assertAvailable(sessionID: SessionID) {
    const turn = originating(sessionID)
    if (turn?.context.active && turn.handoff) return
    const lease = acquire(sessionID)
    lease.release(false)
  }

  function successor(owner: Owner): Turn {
    const turn: Turn = {
      context: { sessionID: owner.sessionID, stamp: owner.stamp, active: true },
      owner,
      references: 0,
      handoff: false,
    }
    turns.set(turn.context, turn)
    return turn
  }

  function retain(turn: Turn) {
    turn.references++
    turn.owner.references++
  }

  function release(turn: Turn) {
    if (--turn.references === 0) turn.context.active = false
    if (--turn.owner.references !== 0) return
    let clean = false
    try {
      clean = !SessionExecutionRecovery.hasUnfinished(turn.owner.sessionID, turn.owner.stamp.generation)
    } finally {
      turn.owner.lease.release(clean)
    }
  }

  async function run<T>(turn: Turn, body: () => Promise<T>, retained = false): Promise<T> {
    if (!retained) retain(turn)
    try {
      return await SessionExecutionContext.provide(turn.context, body)
    } finally {
      release(turn)
    }
  }

  export async function withRun<T>(sessionID: SessionID, body: () => Promise<T>): Promise<T> {
    SessionExecutionContext.assertWritable()
    const current = originating(sessionID)
    if (current?.context.active) {
      if (!current.handoff) return run(current, body)
      current.context.active = false
      return run(successor(current.owner), body)
    }
    const lease = acquire(sessionID)
    let stamp: SessionExecutionContext.Stamp
    try {
      if (lease.previous) SessionExecutionRecovery.recover(sessionID, lease.previous.generation)
      const journal = lease.begin()
      stamp = { version: journal.version, generation: journal.generation }
    } catch (error) {
      lease.release(false)
      throw error
    }
    return run(successor({ lease, stamp, sessionID, directory: Instance.directory, references: 0 }), body)
  }

  // Called only after the originating loop/shell has finished all transcript
  // cleanup. The following local admission may transfer, without unlocking.
  export function prepareHandoff(sessionID: SessionID) {
    const current = originating(sessionID)
    if (current?.context.active) current.handoff = true
  }

  // Queue execution starts on a timer. Reserve a reference before scheduling
  // it, so the predecessor's finally cannot release the guard in that gap.
  export function bindSuccessor(
    sessionID: SessionID | undefined,
    body: () => Promise<void>,
  ): (() => Promise<void>) & { cancel(): void } {
    const current = sessionID ? originating(sessionID) : undefined
    let next: Turn | undefined
    if (current?.context.active && current.handoff) {
      current.context.active = false
      next = successor(current.owner)
      retain(next)
    }
    let state: "pending" | "running" | "finished" | "cancelled" = "pending"
    return Object.assign(
      async () => {
        if (state !== "pending") return
        state = "running"
        try {
          if (next) await run(next, body, true)
          else await SessionExecutionContext.detached(body)
        } finally {
          state = "finished"
        }
      },
      {
        cancel() {
          if (state !== "pending") return
          state = "cancelled"
          if (next) release(next)
        },
      },
    )
  }
}
