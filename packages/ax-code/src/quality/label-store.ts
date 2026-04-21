import z from "zod"
import { Storage } from "../storage/storage"
import { ProbabilisticRollout } from "./probabilistic-rollout"

export namespace QualityLabelStore {
  export const LabelRecord = z.object({
    schemaVersion: z.literal(1),
    kind: z.literal("ax-code-quality-label-record"),
    label: z.lazy(() => ProbabilisticRollout.Label),
  })
  export type LabelRecord = z.output<typeof LabelRecord>

  function requireSessionID(label: ProbabilisticRollout.Label) {
    if (!label.sessionID) {
      throw new Error(`Label ${label.labelID} is missing sessionID and cannot be persisted to session-scoped storage`)
    }
    return label.sessionID
  }

  function key(sessionID: string, labelID: string) {
    return ["quality_label", sessionID, labelID]
  }

  function sortLabels(labels: ProbabilisticRollout.Label[]) {
    return [...labels].sort((a, b) => {
      const byTime = a.labeledAt.localeCompare(b.labeledAt)
      if (byTime !== 0) return byTime
      return a.labelID.localeCompare(b.labelID)
    })
  }

  export async function get(label: { sessionID: string; labelID: string }) {
    const record = await Storage.read<unknown>(key(label.sessionID, label.labelID))
    return LabelRecord.parse(record)
  }

  export async function append(label: ProbabilisticRollout.Label) {
    const sessionID = requireSessionID(label)
    const next = LabelRecord.parse({
      schemaVersion: 1,
      kind: "ax-code-quality-label-record",
      label,
    })

    try {
      const existing = await get({ sessionID, labelID: label.labelID })
      const prev = JSON.stringify(existing)
      const curr = JSON.stringify(next)
      if (prev === curr) return existing
      throw new Error(`Label ${label.labelID} already exists for session ${sessionID} with different content`)
    } catch (err) {
      if (!Storage.NotFoundError.isInstance(err)) throw err
      await Storage.write(key(sessionID, label.labelID), next)
      return next
    }
  }

  export async function appendMany(labels: ProbabilisticRollout.Label[]) {
    const out: LabelRecord[] = []
    for (const label of labels) {
      out.push(await append(label))
    }
    return out
  }

  export async function list(sessionID: string, workflow?: ProbabilisticRollout.Workflow) {
    const keys = await Storage.list(["quality_label", sessionID])
    const labels: ProbabilisticRollout.Label[] = []
    for (const parts of keys) {
      const labelID = parts[parts.length - 1]
      if (!labelID) continue
      const record = await get({ sessionID, labelID })
      if (workflow && record.label.workflow !== workflow) continue
      labels.push(record.label)
    }
    return sortLabels(labels)
  }

  export async function exportFile(input: { sessionIDs: string[]; workflow?: ProbabilisticRollout.Workflow }) {
    const labels = (
      await Promise.all(input.sessionIDs.map((sessionID) => list(sessionID, input.workflow)))
    ).flat()

    return ProbabilisticRollout.LabelFile.parse({
      schemaVersion: 1,
      kind: "ax-code-quality-label-file",
      labels: sortLabels(labels),
    })
  }
}
