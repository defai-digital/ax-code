import z from "zod"
import { Tool } from "./tool"
import DESCRIPTION from "./debug_plan_instrumentation.txt"
import {
  computeDebugInstrumentationPlanId,
  DEBUG_ID_PATTERN,
  DebugInstrumentationStatus,
  DebugInstrumentationPlanSchema,
  DebugInstrumentationTargetSchema,
} from "../debug-engine/runtime-debug"
import { Installation } from "../installation"
import { SessionDebug } from "../session/debug"
import type { SessionID } from "../session/schema"

export const DebugPlanInstrumentationTool = Tool.define("debug_plan_instrumentation", {
  description: DESCRIPTION,
  parameters: z.object({
    caseId: z.string().regex(DEBUG_ID_PATTERN, "caseId must be 16-char hex from debug_open_case"),
    purpose: z.string().min(1).max(500),
    targets: z.array(DebugInstrumentationTargetSchema).min(1).max(20),
    status: DebugInstrumentationStatus.optional().describe(
      'Lifecycle status for this temporary instrumentation plan. Defaults to "planned"; use "applied" only after an explicit instrumentation edit, and "removed" only after the temporary probes are removed.',
    ),
  }),
  execute: async (args, ctx) => {
    const sessionID = ctx.sessionID as SessionID
    const knownCases = SessionDebug.caseIdSet(sessionID)
    if (!knownCases.has(args.caseId)) {
      throw new Error(
        `caseId references an unknown debug case: ${args.caseId} (no DebugCase with this id was opened in session ${ctx.sessionID})`,
      )
    }

    const planId = computeDebugInstrumentationPlanId({
      caseId: args.caseId,
      purpose: args.purpose,
      targets: args.targets,
    })
    const debugInstrumentationPlan = DebugInstrumentationPlanSchema.parse({
      schemaVersion: 1,
      planId,
      caseId: args.caseId,
      purpose: args.purpose,
      targets: args.targets,
      status: args.status ?? "planned",
      createdAt: new Date().toISOString(),
      source: { tool: "debug_plan_instrumentation", version: Installation.VERSION, runId: ctx.sessionID },
    })
    const action =
      debugInstrumentationPlan.status === "planned"
        ? "Planned"
        : debugInstrumentationPlan.status === "applied"
          ? "Recorded as applied"
          : "Recorded as removed"
    const suffix =
      debugInstrumentationPlan.status === "removed"
        ? "All probes should now be absent from the worktree."
        : "Remove all probes after capturing evidence."

    return {
      title: `debug_plan_instrumentation ${planId}`,
      output: `${action} ${args.targets.length} temporary instrumentation probe(s) for case ${args.caseId}. ${suffix}`,
      metadata: {
        planId,
        debugInstrumentationPlan,
      },
    }
  },
})
