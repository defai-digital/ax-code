import z from "zod"
import { Tool } from "./tool"
import DESCRIPTION from "./refactor_apply.txt"
import { Instance } from "../project/instance"
import { DebugEngine } from "@ax-code/ax-code-reason"
import { RefactorPlanID } from "@ax-code/ax-code-reason/id"
import { extractFilesFromDiff } from "@ax-code/ax-code-reason/analyze-impact"
import { CodeIntelligence } from "../code-intelligence"
import { Installation } from "../installation"
import { currentSourceState } from "../quality/source-state"
import { fromRefactorApplyResult } from "../quality/verification-envelope-builder"
import type { VerificationGraph } from "../quality/verification-envelope"
import { Hash } from "../util/hash"
import { normalizeToWorkspacePath } from "./file-path"
import { ToolBoolean } from "./schema"

// Tool wrapper around DebugEngine.applySafeRefactor. This is the ONLY
// DRE tool that writes files. It goes through the permission system
// with `permission: "edit"` so users approve each apply (mirrors the
// edit/write/apply_patch tools).
//
// Gated behind AX_CODE_EXPERIMENTAL_DEBUG_ENGINE like the other DRE
// tools. NOT added to read-only permission presets (ADR-010).

const MODES = ["safe", "aggressive"] as const
const CommandOverrides = z
  .object({
    typecheck: z.string().min(1).nullable().optional(),
    lint: z.string().min(1).nullable().optional(),
    test: z.string().min(1).nullable().optional(),
  })
  .strict()

// Phase 1 provenance: defensive graph snapshot for the verification
// envelopes. The graph may not be indexed (no cursor row) or the
// intelligence store may be unavailable — either way the field is omitted.
function currentGraphState(): VerificationGraph | undefined {
  try {
    const status = CodeIntelligence.status(Instance.project.id)
    if (status.lastUpdated == null) return undefined
    // revision is reserved for the derived graph revision hash; the graph
    // status endpoint does not compute one yet.
    return { revision: null, lastCommitSha: status.lastCommitSha, indexedAt: status.lastUpdated }
  } catch {
    return undefined
  }
}

export const RefactorApplyTool = Tool.define("refactor_apply", {
  description: DESCRIPTION,
  parameters: z.object({
    planId: z.string().describe("RefactorPlanID returned by refactor_plan"),
    patch: z.string().optional().describe("Unified diff to apply; omit to run pre-flight checks only"),
    mode: z
      .enum(MODES)
      .optional()
      .describe("'safe' runs every check (default); 'aggressive' allows skipLint/skipTests"),
    skipLint: ToolBoolean.optional().describe("Aggressive mode only: skip lint"),
    skipTests: ToolBoolean.optional().describe("Aggressive mode only: skip tests"),
    commands: CommandOverrides.optional().describe(
      "Optional command overrides. Omit a field to infer defaults, set it to null to skip, or set it to a command string to run exactly that command.",
    ),
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
      patternFiles.length > 0 ? patternFiles.map((f) => normalizeToWorkspacePath(f, Instance.worktree)) : ["*"]
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

    if (ctx.abort.aborted) throw new DOMException("Refactor apply aborted", "AbortError")

    // Fingerprint the worktree BEFORE the pipeline runs — the envelopes
    // claim "these checks passed against this source state". The shadow
    // worktree is a copy of the real worktree at this moment.
    const sourceState = await currentSourceState(Instance.worktree, Instance.project.vcs ?? "")
    const startedAt = new Date()

    // Boundary validation (PRD E3, Phase 2): the engine's branded
    // `RefactorPlanID` accepts the unbranded string through `.make()`,
    // but `.make()` is a blind cast — any garbage value sails through.
    // Validate against `RefactorPlanID.zod` first so a forged or
    // truncated id never reaches the engine. The shape is "rpl_<base62>"
    // — exactly what the public `plan_refactor` tool produces.
    const parsed = RefactorPlanID.zod.safeParse(args.planId)
    if (!parsed.success) {
      throw new Error(`refactor_apply: invalid planId ${JSON.stringify(args.planId)} — expected "rpl_<base62>"`)
    }
    const result = await DebugEngine.applySafeRefactor(projectID, {
      planId: RefactorPlanID.make(args.planId),
      patch: args.patch,
      mode: args.mode,
      skipLint: args.skipLint,
      skipTests: args.skipTests,
      commands: args.commands,
    })
    const endedAt = new Date()

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
      sourceState,
      graph: currentGraphState(),
      environment: {
        // The engine resolves the actual commands internally; the
        // deterministic config surface visible here is the requested
        // overrides plus the mode/skip flags that select which checks ran.
        configDigest: Hash.fast(
          JSON.stringify({
            commands: args.commands ?? null,
            mode: args.mode ?? "safe",
            skipLint: args.skipLint ?? false,
            skipTests: args.skipTests ?? false,
          }),
        ),
        toolVersions: { "ax-code": Installation.VERSION },
      },
      execution: {
        // applySafeRefactor runs typecheck/lint/tests as one pipeline
        // without per-check timing — a single window is attached to every
        // envelope produced from this apply.
        startedAt: startedAt.toISOString(),
        endedAt: endedAt.toISOString(),
        exitCode: null,
        signal: null,
        timedOut: false,
        outputTruncated: false,
      },
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
