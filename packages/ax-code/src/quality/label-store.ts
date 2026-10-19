import z from "zod"
import { Storage } from "../storage/storage"
import { ProbabilisticRollout } from "./probabilistic-rollout"
import { QualityStorageKey } from "./storage-key"
import { jsonEqual } from "./json"
import { compareStringFields } from "./sort"

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

  const encode = QualityStorageKey.encode
  const decode = QualityStorageKey.decode

  function key(sessionID: string, labelID: string) {
    // Imported label files carry arbitrary ids; both segments are storage path
    // components, so encode them like the shadow store does.
    return ["quality_label", encode(sessionID), encode(labelID)]
  }

  function sortLabels(labels: ProbabilisticRollout.Label[]) {
    return [...labels].sort((a, b) => compareStringFields(a, b, ["labeledAt", "labelID"]))
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
      if (jsonEqual(existing, next)) return existing
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
    const keys = await Storage.list(["quality_label", encode(sessionID)])
    const labels: ProbabilisticRollout.Label[] = []
    for (const parts of keys) {
      // Skip records written by older builds as nested paths; they are not
      // addressable as a single label id.
      if (parts.length !== 3) continue
      const labelID = decode(parts[parts.length - 1]!)
      if (!labelID) continue
      const record = await get({ sessionID, labelID })
      if (workflow && record.label.workflow !== workflow) continue
      labels.push(record.label)
    }
    return sortLabels(labels)
  }

  export async function exportFile(input: { sessionIDs: string[]; workflow?: ProbabilisticRollout.Workflow }) {
    const labels = (await Promise.all(input.sessionIDs.map((sessionID) => list(sessionID, input.workflow)))).flat()

    return ProbabilisticRollout.LabelFile.parse({
      schemaVersion: 1,
      kind: "ax-code-quality-label-file",
      labels: sortLabels(labels),
    })
  }
}
