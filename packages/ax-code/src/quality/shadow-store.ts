import z from "zod"
import { Storage } from "../storage/storage"
import { ProbabilisticRollout } from "./probabilistic-rollout"

export namespace QualityShadowStore {
  export const ShadowRecordEnvelope = z.object({
    schemaVersion: z.literal(1),
    kind: z.literal("ax-code-quality-shadow-record-envelope"),
    record: z.lazy(() => ProbabilisticRollout.ShadowRecord),
  })
  export type ShadowRecordEnvelope = z.output<typeof ShadowRecordEnvelope>

  function encode(input: string) {
    return encodeURIComponent(input)
  }

  function decode(input: string) {
    return decodeURIComponent(input)
  }

  function key(sessionID: string, candidateSource: string, artifactID: string) {
    return ["quality_shadow", sessionID, encode(candidateSource), encode(artifactID)]
  }

  function sortRecords(records: ProbabilisticRollout.ShadowRecord[]) {
    return [...records].sort((a, b) => {
      const bySession = a.sessionID.localeCompare(b.sessionID)
      if (bySession !== 0) return bySession
      const byCreated = a.createdAt.localeCompare(b.createdAt)
      if (byCreated !== 0) return byCreated
      return a.artifactID.localeCompare(b.artifactID)
    })
  }

  export async function get(input: { sessionID: string; candidateSource: string; artifactID: string }) {
    const record = await Storage.read<unknown>(key(input.sessionID, input.candidateSource, input.artifactID))
    return ShadowRecordEnvelope.parse(record)
  }

  export async function upsert(record: ProbabilisticRollout.ShadowRecord) {
    const next = ShadowRecordEnvelope.parse({
      schemaVersion: 1,
      kind: "ax-code-quality-shadow-record-envelope",
      record,
    })
    const storageKey = key(record.sessionID, record.candidate.source, record.artifactID)

    try {
      const existing = await get({
        sessionID: record.sessionID,
        candidateSource: record.candidate.source,
        artifactID: record.artifactID,
      })
      const prev = JSON.stringify(existing)
      const curr = JSON.stringify(next)
      if (prev === curr) return existing
    } catch (err) {
      if (!Storage.NotFoundError.isInstance(err)) throw err
    }

    await Storage.write(storageKey, next)
    return next
  }

  export async function list(sessionID: string, candidateSource?: string) {
    const prefixes = candidateSource ? [["quality_shadow", sessionID, encode(candidateSource)]] : [["quality_shadow", sessionID]]
    const records: ProbabilisticRollout.ShadowRecord[] = []

    for (const prefix of prefixes) {
      const keys = await Storage.list(prefix)
      for (const parts of keys) {
        const encodedCandidate = parts[parts.length - 2]
        const encodedArtifact = parts[parts.length - 1]
        if (!encodedCandidate || !encodedArtifact) continue
        const envelope = await get({
          sessionID,
          candidateSource: decode(encodedCandidate),
          artifactID: decode(encodedArtifact),
        })
        records.push(envelope.record)
      }
    }

    return sortRecords(records)
  }

  export async function listAll(candidateSource?: string) {
    const rootKeys = await Storage.list(["quality_shadow"])
    const sessionIDs = [...new Set(rootKeys.map((parts) => parts[1]).filter((value): value is string => !!value))]
    const records = (
      await Promise.all(sessionIDs.map((sessionID) => list(sessionID, candidateSource)))
    ).flat()
    return sortRecords(records)
  }

  export async function exportFile(input: { sessionIDs: string[]; candidateSource?: string }) {
    const records = (
      await Promise.all(input.sessionIDs.map((sessionID) => list(sessionID, input.candidateSource)))
    ).flat()
    const sorted = sortRecords(records)
    const baselineSources = [...new Set(sorted.map((record) => record.baseline.source))]
    const candidateSources = [...new Set(sorted.map((record) => record.candidate.source))]

    if (baselineSources.length > 1) {
      throw new Error(`Cannot export shadow file with multiple baseline sources: ${baselineSources.join(", ")}`)
    }
    if (candidateSources.length > 1) {
      throw new Error(`Cannot export shadow file with multiple candidate sources: ${candidateSources.join(", ")}`)
    }

    return ProbabilisticRollout.ShadowFile.parse({
      schemaVersion: 1,
      kind: "ax-code-quality-shadow-file",
      baselineSource: baselineSources[0] ?? "baseline",
      candidateSource: candidateSources[0] ?? input.candidateSource ?? "candidate",
      generatedAt: new Date().toISOString(),
      records: sorted,
    })
  }
}
