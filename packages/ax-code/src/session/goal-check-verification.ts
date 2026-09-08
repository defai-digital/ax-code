import path from "node:path"
import z from "zod"
import { SourceStateSchema, type SourceState } from "../quality/verification-envelope"
import { asRecordOrUndefined } from "../util/record"
import type { GoalAssurance } from "./goal-assurance"
import type { GoalVerification } from "./goal-verification"

export namespace GoalCheckVerification {
  export const ReceiptSchema = z
    .object({
      version: z.literal(1),
      sessionID: z.string(),
      goalCreated: z.number(),
      checkID: z.string(),
      contractDigest: z.string().regex(/^[a-f0-9]{64}$/),
      cwd: z.string(),
      command: z.string(),
      startedAt: z.number(),
      endedAt: z.number(),
      sourceBefore: SourceStateSchema,
      sourceAfter: SourceStateSchema,
      passed: z.boolean(),
      exitCode: z.number().nullable(),
    })
    .strict()
  export type Receipt = z.infer<typeof ReceiptSchema>

  export function sameSource(left: SourceState, right: SourceState): boolean {
    return (
      left.available &&
      right.available &&
      Boolean(left.dirtyDigest?.startsWith("content-v1:")) &&
      left.commit === right.commit &&
      left.dirtyDigest === right.dirtyDigest
    )
  }

  export function missing(input: {
    assurance: GoalAssurance.Contract
    sessionID: string
    created: number
    digest: string
    cwd: string
    source: SourceState
    messages: readonly GoalVerification.Message[]
  }): string[] {
    const latest = new Map<string, { state: Record<string, unknown>; startedAt: number }>()
    for (const message of input.messages) {
      if (message.info?.role !== "assistant") continue
      for (const part of message.parts ?? []) {
        const record = asRecordOrUndefined(part)
        if (record?.["type"] !== "tool" || record["tool"] !== "verify_project") continue
        const state = asRecordOrUndefined(record["state"])
        const checkID = asRecordOrUndefined(state?.["input"])?.["goalCheck"]
        if (state && typeof checkID === "string") {
          const time = asRecordOrUndefined(state["time"])?.["start"]
          const startedAt =
            typeof time === "number" && Number.isFinite(time) ? time : (message.info?.time?.created ?? 0)
          const previous = latest.get(checkID)
          if (!previous || startedAt >= previous.startedAt) latest.set(checkID, { state, startedAt })
        }
      }
    }
    return input.assurance.checks
      .filter((check) => {
        const state = latest.get(check.id)?.state
        if (state?.["status"] !== "completed") return true
        const metadata = asRecordOrUndefined(state["metadata"])
        const parsed = ReceiptSchema.safeParse(metadata?.["goalCheckReceipt"])
        if (!parsed.success || metadata?.["passed"] !== true) return true
        const receipt = parsed.data
        return (
          !receipt.passed ||
          receipt.exitCode !== 0 ||
          receipt.sessionID !== input.sessionID ||
          receipt.goalCreated !== input.created ||
          receipt.checkID !== check.id ||
          receipt.contractDigest !== input.digest ||
          receipt.command !== check.command ||
          path.resolve(receipt.cwd) !== path.resolve(input.cwd) ||
          receipt.startedAt < input.created ||
          receipt.endedAt < receipt.startedAt ||
          !sameSource(receipt.sourceBefore, receipt.sourceAfter) ||
          !sameSource(receipt.sourceAfter, input.source)
        )
      })
      .map((check) => check.id)
  }
}
