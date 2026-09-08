import { Instance } from "../project/instance"
import { SessionGoal } from "../session/goal"
import { GoalPlan } from "../session/goal-plan"
import { GoalCheckVerification } from "../session/goal-check-verification"
import { currentSourceState } from "../quality/source-state"
import { runCheck } from "../planner/verification/runner"
import { computeEnvelopeId, VerificationEnvelopeSchema } from "../quality/verification-envelope"
import { Process } from "../util/process"
import { Installation } from "../installation"
import { Env } from "../util/env"
import type { Tool } from "./tool"

export async function verifyGoalCheck(checkID: string, ctx: Tool.Context) {
  const goal = await SessionGoal.get(ctx.sessionID)
  if (!goal || goal.status !== "active") throw new Error("Goal checks require an active session goal")
  const result = GoalPlan.read(ctx.sessionID, goal.time.created)
  if (result.status !== "found" || !GoalPlan.hasValidContract(ctx.sessionID, goal.time.created)) {
    throw new Error("Restore the frozen goal contract before running goal checks")
  }
  const contract = result.contract
  const assurance = contract.assurance
  const check = assurance?.checks.find((item) => item.id === checkID)
  if (!assurance || !check) throw new Error(`Unknown goal check ${checkID}; read the active goal plan`)
  const digest = GoalPlan.digestOf(contract)
  const cwd = Instance.worktree
  await ctx.ask({
    permission: "bash",
    patterns: [check.command],
    always: [check.command],
    metadata: { tool: "verify_project", goalCheck: check.id, environment: check.environment },
  })
  ctx.abort.throwIfAborted()
  // An approval can take time. Recheck the contract and goal before execution.
  const current = await SessionGoal.get(ctx.sessionID)
  if (
    current?.status !== "active" ||
    current.time.created !== goal.time.created ||
    !GoalPlan.hasValidContract(ctx.sessionID, goal.time.created) ||
    GoalPlan.storedDigest(ctx.sessionID, goal.time.created) !== digest
  ) {
    throw new Error("The active goal changed while awaiting verification permission")
  }
  const sourceBefore = await currentSourceState(cwd, Instance.project.vcs ?? "", assurance.sourcePaths)
  if (!sourceBefore.available)
    throw new Error(
      "Source fingerprint unavailable; goal check cannot produce fresh evidence. Check source size, links and declared paths.",
    )
  const startedAt = Date.now()
  const run = await runCheck(check.id, check.command, cwd, { signal: ctx.abort })
  ctx.abort.throwIfAborted()
  const endedAt = Date.now()
  const sourceAfter = await currentSourceState(cwd, Instance.project.vcs ?? "", assurance.sourcePaths)
  ctx.abort.throwIfAborted()
  const passed =
    run.ok &&
    run.exitCode === 0 &&
    !run.skipped &&
    !run.timedOut &&
    GoalCheckVerification.sameSource(sourceBefore, sourceAfter)
  const receipt = GoalCheckVerification.ReceiptSchema.parse({
    version: 1,
    sessionID: ctx.sessionID,
    goalCreated: goal.time.created,
    checkID: check.id,
    contractDigest: digest,
    cwd,
    command: check.command,
    startedAt,
    endedAt,
    sourceBefore,
    sourceAfter,
    passed,
    exitCode: run.exitCode ?? null,
  })
  const envelope = VerificationEnvelopeSchema.parse({
    schemaVersion: 1,
    workflow: "qa",
    scope: { kind: "custom", description: check.purpose, paths: assurance.sourcePaths },
    command: { runner: check.id, argv: Process.shellCommand(check.command), cwd },
    result: {
      name: check.id,
      type: "custom",
      passed,
      status: passed ? "passed" : run.timedOut ? "timeout" : run.skipped ? "skipped" : "failed",
      issues: [],
      duration: endedAt - startedAt,
    },
    structuredFailures: [],
    artifactRefs: [],
    source: { tool: "verify_project", version: Installation.VERSION, runId: ctx.sessionID },
    sourceState: sourceBefore,
    execution: {
      startedAt: new Date(startedAt).toISOString(),
      endedAt: new Date(endedAt).toISOString(),
      exitCode: run.exitCode ?? null,
      signal: null,
      timedOut: run.timedOut ?? false,
      outputTruncated: run.errors.length >= 20,
    },
  })
  const envelopeId = computeEnvelopeId(envelope)
  return {
    title: `Goal check ${check.id} ${passed ? "passed" : "failed"}`,
    output: [
      `Goal check: ${check.id}`,
      `Acceptance: ${check.acceptanceIds.join(", ")}`,
      `Declared target: ${check.environment}`,
      `Passed: ${passed}`,
      `Exit code: ${run.exitCode ?? "unavailable"}`,
      `Envelope: ${envelopeId}`,
      ...run.errors.map((error) => Env.redactSecrets(error)),
      ...(!GoalCheckVerification.sameSource(sourceBefore, sourceAfter)
        ? ["Source changed during verification or became unavailable; rerun against stable source."]
        : []),
      "The project command is responsible for asserting target identity and business behavior; this receipt records execution and source freshness.",
    ].join("\n"),
    metadata: {
      passed,
      goalCheckReceipt: receipt,
      verificationEnvelopes: [envelope],
      envelopeIds: [{ envelopeId, name: check.id, status: envelope.result.status }],
    },
  }
}
