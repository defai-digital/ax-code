import z from "zod"
import { NamedError } from "@ax-code/util/error"
import { Tool } from "./tool"
import DESCRIPTION from "./ops_apply.txt"
import { Instance } from "@/project/instance"
import { Hash } from "@/util/hash"
import { OperationToken } from "@/operation/query"
import { OpsExec } from "./ops-exec"
import { appendPlanJournal, loadPlan } from "./ops-shared"

// The ONLY sanctioned external-mutation path (PRD-2026-09-04-cloud-operations-mode).
// Authorization is capability-based: a single-use, TTL-bound, plan-bound
// approval token issued by ops_approve. The raw bearer token is never written
// to the journal — only its sha256.

export const TokenRedeemError = NamedError.create(
  "OpsTokenRedeemError",
  z.object({ reason: z.enum(["not_found", "already_consumed", "expired"]), message: z.string() }),
)

export const TokenPlanMismatchError = NamedError.create(
  "OpsTokenPlanMismatchError",
  z.object({ planID: z.string(), tokenPlanID: z.string(), message: z.string() }),
)

const EXCERPT_MAX_CHARS = 2000
const TIMEOUT_DEFAULT_SECONDS = 600
const TIMEOUT_MAX_SECONDS = 3600

export const OpsApplyTool = Tool.define("ops_apply", {
  description: DESCRIPTION,
  parameters: z.object({
    approval_token: z.string().min(1).describe("Single-use approval token issued by ops_approve"),
    plan_id: z.string().min(1).describe("OperationPlanID the token is bound to"),
    command: z.string().min(1).describe("The mutation command to execute (e.g. terraform apply <planfile>)"),
    timeout_seconds: z
      .number()
      .int()
      .min(1)
      .max(TIMEOUT_MAX_SECONDS)
      .default(TIMEOUT_DEFAULT_SECONDS)
      .describe(`Command timeout in seconds (default ${TIMEOUT_DEFAULT_SECONDS}, max ${TIMEOUT_MAX_SECONDS})`),
    cwd: z.string().optional().describe("Working directory; defaults to the current project directory"),
  }),
  async execute(params, ctx) {
    const plan = loadPlan(params.plan_id)
    const projectID = Instance.project.id

    // Per-call confirmation with no durable grant; the token remains the
    // authoritative capability check below.
    await ctx.ask({
      permission: "ops_apply",
      patterns: [plan.id],
      always: [],
      metadata: { tool: "ops_apply", kind: plan.kind, canonical_hash: plan.canonical_hash },
    })

    // (a) Redeem the token BEFORE executing anything. Failure here means
    // nothing ran, so the journal is untouched.
    const redeemed = OperationToken.consume({ token: params.approval_token })
    if (!redeemed.ok) {
      throw new TokenRedeemError({
        reason: redeemed.reason,
        message: `Approval token cannot be redeemed: ${redeemed.reason}`,
      })
    }
    if (redeemed.planID !== plan.id) {
      throw new TokenPlanMismatchError({
        planID: plan.id,
        tokenPlanID: redeemed.planID,
        message: "Approval token is bound to a different plan",
      })
    }

    // (b) Execute the mutation.
    const result = await OpsExec.run({
      command: params.command,
      cwd: params.cwd,
      timeoutSeconds: params.timeout_seconds,
      abort: ctx.abort,
    })
    const combined = result.stdout + (result.stderr ? `\n${result.stderr}` : "")
    const excerpt = combined.slice(0, EXCERPT_MAX_CHARS)

    // (c) Journal the outcome. The raw token never enters durable records —
    // only its sha256, per the no-raw-credentials rule.
    const status = result.exitCode === 0 ? "executed" : "failed"
    const { sequence } = appendPlanJournal({
      plan,
      projectID,
      actor: "agent",
      status,
      payload: {
        command: params.command,
        exit_code: result.exitCode,
        output_excerpt: excerpt,
        approval_token_hash: Hash.fast(params.approval_token),
      },
      sessionID: ctx.sessionID,
    })

    const output = JSON.stringify(
      {
        exit_code: result.exitCode,
        timed_out: result.timedOut,
        output_truncated: result.truncated,
        output: combined,
        journal_sequence: sequence,
      },
      null,
      2,
    )
    return {
      title: `ops_apply ${plan.id} exit ${result.exitCode ?? "null"}`,
      output,
      metadata: {
        exit_code: result.exitCode,
        timed_out: result.timedOut,
        journal_sequence: sequence,
      },
    }
  },
})
