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

  export function inspect(input: {
    assurance: GoalAssurance.Contract
    sessionID: string
    created: number
    digest: string
    cwd: string
    source: SourceState
    messages: readonly GoalVerification.Message[]
  }) {
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
    return input.assurance.checks.map((check) => {
      const state = latest.get(check.id)?.state
      const result = (status: "missing" | "running" | "failed" | "stale" | "passed", detail: string) => ({
        id: check.id,
        status,
        detail,
      })
      if (!state) return result("missing", "not executed")
      if (state["status"] === "running" || state["status"] === "pending")
        return result("running", "await the current attempt")
      if (state["status"] !== "completed") return result("failed", "latest attempt did not complete")
      const metadata = asRecordOrUndefined(state["metadata"])
      const parsed = ReceiptSchema.safeParse(metadata?.["goalCheckReceipt"])
      if (!parsed.success) return result("missing", "latest attempt has no valid receipt")
      const receipt = parsed.data
      if (
        receipt.sessionID !== input.sessionID ||
        receipt.goalCreated !== input.created ||
        receipt.checkID !== check.id ||
        receipt.contractDigest !== input.digest ||
        receipt.command !== check.command ||
        // @scan-suppress security_scan - Normalize solely for equality; no filesystem access or authorization occurs here.
        path.resolve(receipt.cwd) !== path.resolve(input.cwd) ||
        receipt.startedAt < input.created ||
        receipt.endedAt < receipt.startedAt
      ) {
        return result("stale", "receipt belongs to a different goal, contract or workspace")
      }
      if (!receipt.passed || metadata?.["passed"] !== true || receipt.exitCode !== 0)
        return result("failed", `latest exit: ${receipt.exitCode ?? "unavailable"}`)
      if (!sameSource(receipt.sourceBefore, receipt.sourceAfter) || !sameSource(receipt.sourceAfter, input.source))
        return result("stale", "source changed or fingerprint unavailable")
      return result("passed", "current successful receipt")
    })
  }

  export function missing(input: Parameters<typeof inspect>[0]): string[] {
    return inspect(input)
      .filter((check) => check.status !== "passed")
      .map((check) => check.id)
  }
}
