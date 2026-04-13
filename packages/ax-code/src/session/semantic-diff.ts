import z from "zod"
import { Snapshot } from "../snapshot"
import { SessionSemanticCore } from "./semantic-core"
import type { SessionID } from "./schema"

export namespace SessionSemanticDiff {
  export const Kind = z.enum(SessionSemanticCore.kindList).meta({
    ref: "SessionSemanticDiffKind",
  })
  export type Kind = z.output<typeof Kind>

  export const Risk = z.enum(SessionSemanticCore.riskList).meta({
    ref: "SessionSemanticDiffRisk",
  })
  export type Risk = z.output<typeof Risk>

  export const Count = z
    .object({
      kind: Kind,
      count: z.number(),
    })
    .meta({
      ref: "SessionSemanticDiffCount",
    })
  export type Count = z.output<typeof Count>

  export const Change = z
    .object({
      file: z.string(),
      status: Snapshot.FileDiff.shape.status.nullable(),
      kind: Kind,
      risk: Risk,
      summary: z.string(),
      additions: z.number(),
      deletions: z.number(),
      signals: z.string().array(),
    })
    .meta({
      ref: "SessionSemanticDiffChange",
    })
  export type Change = z.output<typeof Change>

  export const Summary = z
    .object({
      headline: z.string(),
      risk: Risk,
      primary: Kind,
      files: z.number(),
      additions: z.number(),
      deletions: z.number(),
      counts: Count.array(),
      signals: z.string().array(),
      changes: Change.array(),
    })
    .meta({
      ref: "SessionSemanticDiffSummary",
    })
  export type Summary = z.output<typeof Summary>

  export function format(kind: Kind) {
    return SessionSemanticCore.format(kind)
  }

  export function change(diff: Snapshot.FileDiff): Change {
    return SessionSemanticCore.change(diff) satisfies Change
  }

  export function summarize(diff: Snapshot.FileDiff[]) {
    const next = SessionSemanticCore.summarize(diff)
    if (!next) return
    return next satisfies Summary
  }

  export async function load(sessionID: SessionID) {
    const { Session } = await import(".")
    return summarize(await Session.diff(sessionID))
  }
}
