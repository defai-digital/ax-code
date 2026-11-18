import { HTTPException } from "hono/http-exception"
import z from "zod"
import { Instance } from "../project/instance"
import { Session } from "../session"
import { SessionID } from "../session/schema"
import { NotFoundError } from "../storage/db"
import { Storage } from "../storage/storage"
import { Filesystem } from "../util/filesystem"
import { Hash } from "../util/hash"
import { Log } from "../util/log"
import type { WorkflowPermissions } from "./spec"
import { WorkflowChildWorktree, WorkflowPhaseID, type WorkflowPhaseRecord, type WorkflowRunID } from "./state"

const log = Log.create({ service: "workflow.phase-preparation" })
const Target = z.object({ directory: z.string().min(1), payload: WorkflowChildWorktree })
const Slot = z.object({
  sessionID: SessionID.zod,
  target: Target,
  pending: z.literal(true).optional(),
})
const Checkpoint = z.object({ phaseID: WorkflowPhaseID.zod, slots: z.array(Slot) })

type WorkflowChildRuntimeTarget = z.output<typeof Target>
type PreparedSlot = z.output<typeof Slot>
type WritePolicy = WorkflowPermissions["writePolicy"]
type PhasePreparation = {
  reserve: (index: number, writePolicy: WritePolicy) => Promise<PreparedSlot>
  clear: () => Promise<void>
}

/** The scheduler holds the run lock until queue admission finishes. */
export async function loadPhasePreparation(
  runID: WorkflowRunID,
  phase: Pick<WorkflowPhaseRecord, "id" | "specPhaseID">,
): Promise<PhasePreparation> {
  const phaseID = phase.id
  const key = ["workflow-phase-preparation", Hash.fast(`${Instance.project.id}:${runID}`)]
  const stored = await Storage.read<unknown>(key).catch((error) => {
    if (Storage.NotFoundError.isInstance(error)) return undefined
    throw error
  })
  const previous = stored === undefined ? undefined : Checkpoint.parse(stored)
  const checkpoint = previous?.phaseID === phaseID ? previous : { phaseID, slots: [] }

  return {
    async reserve(index, writePolicy) {
      let slot = checkpoint.slots[index]
      if (!slot) {
        const target = await planTarget(runID, phase.specPhaseID, index, writePolicy)
        slot = {
          sessionID: SessionID.descending(),
          target,
          pending: target.payload.mode === "dedicated" ? true : undefined,
        }
        checkpoint.slots[index] = slot
        // Save both identities before creating a Git checkout or a registry row.
        await Storage.write(key, checkpoint)
      }

      const target = slot.target
      if (
        target.payload.mode === "current" &&
        (target.directory !== Instance.directory ||
          Filesystem.resolve(target.payload.directory) !== Filesystem.resolve(Instance.worktree))
      ) {
        throw new HTTPException(409, { message: "A prepared workflow child points outside the original workspace." })
      }
      if (slot.pending) {
        await prepareDedicatedWorktree(target)
        target.directory = Filesystem.resolve(target.directory)
        delete slot.pending
        await Storage.write(key, checkpoint)
      } else if (target.payload.mode === "dedicated") {
        const { Worktree } = await import("../worktree")
        const worktrees = await Worktree.list()
        const registered = worktrees.some(
          (worktree) =>
            Filesystem.resolve(worktree.directory) === target.directory && worktree.branch === target.payload.branch,
        )
        if (!registered) {
          throw new HTTPException(409, { message: "A prepared workflow worktree is no longer available." })
        }
      }
      return slot
    },
    async clear() {
      // Admission has committed. Failure to remove its recovery record must
      // not prevent dispatch of the committed queue items.
      await Storage.remove(key).catch((error) => {
        log.warn("failed to clear workflow phase preparation", { runID, phaseID, error })
      })
    },
  }
}

async function planTarget(
  runID: WorkflowRunID,
  specPhaseID: string,
  index: number,
  writePolicy: WritePolicy,
): Promise<WorkflowChildRuntimeTarget> {
  if (writePolicy !== "worktree-required") {
    return {
      directory: Instance.directory,
      payload: { mode: "current", directory: Instance.worktree },
    }
  }

  const { Worktree } = await import("../worktree")
  const info = await Worktree.makeWorktreeInfo(`workflow-${runID}-${specPhaseID}-${index + 1}`, {
    reserveDirectory: false,
  })
  return {
    directory: info.directory,
    payload: { mode: "dedicated", ...info },
  }
}

async function prepareDedicatedWorktree(target: WorkflowChildRuntimeTarget): Promise<void> {
  const { Worktree } = await import("../worktree")
  const info = Worktree.Info.parse(target.payload)
  const bootstrap = await Worktree.createFromInfo(info, undefined, undefined, { resume: true })
  if (!(await bootstrap())) {
    throw new Worktree.StartCommandFailedError({ message: "Workflow worktree failed to become ready" })
  }
}

export async function prepareWorkflowChildSession(
  sessionID: SessionID,
  input: { parentID?: SessionID; title: string },
): Promise<Session.Info> {
  const existing = await Session.get(sessionID).catch((error) => {
    if (NotFoundError.isInstance(error)) return undefined
    throw error
  })
  if (!existing) return Session.create({ id: sessionID, ...input })
  if (
    existing.projectID !== Instance.project.id ||
    existing.directory !== Instance.directory ||
    existing.parentID !== input.parentID
  ) {
    throw new HTTPException(409, {
      message: "A prepared workflow session no longer belongs to its original workspace.",
    })
  }
  return existing
}
