import { describe, expect, test } from "vitest"
import { tmpdir } from "../fixture/fixture"
import { Instance } from "../../src/project/instance"
import { Permission } from "../../src/permission"
import { Hash } from "../../src/util/hash"
import { Log } from "../../src/util/log"
import { OperationJournal, OperationPlan, OperationToken } from "../../src/operation/query"
import { OpsPlanTool } from "../../src/tool/ops_plan"
import { OpsDiffTool } from "../../src/tool/ops_diff"
import { AlreadyApprovedError, OpsApproveTool } from "../../src/tool/ops_approve"
import { OpsApplyTool, TokenPlanMismatchError, TokenRedeemError } from "../../src/tool/ops_apply"
import { OpsVerifyTool } from "../../src/tool/ops_verify"
import { OpsJournalTool } from "../../src/tool/ops_journal"

Log.init({ print: false })

function makeCtx(ask?: (permission: string) => void) {
  return {
    sessionID: "ses_test_ops_tools",
    messageID: "msg_test_ops" as any,
    agent: "build",
    abort: new AbortController().signal,
    callID: "call_test_ops",
    messages: [],
    metadata: () => {},
    ask: async (req: Omit<Permission.Request, "id" | "sessionID" | "tool">) => {
      ask?.(req.permission)
      if (req.permission === "ops_approve") {
        expect(req.always).toEqual([])
      }
    },
  } as any
}

function withProject(fn: (ctx: ReturnType<typeof makeCtx>) => Promise<void>) {
  return async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        await fn(makeCtx())
      },
    })
  }
}

const STEP = {
  description: "Open port 443 on the edge firewall",
  effect: "firewall rule add for tcp/443",
  reversibility: "reversible" as const,
  blast_radius: "med" as const,
}

const PLAN_INPUT = {
  kind: "vyos-firewall",
  target: "vyos@edge-01",
  intent: "Allow HTTPS through the edge firewall",
  steps: [STEP],
}

async function createPlan(ctx: ReturnType<typeof makeCtx>, input: typeof PLAN_INPUT = PLAN_INPUT) {
  const tool = await OpsPlanTool.init()
  const result = await tool.execute(input, ctx)
  return { tool, planID: result.metadata.plan_id as string, canonicalHash: result.metadata.canonical_hash as string }
}

async function approvePlan(ctx: ReturnType<typeof makeCtx>, planID: string, ttlMinutes = 10) {
  const tool = await OpsApproveTool.init()
  const result = await tool.execute({ plan_id: planID, ttl_minutes: ttlMinutes }, ctx)
  return { tool, token: result.metadata.token as string, expiresAt: result.metadata.expires_at as number }
}

describe("ops_plan", () => {
  test(
    "creates the plan and first journal entry with a stable canonical hash",
    withProject(async (ctx) => {
      const { planID, canonicalHash } = await createPlan(ctx)

      // The canonical hash is reproducible from the fixed-key-order canonical
      // JSON, computed independently here.
      const canonical = {
        kind: PLAN_INPUT.kind,
        target: PLAN_INPUT.target,
        intent: PLAN_INPUT.intent,
        steps: PLAN_INPUT.steps,
        diff_artifact_ref: null,
      }
      expect(canonicalHash).toBe(Hash.fast(JSON.stringify(canonical)))

      const plan = OperationPlan.get(planID as any)!
      expect(plan.status).toBe("draft")
      expect(plan.origin_session_id).toBe(ctx.sessionID)

      const entries = OperationJournal.list(planID as any)
      expect(entries).toHaveLength(1)
      expect(entries[0]).toMatchObject({ sequence: 1, actor: "agent", status: "planned" })
      expect(entries[0]!.payload_json).toEqual({ intent: PLAN_INPUT.intent, step_count: 1 })
      expect(entries[0]!.prev_entry_hash).toBeNull()
      expect(OperationJournal.verifyChain(planID as any)).toEqual({ ok: true })
    }),
  )
})

describe("ops_diff", () => {
  test(
    "appends the diff entry with the next sequence and a chained hash",
    withProject(async (ctx) => {
      const { planID } = await createPlan(ctx)

      const tool = await OpsDiffTool.init()
      const result = await tool.execute(
        { plan_id: planID, diff_artifact_ref: "/tmp/edge-01.plan", summary: "adds one rule" },
        ctx,
      )
      expect(result.metadata.sequence).toBe(2)
      expect(result.metadata.plan_id).toBe(planID)

      const entries = OperationJournal.list(planID as any)
      expect(entries.map((e) => e.sequence)).toEqual([1, 2])
      expect(entries[1]!.status).toBe("planned")
      expect(entries[1]!.payload_json).toEqual({ diff_artifact_ref: "/tmp/edge-01.plan", summary: "adds one rule" })
      expect(entries[1]!.prev_entry_hash).toBe(entries[0]!.entry_hash)
      expect(entries[1]!.entry_hash).toBe(result.metadata.entry_hash)
      expect(OperationJournal.verifyChain(planID as any)).toEqual({ ok: true })
    }),
  )

  test(
    "errors when the plan does not exist",
    withProject(async (ctx) => {
      const tool = await OpsDiffTool.init()
      await expect(tool.execute({ plan_id: "operation_plan_missing", diff_artifact_ref: "x" }, ctx)).rejects.toThrow(
        /not found/i,
      )
    }),
  )
})

describe("ops_approve", () => {
  test(
    "allowed ask approves the plan and issues a single-use token",
    withProject(async (ctx) => {
      const asked: string[] = []
      const recordingCtx = makeCtx((p) => asked.push(p))
      const { planID } = await createPlan(recordingCtx)
      const { token, expiresAt } = await approvePlan(recordingCtx, planID)

      expect(asked).toContain("ops_approve")
      expect(OperationPlan.get(planID as any)!.status).toBe("approved")
      expect(expiresAt).toBeGreaterThan(Date.now())
      expect(expiresAt).toBeLessThanOrEqual(Date.now() + 10 * 60_000 + 1000)

      const entries = OperationJournal.list(planID as any)
      expect(entries.at(-1)).toMatchObject({ sequence: 2, actor: "user", status: "approved" })

      // The token redeems once against its plan...
      expect(OperationToken.consume({ token })).toEqual({ ok: true, planID: planID as any })
      // ...and a second redemption reports already_consumed.
      expect(OperationToken.consume({ token })).toEqual({ ok: false, reason: "already_consumed" })
    }),
  )

  test(
    "denied ask rejects the plan and journals the rejection",
    withProject(async (ctx) => {
      const { planID } = await createPlan(ctx)
      const deniedCtx = {
        ...ctx,
        ask: async () => {
          throw new Permission.DeniedError({ ruleset: [] })
        },
      }
      const tool = await OpsApproveTool.init()
      await expect(tool.execute({ plan_id: planID, ttl_minutes: 10 }, deniedCtx)).rejects.toThrow()

      expect(OperationPlan.get(planID as any)!.status).toBe("rejected")
      const entries = OperationJournal.list(planID as any)
      expect(entries.at(-1)).toMatchObject({ sequence: 2, actor: "user", status: "rejected" })
    }),
  )

  test(
    "rejects re-approval while a live token exists",
    withProject(async (ctx) => {
      const { planID } = await createPlan(ctx)
      await approvePlan(ctx, planID)

      const tool = await OpsApproveTool.init()
      await expect(tool.execute({ plan_id: planID, ttl_minutes: 10 }, ctx)).rejects.toThrow(AlreadyApprovedError)
    }),
  )
})

describe("ops_apply", () => {
  test(
    "executes an approved command, journals 'executed', and never persists the raw token",
    withProject(async (ctx) => {
      const { planID } = await createPlan(ctx)
      const { token } = await approvePlan(ctx, planID)

      const tool = await OpsApplyTool.init()
      const result = await tool.execute(
        { approval_token: token, plan_id: planID, command: "echo ok", timeout_seconds: 600 },
        ctx,
      )

      expect(result.metadata.exit_code).toBe(0)
      expect(result.output).toContain("ok")
      const journalSequence = result.metadata.journal_sequence as number
      expect(journalSequence).toBe(3)

      const entry = OperationJournal.latestEntry(planID as any)!
      expect(entry).toMatchObject({ sequence: 3, actor: "agent", status: "executed" })
      const payload = entry.payload_json as Record<string, unknown>
      expect(payload.exit_code).toBe(0)
      expect(payload.command).toBe("echo ok")
      // The journal records the token's sha256, never the raw bearer secret.
      expect(payload.approval_token_hash).toBe(Hash.fast(token))
      expect(JSON.stringify(payload)).not.toContain(token)

      // Journal chain still verifies after the full plan → approve → apply flow.
      expect(OperationJournal.verifyChain(planID as any)).toEqual({ ok: true })
    }),
  )

  test(
    "fails the call with nothing executed when the token is invalid",
    withProject(async (ctx) => {
      const { planID } = await createPlan(ctx)

      const tool = await OpsApplyTool.init()
      await expect(
        tool.execute(
          { approval_token: "no-such-token", plan_id: planID, command: "echo should-not-run", timeout_seconds: 600 },
          ctx,
        ),
      ).rejects.toThrow(TokenRedeemError)

      // No execution, no journal entry beyond the plan entry.
      expect(OperationJournal.list(planID as any)).toHaveLength(1)
    }),
  )

  test(
    "rejects a token bound to a different plan",
    withProject(async (ctx) => {
      const first = await createPlan(ctx)
      const second = await createPlan(ctx, { ...PLAN_INPUT, intent: "Allow SSH through the edge firewall" })
      const { token } = await approvePlan(ctx, first.planID)

      const tool = await OpsApplyTool.init()
      await expect(
        tool.execute(
          { approval_token: token, plan_id: second.planID, command: "echo nope", timeout_seconds: 600 },
          ctx,
        ),
      ).rejects.toThrow(TokenPlanMismatchError)

      // The mismatch consumed the token (it is single-use) but journaled nothing.
      expect(OperationToken.consume({ token })).toEqual({ ok: false, reason: "already_consumed" })
      expect(OperationJournal.list(second.planID as any)).toHaveLength(1)
    }),
  )
})

describe("ops_verify", () => {
  test(
    "passing assertions journal 'verified'",
    withProject(async (ctx) => {
      const { planID } = await createPlan(ctx)

      const tool = await OpsVerifyTool.init()
      const result = await tool.execute(
        { plan_id: planID, assertions: [{ command: "echo status: active", expect: "active" }] },
        ctx,
      )

      expect(result.metadata.all_pass).toBe(true)
      const entry = OperationJournal.latestEntry(planID as any)!
      expect(entry.status).toBe("verified")
      expect(entry.payload_json).toEqual({
        assertions: [{ command: "echo status: active", expect: "active", pass: true }],
        all_pass: true,
      })
    }),
  )

  test(
    "failing assertions journal 'failed'",
    withProject(async (ctx) => {
      const { planID } = await createPlan(ctx)

      const tool = await OpsVerifyTool.init()
      const result = await tool.execute(
        {
          plan_id: planID,
          assertions: [
            { command: "echo status: active", expect: "active" },
            { command: "echo rule: missing", expect: "present" },
          ],
        },
        ctx,
      )

      expect(result.metadata.all_pass).toBe(false)
      const results = result.metadata.results as Array<{ pass: boolean }>
      expect(results.map((r) => r.pass)).toEqual([true, false])

      const entry = OperationJournal.latestEntry(planID as any)!
      expect(entry.status).toBe("failed")
      expect((entry.payload_json as { all_pass: boolean }).all_pass).toBe(false)
    }),
  )
})

describe("ops_journal", () => {
  test(
    "lists entries for one plan and across the project with status filter",
    withProject(async (ctx) => {
      const { planID } = await createPlan(ctx)
      const diff = await OpsDiffTool.init()
      await diff.execute({ plan_id: planID, diff_artifact_ref: "/tmp/edge-01.plan" }, ctx)
      const { token } = await approvePlan(ctx, planID)
      const apply = await OpsApplyTool.init()
      await apply.execute({ approval_token: token, plan_id: planID, command: "echo ok", timeout_seconds: 600 }, ctx)

      const byPlan = await OpsJournalTool.init()
      const planResult = await byPlan.execute({ plan_id: planID, limit: 50 }, ctx)
      const planEntries = planResult.metadata.entries as Array<{ status: string; sequence: number }>
      expect(planEntries.map((e) => e.status)).toEqual(["planned", "planned", "approved", "executed"])
      expect(planEntries.map((e) => e.sequence)).toEqual([1, 2, 3, 4])
      expect(planEntries[0]).toHaveProperty("entry_hash")
      expect(planEntries[0]).toHaveProperty("prev_entry_hash")
      expect(planEntries[0]).toHaveProperty("session_id")
      expect(planEntries[0]).toHaveProperty("time_created")

      const projectResult = await byPlan.execute({ limit: 50 }, ctx)
      expect(projectResult.metadata.entries).toHaveLength(4)

      const filtered = await byPlan.execute({ status: "executed", limit: 50 }, ctx)
      expect(filtered.metadata.entries).toHaveLength(1)
      expect((filtered.metadata.entries as Array<{ status: string }>)[0]!.status).toBe("executed")

      const limited = await byPlan.execute({ limit: 2 }, ctx)
      expect(limited.metadata.entries).toHaveLength(2)
    }),
  )
})
