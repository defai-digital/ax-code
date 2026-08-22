import z from "zod"
import { Instance } from "../project/instance"
import { CodeIntelligence } from "../code-intelligence"
import { Installation } from "../installation"
import {
  resolveCommands,
  runCheck,
  runTests,
  type TimedCheckResult,
  type TimedTestResult,
} from "../planner/verification/runner"
import { briefFromFailure, shouldHandoff } from "../planner/verification/repair-handoff"
import { WorkflowEnum } from "../quality/finding"
import { Policy, type PolicyRequiredCheck, type PolicyRules } from "../quality/policy"
import { currentSourceState } from "../quality/source-state"
import {
  computeEnvelopeId,
  type VerificationEnvelope,
  VerificationEnvelopeSchema,
  type VerificationExecution,
  type VerificationGraph,
} from "../quality/verification-envelope"
import { fromVerificationCommandResult } from "../quality/verification-envelope-builder"
import { Hash } from "../util/hash"
import { Tool } from "./tool"
import DESCRIPTION from "./verify_project.txt"
import { normalizeToWorkspacePath } from "./file-path"

const POLICY_CONTEXT_MAX_CHARS = 4_000

const CommandOverrides = z
  .object({
    typecheck: z.string().min(1).nullable().optional(),
    lint: z.string().min(1).nullable().optional(),
    test: z.string().min(1).nullable().optional(),
  })
  .strict()

type Timed<T> = T & { duration: number; startedAt: string; endedAt: string }

function normalizePaths(paths: readonly string[] | undefined): string[] {
  return (paths ?? []).map((file) => {
    return normalizeToWorkspacePath(file, Instance.worktree)
  })
}

function scope(paths: readonly string[], description?: string): VerificationEnvelope["scope"] {
  if (description) {
    return {
      kind: "custom",
      description,
      ...(paths.length > 0 ? { paths: [...paths] } : {}),
    }
  }
  if (paths.length > 0) return { kind: "file", paths: [...paths] }
  return { kind: "workspace" }
}

async function timed<T>(fn: () => Promise<T>): Promise<Timed<T>> {
  const startedAt = new Date()
  const start = Date.now()
  const result = await fn()
  const endedAt = new Date()
  return { ...result, duration: Date.now() - start, startedAt: startedAt.toISOString(), endedAt: endedAt.toISOString() }
}

// Phase 1 provenance capture. Graph state is defensive: the code graph may
// not be indexed (no cursor row) or the intelligence store may be
// unavailable — either way the envelope simply omits the field.
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

// The runner caps captured error output (runCheck keeps the first 20 lines,
// runTests 30 lines + 5 failure lines). Hitting the cap means the envelope
// output is a truncated view of the raw stream; below the cap we cannot
// tell, so we report false. Raw output hashes are omitted because the
// runner only surfaces the truncated lines to this layer.
function checkExecution(check: Timed<TimedCheckResult>): VerificationExecution {
  return {
    startedAt: check.startedAt,
    endedAt: check.endedAt,
    exitCode: check.exitCode ?? null,
    signal: null,
    timedOut: check.timedOut ?? false,
    outputTruncated: check.errors.length >= 20,
  }
}

function testExecution(tests: Timed<TimedTestResult>): VerificationExecution {
  return {
    startedAt: tests.startedAt,
    endedAt: tests.endedAt,
    exitCode: tests.exitCode ?? null,
    signal: null,
    timedOut: tests.timedOut ?? false,
    outputTruncated: tests.errors.length >= 30 || tests.failures.length >= 5,
  }
}

function runnableCommands(commands: { typecheck: string | null; lint: string | null; test: string | null }): string[] {
  return [commands.typecheck, commands.lint, commands.test].filter((cmd): cmd is string => Boolean(cmd))
}

function statusLine(label: string, envelope: VerificationEnvelope, id: string): string {
  const commandText = envelope.command.argv.length > 0 ? ` (${envelope.command.argv.slice(2).join(" ")})` : ""
  const issueText =
    envelope.structuredFailures.length > 0 ? `, ${envelope.structuredFailures.length} parsed failure(s)` : ""
  return `${label}: ${envelope.result.status}${issueText}, envelope=${id}${commandText}`
}

function passed(envelopes: VerificationEnvelope[]): boolean {
  return envelopes.every((envelope) => envelope.result.status === "passed" || envelope.result.status === "skipped")
}

function missingRequiredChecks(envelopes: readonly VerificationEnvelope[], rules: PolicyRules | undefined) {
  const required = rules?.required_checks ?? []
  if (required.length === 0) return []

  const byRunner = new Map(envelopes.map((envelope) => [envelope.command.runner, envelope.result.status]))
  return required.filter((runner) => byRunner.get(runner) === "skipped")
}

function applyRequiredCheckPolicy(
  envelopes: readonly VerificationEnvelope[],
  missingChecks: readonly PolicyRequiredCheck[],
): VerificationEnvelope[] {
  if (missingChecks.length === 0) return [...envelopes]
  const missing = new Set<string>(missingChecks)
  return envelopes.map((envelope) => {
    if (!missing.has(envelope.command.runner) || envelope.result.status !== "skipped") return envelope
    const message = `Policy required check "${envelope.command.runner}" was skipped.`
    const output = envelope.result.output ? `${envelope.result.output}\n${message}` : message
    return VerificationEnvelopeSchema.parse({
      ...envelope,
      result: {
        ...envelope.result,
        passed: false,
        status: "failed",
        output,
      },
      structuredFailures: [
        ...envelope.structuredFailures,
        {
          kind: "custom",
          message,
          details: {
            runner: envelope.command.runner,
            policy: "required_checks",
          },
        },
      ],
    })
  })
}

function policyLines(input: { rules: PolicyRules | undefined; missingRequiredChecks: readonly PolicyRequiredCheck[] }) {
  if (!input.rules) return []
  const lines = ["", "Policy rules: loaded"]
  if (input.rules.required_checks && input.rules.required_checks.length > 0) {
    lines.push(`Policy required checks: ${input.rules.required_checks.join(", ")}`)
  }
  if (input.missingRequiredChecks.length > 0) {
    lines.push(`Policy missing required checks: ${input.missingRequiredChecks.join(", ")}`)
  }
  return lines
}

function policyContext(input: { workflow: z.infer<typeof WorkflowEnum>; text: string | undefined }) {
  const text = input.text?.trim()
  if (!text) return undefined
  const truncated = text.length > POLICY_CONTEXT_MAX_CHARS
  return {
    workflow: input.workflow,
    bytes: new TextEncoder().encode(text).byteLength,
    truncated,
    text: truncated ? `${text.slice(0, POLICY_CONTEXT_MAX_CHARS)}\n[policy truncated]` : text,
  }
}

function policyContextLines(context: ReturnType<typeof policyContext>) {
  if (!context) return []
  const label = context.workflow === "qa" ? "QA" : context.workflow
  return [
    "",
    `Project ${label} policy: loaded (${context.bytes} bytes${context.truncated ? ", truncated" : ""})`,
    context.text,
  ]
}

function repairHandoffMetadata(input: {
  enabled: boolean | undefined
  envelopes: readonly VerificationEnvelope[]
  envelopeIds: readonly { envelopeId: string; name: string; status: VerificationEnvelope["result"]["status"] }[]
}) {
  if (!input.enabled) return undefined

  const candidates: Array<{
    envelopeId: string
    runner: string
    status: VerificationEnvelope["result"]["status"]
    reasoning: string
    brief: string
  }> = []
  const rejected: Array<{
    envelopeId: string
    runner: string
    status: VerificationEnvelope["result"]["status"]
    reasoning: string
  }> = []

  input.envelopes.forEach((envelope, index) => {
    const envelopeId = input.envelopeIds[index]?.envelopeId ?? computeEnvelopeId(envelope)
    const decision = shouldHandoff(envelope)
    const item = {
      envelopeId,
      runner: envelope.command.runner,
      status: envelope.result.status,
      reasoning: decision.reasoning,
    }
    if (decision.handoff) {
      candidates.push({
        ...item,
        brief: briefFromFailure(envelope),
      })
      return
    }
    rejected.push(item)
  })

  return {
    enabled: true,
    candidates,
    rejected,
  }
}

export const VerifyProjectTool = Tool.define("verify_project", {
  description: DESCRIPTION,
  parameters: z.object({
    workflow: WorkflowEnum.optional().describe('Assurance lane: "review", "debug", or "qa". Defaults to "qa".'),
    paths: z.array(z.string().min(1)).max(200).optional().describe("Repo-relative files that define the scope."),
    scopeDescription: z.string().min(1).max(500).optional().describe("Human-readable scope when paths are not enough."),
    repairHandoff: z
      .boolean()
      .optional()
      .describe("When true, include repair handoff briefs for localized structured failures. Does not edit files."),
    commands: CommandOverrides.optional().describe(
      "Optional command overrides. Omit a field to infer from package.json, set it to null to skip, or set it to a command string to run exactly that command.",
    ),
  }),
  execute: async (args, ctx) => {
    const workflow = args.workflow ?? "qa"
    const cwd = Instance.worktree
    const paths = normalizePaths(args.paths)
    const policyRules = await Policy.loadWorkflowRules({
      workflow,
      worktree: Instance.worktree,
      cwd: Instance.directory,
    })
    const loadedPolicyContext = policyContext({
      workflow,
      text: await Policy.loadWorkflowPolicy({
        workflow,
        worktree: Instance.worktree,
        cwd: Instance.directory,
      }),
    })
    const commands = await resolveCommands(cwd, args.commands)
    const commandPatterns = runnableCommands(commands)

    if (commandPatterns.length > 0) {
      await ctx.ask({
        permission: "bash",
        patterns: commandPatterns,
        always: commandPatterns,
        metadata: {
          tool: "verify_project",
          workflow,
          scope: scope(paths, args.scopeDescription),
        },
      })
    }

    if (ctx.abort.aborted) throw new DOMException("verify_project aborted", "AbortError")

    // Fingerprint the worktree BEFORE the checks run — the envelope claims
    // "this verification passed against this source state".
    const sourceState = await currentSourceState(Instance.worktree, Instance.project.vcs ?? "")

    const typecheck: Timed<TimedCheckResult> = await timed(() => runCheck("typecheck", commands.typecheck, cwd))
    if (ctx.abort.aborted) throw new DOMException("verify_project aborted", "AbortError")

    const lint: Timed<TimedCheckResult> = await timed(() => runCheck("lint", commands.lint, cwd))
    if (ctx.abort.aborted) throw new DOMException("verify_project aborted", "AbortError")

    const tests: Timed<TimedTestResult> = await timed(() =>
      runTests(commands.test, cwd, paths, Instance.project.id, "worktree"),
    )

    const rawVerificationEnvelopes = fromVerificationCommandResult({
      workflow,
      sessionID: ctx.sessionID,
      cwd,
      sourceTool: "verify_project",
      scope: scope(paths, args.scopeDescription),
      commands,
      checks: {
        typecheck: { ...typecheck, execution: checkExecution(typecheck) },
        lint: { ...lint, execution: checkExecution(lint) },
        tests: { ...tests, execution: testExecution(tests) },
      },
      sourceState,
      graph: currentGraphState(),
      environment: {
        // Deterministic digest of the resolved command selection — the
        // config surface that changes what "verification" meant for this run.
        configDigest: Hash.fast(JSON.stringify(commands)),
        toolVersions: { "ax-code": Installation.VERSION },
      },
    })
    const missingPolicyChecks = missingRequiredChecks(rawVerificationEnvelopes, policyRules)
    const verificationEnvelopes = applyRequiredCheckPolicy(rawVerificationEnvelopes, missingPolicyChecks)
    const envelopeIds = verificationEnvelopes.map((envelope) => ({
      envelopeId: computeEnvelopeId(envelope),
      name: envelope.result.name,
      status: envelope.result.status,
    }))
    const policyPassed = missingPolicyChecks.length === 0
    const allPassed = passed(verificationEnvelopes) && policyPassed
    const repairHandoff = repairHandoffMetadata({
      enabled: args.repairHandoff,
      envelopes: verificationEnvelopes,
      envelopeIds,
    })

    const lines = [
      `Workflow: ${workflow}`,
      `Scope: ${args.scopeDescription ?? (paths.length > 0 ? paths.join(", ") : "workspace")}`,
      `Passed: ${allPassed}`,
      "",
      ...verificationEnvelopes.map((envelope, index) =>
        statusLine(envelope.result.name, envelope, envelopeIds[index].envelopeId),
      ),
      ...policyLines({ rules: policyRules, missingRequiredChecks: missingPolicyChecks }),
      ...policyContextLines(loadedPolicyContext),
      ...(repairHandoff
        ? [
            "",
            `Repair handoff candidates: ${repairHandoff.candidates.length}`,
            ...repairHandoff.candidates.map(
              (candidate) =>
                `Repair handoff: ${candidate.runner} ${candidate.status}, envelope=${candidate.envelopeId}, ${candidate.reasoning}`,
            ),
          ]
        : []),
    ]

    return {
      title: allPassed ? "verify_project passed" : "verify_project failed",
      output: lines.join("\n"),
      metadata: {
        passed: allPassed,
        envelopeIds,
        commands,
        verificationEnvelopes,
        repairHandoff,
        policy: policyRules
          ? {
              rules: policyRules,
              requiredChecksPassed: policyPassed,
              missingRequiredChecks: missingPolicyChecks,
            }
          : undefined,
        policyContext: loadedPolicyContext,
      },
    }
  },
})
