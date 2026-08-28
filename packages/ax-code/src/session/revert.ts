import path from "path"
import z from "zod"
import { SessionID, MessageID, PartID } from "./schema"
import { Snapshot } from "../snapshot"
import { MessageV2 } from "./message-v2"
import { Session } from "."
import { Log } from "../util/log"
import { and, eq, inArray } from "../storage/db"
import { MessageTable, PartTable } from "./session.sql"
import { Storage } from "@/storage/storage"
import { Bus } from "../bus"
import { SessionPrompt } from "./prompt"
import { SessionShard } from "./shard"
import { Instance } from "../project/instance"
import { Filesystem } from "../util/filesystem"

export namespace SessionRevert {
  const log = Log.create({ service: "session.revert" })

  export const RevertInput = z.object({
    sessionID: SessionID.zod,
    messageID: MessageID.zod,
    partID: PartID.zod.optional(),
  })
  export type RevertInput = z.infer<typeof RevertInput>

  export type DescendantContribution = {
    sessionID: SessionID
    files: string[]
  }

  export type PreviewResult = {
    diffs: Snapshot.FileDiff[]
    descendants: DescendantContribution[]
  }

  type Position = {
    time: number
    id: string
  }

  type PatchEntry = Snapshot.Patch & {
    sessionID: SessionID
    position: Position
  }

  type Plan = {
    session: Session.Info
    revert: NonNullable<Session.Info["revert"]>
    patches: Snapshot.Patch[]
    descendants: DescendantContribution[]
  }

  function idOrderKey(id: string) {
    const separator = id.indexOf("_")
    return separator < 0 ? id : id.slice(separator + 1)
  }

  function after(left: Position, right: Position) {
    return left.time > right.time || (left.time === right.time && idOrderKey(left.id) > idOrderKey(right.id))
  }

  function displayFile(file: string) {
    const worktree = path.resolve(Instance.worktree)
    const resolved = path.resolve(worktree, file)
    if (resolved === worktree || !Filesystem.contains(worktree, resolved)) {
      throw new Error(`Session revert file escapes the current worktree: ${file}`)
    }
    return path.relative(worktree, resolved).replaceAll("\\", "/")
  }

  async function workspaceScope(sessionID: SessionID) {
    const session = await Session.get(sessionID)
    const worktree = path.resolve(Instance.worktree)
    const directory = path.resolve(session.directory)
    if (session.projectID !== Instance.project.id || !Filesystem.contains(worktree, directory)) {
      throw new Error(`Session revert target ${sessionID} is outside the current worktree`)
    }
    const descendants = (await Session.descendants(sessionID)).filter((candidate) => {
      const candidateDirectory = path.resolve(candidate.directory)
      return Filesystem.contains(worktree, candidateDirectory) && candidateDirectory === directory
    })
    return { session, descendants, sessions: [session, ...descendants] }
  }

  function assertIdle(sessions: Session.Info[]) {
    for (const session of sessions) SessionPrompt.assertNotBusy(session.id)
  }

  async function resolveRootBoundary(input: RevertInput) {
    const all = await Session.messages({ sessionID: input.sessionID })
    let lastUser: MessageV2.User | undefined
    for (const msg of all) {
      if (msg.info.role === "user") lastUser = msg.info
      if (msg.info.id === input.messageID && input.partID === undefined) {
        const first = msg.parts[0]
        return {
          revert: {
            messageID: lastUser ? lastUser.id : msg.info.id,
          } satisfies NonNullable<Session.Info["revert"]>,
          snapshot: first?.type === "step-start" ? first.snapshot : undefined,
        }
      }
      const remaining: MessageV2.Part[] = []
      for (const part of msg.parts) {
        const match = msg.info.id === input.messageID && part.id === input.partID
        if (match) {
          // if no useful parts left in message, same as reverting whole message
          const partID = remaining.some((item) => ["text", "tool"].includes(item.type)) ? input.partID : undefined
          return {
            revert: {
              messageID: !partID && lastUser ? lastUser.id : msg.info.id,
              partID,
            } satisfies NonNullable<Session.Info["revert"]>,
            snapshot: part.type === "step-start" ? part.snapshot : undefined,
          }
        }
        remaining.push(part)
      }
    }
    throw new Error(`Session revert failed: message ${input.messageID} not found in session ${input.sessionID}`)
  }

  function boundaryPosition(input: RevertInput, store: SessionShard.Store): Position {
    if (input.partID) {
      const row = store.use((db) =>
        db
          .select({ id: PartTable.id, time: PartTable.time_created })
          .from(PartTable)
          .where(
            and(
              eq(PartTable.id, input.partID!),
              eq(PartTable.message_id, input.messageID),
              eq(PartTable.session_id, input.sessionID),
            ),
          )
          .get(),
      )
      if (row) return row
    } else {
      const row = store.use((db) =>
        db
          .select({ id: MessageTable.id, time: MessageTable.time_created })
          .from(MessageTable)
          .where(and(eq(MessageTable.id, input.messageID), eq(MessageTable.session_id, input.sessionID)))
          .get(),
      )
      if (row) return row
    }
    throw new Error(`Session revert boundary ${input.messageID} disappeared`)
  }

  function patchEntries(store: SessionShard.Store, sessionIDs: SessionID[], boundary: Position) {
    const rows = store.use((db) =>
      db
        .select()
        .from(PartTable)
        .where(inArray(PartTable.session_id, sessionIDs))
        .orderBy(PartTable.time_created, PartTable.id)
        .all(),
    )
    const result: PatchEntry[] = []
    for (const row of rows) {
      const position = { time: row.time_created, id: row.id }
      if (!after(position, boundary)) continue
      const parsed = MessageV2.Part.safeParse({
        ...row.data,
        id: row.id,
        messageID: row.message_id,
        sessionID: row.session_id,
      })
      if (!parsed.success || parsed.data.type !== "patch") continue
      result.push({
        hash: parsed.data.hash,
        files: parsed.data.files,
        sessionID: row.session_id,
        position,
      })
    }
    return result
  }

  function contributions(session: Session.Info, entries: PatchEntry[]) {
    const filesBySession = new Map<SessionID, Set<string>>()
    for (const entry of entries) {
      if (entry.sessionID === session.id) continue
      const files = filesBySession.get(entry.sessionID) ?? new Set<string>()
      for (const file of entry.files) files.add(displayFile(file))
      filesBySession.set(entry.sessionID, files)
    }
    return [...filesBySession].map(([sessionID, files]) => ({ sessionID, files: [...files] }))
  }

  async function plan(input: RevertInput): Promise<Plan> {
    const scope = await workspaceScope(input.sessionID)
    assertIdle(scope.sessions)
    const rootBoundary = await resolveRootBoundary(input)
    const store = SessionShard.storeFor(input.sessionID)
    const boundary = boundaryPosition(input, store)
    const entries = patchEntries(
      store,
      scope.sessions.map((session) => session.id),
      boundary,
    )
    const files = [...new Set(entries.flatMap((entry) => entry.files))]
    const patches: Snapshot.Patch[] = entries.map(({ hash, files: changed }) => ({ hash, files: changed }))
    if (rootBoundary.snapshot && files.length > 0) {
      patches.unshift({ hash: rootBoundary.snapshot, files })
    }
    return {
      session: scope.session,
      revert: rootBoundary.revert,
      patches,
      descendants: contributions(scope.session, entries),
    }
  }

  export async function preview(input: RevertInput): Promise<PreviewResult> {
    const planned = await plan(input)
    const diffs = await Snapshot.previewRevert(planned.patches)
    const changedFiles = new Set(diffs.map((diff) => diff.file))
    return {
      diffs,
      descendants: planned.descendants.flatMap((item) => {
        const files = item.files.filter((file) => changedFiles.has(file))
        return files.length > 0 ? [{ ...item, files }] : []
      }),
    }
  }

  export async function revert(input: RevertInput) {
    const planned = await plan(input)
    const before = await Snapshot.track()
    planned.revert.snapshot = planned.session.revert?.snapshot ?? before
    const files = [...new Set(planned.patches.flatMap((patch) => patch.files))]
    let applied = false
    let diffs: Snapshot.FileDiff[] = []
    let next: Session.Info
    try {
      await Snapshot.revert(planned.patches)
      applied = true
      const after = await Snapshot.track()
      diffs = before && after ? await Snapshot.diffFull(after, before) : []
      if (planned.revert.snapshot) planned.revert.diff = await Snapshot.diff(planned.revert.snapshot)
      next = await Session.setRevert({
        sessionID: input.sessionID,
        revert: planned.revert,
        summary: {
          additions: diffs.reduce((sum, item) => sum + item.additions, 0),
          deletions: diffs.reduce((sum, item) => sum + item.deletions, 0),
          files: diffs.length,
        },
      })
    } catch (error) {
      if (applied && before && files.length > 0) {
        await Snapshot.revert([{ hash: before, files }]).catch((rollbackError) => {
          log.error("failed to restore workspace after session revert failure", {
            sessionID: input.sessionID,
            error: rollbackError,
          })
        })
      }
      throw error
    }

    await Storage.write(["session_diff", input.sessionID], diffs).catch((error) => {
      log.error("failed to persist session diff after revert", { sessionID: input.sessionID, error })
    })
    try {
      await Bus.publish(Session.Event.Diff, {
        sessionID: input.sessionID,
        diff: diffs,
      })
    } catch (error) {
      log.error("failed to publish session diff after revert", { sessionID: input.sessionID, error })
    }
    return next
  }

  export async function unrevert(input: { sessionID: SessionID }) {
    log.info("unreverting", input)
    const scope = await workspaceScope(input.sessionID)
    assertIdle(scope.sessions)
    const session = scope.session
    if (!session.revert) return session
    if (session.revert.snapshot) await Snapshot.restore(session.revert.snapshot)
    return Session.clearRevert(input.sessionID)
  }

  export async function cleanup(session: Session.Info) {
    if (!session.revert) return
    const sessionID = session.id
    const msgs = await Session.messages({ sessionID })
    const messageID = session.revert.messageID
    const preserve = [] as MessageV2.WithParts[]
    const remove = [] as MessageV2.WithParts[]
    const removedParts = [] as MessageV2.Part[]
    let target: MessageV2.WithParts | undefined
    const targetIndex = msgs.findIndex((msg) => msg.info.id === messageID)
    if (targetIndex === -1) {
      // The boundary message is gone, so we can no longer determine which
      // trailing messages the revert meant to delete. Leaving `session.revert`
      // in place would wedge the session: every later prompt re-runs this
      // cleanup, re-logs the same warning, and the pending-revert state never
      // clears. Drop the revert bookkeeping instead — the surviving messages
      // stay visible, which is safer than guessing a deletion range.
      log.warn("revert boundary message is missing during cleanup, clearing revert state", { sessionID, messageID })
      await Session.clearRevert(sessionID)
      return
    }
    preserve.push(...msgs.slice(0, targetIndex))
    if (session.revert.partID) {
      target = msgs[targetIndex]
      preserve.push(target)
      remove.push(...msgs.slice(targetIndex + 1))
    } else {
      remove.push(...msgs.slice(targetIndex))
    }
    if (session.revert.partID && target) {
      const partID = session.revert.partID
      const removeStart = target.parts.findIndex((part) => part.id === partID)
      if (removeStart >= 0) {
        const preserveParts = target.parts.slice(0, removeStart)
        const removeParts = target.parts.slice(removeStart)
        target.parts = preserveParts
        removedParts.push(...removeParts)
      }
    }
    const store = SessionShard.storeFor(sessionID, { write: true })
    store.transaction((db) => {
      for (const msg of remove) {
        db.delete(MessageTable).where(eq(MessageTable.id, msg.info.id)).run()
      }
      for (const part of removedParts) {
        db.delete(PartTable).where(eq(PartTable.id, part.id)).run()
      }
    })
    for (const msg of remove) {
      await Bus.publish(MessageV2.Event.Removed, { sessionID: sessionID, messageID: msg.info.id })
    }
    if (target) {
      for (const part of removedParts) {
        await Bus.publish(MessageV2.Event.PartRemoved, {
          sessionID: sessionID,
          messageID: target.info.id,
          partID: part.id,
        })
      }
    }
    await Session.clearRevert(sessionID)
  }
}
