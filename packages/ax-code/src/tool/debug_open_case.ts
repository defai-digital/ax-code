import z from "zod"
import { Tool } from "./tool"
import DESCRIPTION from "./debug_open_case.txt"
import { computeDebugCaseId, DebugCaseSchema } from "@ax-code/ax-code-reason/runtime-debug"
import { CASE_TRANSITIONS, CASE_TERMINAL_STATUSES, validateTransition } from "@ax-code/ax-code-reason/lifecycle"
import { Installation } from "../installation"

export const DebugOpenCaseTool = Tool.define("debug_open_case", {
  description: DESCRIPTION,
  parameters: z.object({
    problem: z.string().min(1).max(500),
  }),
  execute: async (args, ctx) => {
    const caseId = computeDebugCaseId({ problem: args.problem, runId: ctx.sessionID })

    // Phase 3 (D5): a new debug case opens in the "open" state, which must be
    // a legal initial state per the case transition table. Defensive — the
    // transition table is the single source of truth for case statuses.
    const openTransition = validateTransition(CASE_TRANSITIONS, CASE_TERMINAL_STATUSES, "open", "open")
    if (!openTransition.ok) {
      throw new Error(`debug_open_case: illegal initial case status "open" (${openTransition.reason})`)
    }

    const debugCase = DebugCaseSchema.parse({
      schemaVersion: 1,
      caseId,
      problem: args.problem,
      status: "open",
      createdAt: new Date().toISOString(),
      source: { tool: "debug_open_case", version: Installation.VERSION, runId: ctx.sessionID },
    })

    return {
      title: `debug_open_case ${caseId}`,
      output: `Opened debug case ${caseId}: ${args.problem.slice(0, 80)}${args.problem.length > 80 ? "…" : ""}`,
      metadata: {
        caseId,
        debugCase,
      },
    }
  },
})
