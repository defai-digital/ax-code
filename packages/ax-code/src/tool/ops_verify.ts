import z from "zod"
import { Tool } from "./tool"
import DESCRIPTION from "./ops_verify.txt"
import { Instance } from "@/project/instance"
import { OpsExec } from "./ops-exec"
import { appendPlanJournal, loadPlan } from "./ops-shared"

// Post-apply evidence gathering (PRD-2026-09-04-cloud-operations-mode): runs
// declarative read-only assertions for a plan and records pass/fail in the
// operation journal.

const ASSERT_TIMEOUT_SECONDS = 120
const EXPECT_MAX_CHARS = 2000

export const OpsVerifyTool = Tool.define("ops_verify", {
  description: DESCRIPTION,
  parameters: z.object({
    plan_id: z.string().min(1).describe("OperationPlanID to verify"),
    assertions: z
      .array(
        z.object({
          command: z.string().min(1).describe("Read-only command to run (describe/get/show)"),
          expect: z.string().describe("String the command's combined output must contain for the assertion to pass"),
        }),
      )
      .min(1)
      .describe("Read-only assertions; every one must pass for the plan to verify"),
  }),
  async execute(params, ctx) {
    const projectID = Instance.project.id
    const plan = loadPlan(params.plan_id, projectID)

    await ctx.ask({
      permission: "ops_verify",
      patterns: ["*"],
      always: ["*"],
      metadata: {},
    })

    const results: Array<{ command: string; expect: string; pass: boolean }> = []
    for (const assertion of params.assertions) {
      ctx.abort.throwIfAborted()
      OpsExec.assertReadOnly(assertion.command)
      const result = await OpsExec.run({
        command: assertion.command,
        timeoutSeconds: ASSERT_TIMEOUT_SECONDS,
        abort: ctx.abort,
      })
      if (result.aborted) ctx.abort.throwIfAborted()
      const combined = result.stdout + (result.stderr ? `\n${result.stderr}` : "")
      results.push({
        command: assertion.command,
        expect: assertion.expect.slice(0, EXPECT_MAX_CHARS),
        pass: result.exitCode === 0 && combined.includes(assertion.expect),
      })
    }
    const allPass = results.every((r) => r.pass)

    const { sequence, entryHash } = appendPlanJournal({
      plan,
      projectID,
      actor: "agent",
      status: allPass ? "verified" : "failed",
      payload: { assertions: results, all_pass: allPass },
      sessionID: ctx.sessionID,
    })

    const output = JSON.stringify({ all_pass: allPass, results, journal_sequence: sequence }, null, 2)
    return {
      title: `ops_verify ${plan.id} ${allPass ? "passed" : "failed"}`,
      output,
      metadata: { all_pass: allPass, results, journal_sequence: sequence, entry_hash: entryHash },
    }
  },
})
