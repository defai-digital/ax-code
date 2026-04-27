import z from "zod"
import path from "path"
import { Tool } from "./tool"
import DESCRIPTION from "./refactor_apply.txt"
import { Instance } from "../project/instance"
import { DebugEngine } from "../debug-engine"
import { RefactorPlanID } from "../debug-engine/id"
import { extractFilesFromDiff } from "../debug-engine/analyze-impact"
import { fromRefactorApplyResult } from "../quality/verification-envelope-builder"

// Tool wrapper around DebugEngine.applySafeRefactor. This is the ONLY
// DRE tool that writes files. It goes through the permission system
// with `permission: "edit"` so users approve each apply (mirrors the
// edit/write/apply_patch tools).
//
// Gated behind AX_CODE_EXPERIMENTAL_DEBUG_ENGINE like the other DRE
// tools. NOT added to read-only permission presets (ADR-010).

const MODES = ["safe", "aggressive"] as const

export const RefactorApplyTool = Tool.define("refactor_apply", {
  description: DESCRIPTION,
  parameters: z.object({
    planId: z.string().describe("RefactorPlanID returned by refactor_plan"),
    patch: z.string().optional().describe("Unified diff to apply; omit to run pre-flight checks only"),
    mode: z
      .enum(MODES)
      .optional()
      .describe("'safe' runs every check (default); 'aggressive' allows skipLint/skipTests"),
    skipLint: z.boolean().optional().describe("Aggressive mode only: skip lint"),
    skipTests: z.boolean().optional().describe("Aggressive mode only: skip tests"),
  }),
  execute: async (args, ctx) => {
    const projectID = Instance.project.id

    // Ask for permission BEFORE running the pipeline when a patch is
    // supplied (= a real apply). For pre-flight runs (no patch) we
    // still go through `ask` because the shadow worktree + test run
    // can execute arbitrary project commands — permission is about
    // intent, not just file writes.
    const patternFiles = args.patch ? extractFilesFromDiff(args.patch) : []
    const relativePatterns =
      patternFiles.length > 0
        ? patternFiles.map((f) => (path.isAbsolute(f) ? path.relative(Instance.worktree, f).replaceAll("\\", "/") : f))
        : ["*"]
    await ctx.ask({
      permission: "edit",
      patterns: relativePatterns,
      always: ["*"],
      metadata: {
        tool: "refactor_apply",
        planId: args.planId,
        mode: args.mode ?? "safe",
        preflight: !args.patch,
        files: patternFiles,
      },
    })

    const result = await DebugEngine.applySafeRefactor(projectID, {
      planId: RefactorPlanID.make(args.planId),
      patch: args.patch,
      mode: args.mode,
      skipLint: args.skipLint,
      skipTests: args.skipTests,
    })

    const lines: string[] = []
    lines.push(`Applied: ${result.applied}`)
    lines.push(`Plan: ${result.planId}`)
    if (result.abortReason) lines.push(`Abort reason: ${result.abortReason}`)
    lines.push("")
    lines.push(
      `Typecheck: ${result.checks.typecheck.ok ? "ok" : "FAILED"}${result.checks.typecheck.errors.length ? " (" + result.checks.typecheck.errors.length + " errors)" : ""}`,
    )
    lines.push(
      `Lint:      ${result.checks.lint.ok ? "ok" : "FAILED"}${result.checks.lint.errors.length ? " (" + result.checks.lint.errors.length + " errors)" : ""}`,
    )
    lines.push(
      `Tests:     ${result.checks.tests.ok ? "ok" : "FAILED"} (selection: ${result.checks.tests.selection}, ran: ${result.checks.tests.ran}, failed: ${result.checks.tests.failed})`,
    )
    if (result.filesChanged.length > 0) {
      lines.push("")
      lines.push("Files changed:")
      for (const f of result.filesChanged) lines.push(`  - ${f}`)
    }

    const verificationEnvelopes = fromRefactorApplyResult({
      applyResult: result,
      sessionID: ctx.sessionID,
      cwd: Instance.worktree,
    })

    return {
      title: result.applied
        ? `refactor_apply ✓ ${result.filesChanged.length} file(s)`
        : `refactor_apply aborted: ${result.abortReason ?? "unknown"}`,
      output: lines.join("\n"),
      metadata: {
        applied: result.applied,
        planId: result.planId,
        abortReason: result.abortReason,
        filesChanged: result.filesChanged,
        result,
        verificationEnvelopes,
      },
    }
  },
})
