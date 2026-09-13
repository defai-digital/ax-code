/**
 * Arena plan-comparison tool (ADR-049 Phase 2 scaffold).
 * Fan-out structured approaches; rank with pure Arena scorer.
 * Does not write files — advisory best-of-N for plans.
 */

import { streamObject } from "ai"
import { createHash } from "crypto"
import z from "zod"
import path from "path"
import { Config } from "../config/config"
import { Arena } from "../mode/arena"
import { Budget } from "../mode/budget"
import { Council } from "../mode/council"
import { CouncilContext } from "../mode/council-context"
import { EnsembleShared, isNonTransientMemberError } from "../mode/ensemble-shared"
import { ensureJsonModeInstruction } from "../mode/json-mode-prompt"
import { EnsemblePreflight } from "../mode/preflight"
import { ModeMemory } from "../mode/memory"
import type { ModePolicy } from "../mode/policy"
import { Instance } from "../project/instance"
import { Provider } from "../provider/provider"
import { ProviderTransform } from "../provider/transform"
import { Agent } from "../agent/agent"
import { Log } from "../util/log"
import { FanOut } from "../util/fan-out"
import { Tool } from "./tool"
import { inspectImplementArenaBase, runImplementArena } from "./arena-implement"
import { resolveMemberTimeoutMs } from "./council"
import DESCRIPTION from "./arena.txt"

const log = Log.create({ service: "tool.arena" })

const DEFAULT_MAX = 3
const HARD_MAX = 5
const DEFAULT_TIMEOUT_MS = 60_000
// ADR-101: planning estimate for one implement trajectory under the
// 12-minute cap — a rough upper bound, not a measurement.
const IMPLEMENT_ESTIMATED_CALLS_PER_MEMBER = 12

/**
 * Arena timeout policy: same knobs as council with the same fallback chain
 * (arena → council → default) as timeoutMs itself (ADR-099). Exported for tests.
 */
export function arenaTimeoutPolicy(modes: ModePolicy.ModesConfig | undefined): {
  timeoutMs: number
  reasoningScale?: number
  memberOverrides?: Record<string, number>
} {
  return {
    timeoutMs: modes?.arena?.timeoutMs ?? modes?.council?.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    reasoningScale: modes?.arena?.reasoningTimeoutScale ?? modes?.council?.reasoningTimeoutScale,
    memberOverrides: modes?.arena?.memberTimeoutMs ?? modes?.council?.memberTimeoutMs,
  }
}

// Length/count caps are enforced by clamping after parse (see clampProposal),
// not hard zod .max() constraints — verbose members otherwise fail the whole
// fan-out with "response did not match schema". Numeric scores are clamped in
// a preprocess so a model emitting riskScore 25 or confidence 1.2 degrades
// gracefully instead of rejecting the proposal.
const clampNumber = (min: number, max: number) => (value: unknown) =>
  typeof value === "number" && Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : value

const ProposalSchema = z.object({
  approach: z.string().min(1).describe("Approach summary, at most 1200 chars"),
  steps: z.array(z.string().min(1)).min(1).describe("Ordered steps, at most 12, each at most 300 chars"),
  risks: z.array(z.string().min(1)).describe("Risks, at most 8, each at most 300 chars"),
  riskScore: z.preprocess((value) => {
    const clamped = clampNumber(0, 20)(value)
    return typeof clamped === "number" ? Math.round(clamped) : clamped
  }, z.number().int().min(0).max(20)),
  confidence: z.preprocess(clampNumber(0, 1), z.number().min(0).max(1)).optional(),
})

function clampProposalText(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max - 1)}…` : value
}

function clampProposal(proposal: z.infer<typeof ProposalSchema>): z.infer<typeof ProposalSchema> {
  return {
    ...proposal,
    approach: clampProposalText(proposal.approach, 1200),
    steps: proposal.steps.slice(0, 12).map((step) => clampProposalText(step, 300)),
    risks: proposal.risks.slice(0, 8).map((risk) => clampProposalText(risk, 300)),
  }
}

// Kept local to avoid circular-dependency at module-load time (identical to council.ts).
const MemberSelectionSchema = z.object({
  providerID: z.string().min(1).max(200),
  modelID: z.string().min(1).max(300).optional(),
})

function validateMemberSelections(
  selections: Array<z.infer<typeof MemberSelectionSchema>>,
  ctx: z.RefinementCtx,
): void {
  const seen = new Set<string>()
  selections.forEach((selection, index) => {
    const key = `${selection.providerID}\u0000${selection.modelID ?? ""}`
    if (seen.has(key)) {
      ctx.addIssue({ code: "custom", message: "Duplicate provider/model selection", path: [index] })
    }
    seen.add(key)
  })
}

const parameters = z.object({
  task: z.string().min(1).describe("The coding task to compare approaches for"),
  context: z.string().optional().describe("Optional codebase or requirements context"),
  mode: z
    .enum(["plan", "implement"])
    .optional()
    .describe(
      "plan (default): multi-model approach comparison only. implement: worktree-isolated implement arena with verify-first ranking.",
    ),
  providers: z.array(MemberSelectionSchema).min(2).max(HARD_MAX).superRefine(validateMemberSelections).optional(),
  strategy: z.enum(["verify_first", "diversity", "hybrid_score"]).optional(),
  enableIfDisabled: z
    .boolean()
    .optional()
    .describe(
      "If arena is disabled in config, write modes.arena.enabled=true to project ax-code.json and continue (same session).",
    ),
})

function fingerprint(text: string): string {
  const normalized = text.toLowerCase().replace(/\s+/g, " ").trim()
  return createHash("sha256").update(normalized).digest("hex").slice(0, 16)
}

async function runProposal(input: {
  member: EnsembleShared.MemberSpec
  task: string
  context?: string
  timeoutMs: number
  reasoningScale?: number
  memberOverrides?: Record<string, number>
  abort: AbortSignal
  retryOnce?: boolean
}): Promise<{
  member: EnsembleShared.MemberSpec
  proposal?: z.infer<typeof ProposalSchema>
  error?: string
}> {
  const started = Date.now()
  const retryOnce = input.retryOnce ?? true

  // Resolve the model + language up front (before the fan-out timer starts):
  // a cold SDK load/install must not count against the member timeout, and the
  // effective timeout scales for reasoning models. Failures become member
  // errors, as they would inside execute.
  let model: Provider.Model
  let language: Awaited<ReturnType<typeof Provider.getLanguage>>
  try {
    model = await Provider.getModel(input.member.providerID, input.member.modelID)
    language = await Provider.getLanguage(model)
  } catch (error) {
    return {
      member: input.member,
      error: FanOut.describeError(error),
    }
  }
  const memberTimeoutMs = resolveMemberTimeoutMs({
    providerID: String(input.member.providerID),
    modelID: String(input.member.modelID),
    reasoning: model.capabilities?.reasoning,
    baseTimeoutMs: input.timeoutMs,
    reasoningScale: input.reasoningScale,
    memberOverrides: input.memberOverrides,
  })

  const attemptProposal = async (): Promise<FanOut.MemberResult<z.infer<typeof ProposalSchema>>> => {
    const [result] = await FanOut.run({
      members: [input.member],
      timeoutMs: memberTimeoutMs,
      abort: input.abort,
      onMemberComplete: (completed, total, m) => {
        log.info("arena fan-out member done", {
          toolName: "arena",
          memberId: m.memberId,
          completed,
          total,
        })
      },
      execute: async (_m, signal) => {
        const result = streamObject({
          model: language,
          maxOutputTokens: ProviderTransform.auxMaxOutputTokens(model),
          schema: ProposalSchema,
          maxRetries: 0,
          abortSignal: signal,
          temperature: 0.3,
          messages: [
            {
              role: "system",
              // ensureJsonModeInstruction: Qwen/Alibaba require the word "json" when generateObject
              // uses response_format json_object.
              content: ensureJsonModeInstruction(`You are one independent contestant in a coding-agent arena.
Propose a concrete implementation approach for the task. Do not write full source files.
Focus on approach, ordered steps, and risks. Be specific to the context.
Give an overall riskScore from 0 (low implementation risk) to 20 (high). Do not lower it by omitting risks.
Return a json object with this shape: {"approach": string, "steps": string[], "risks": string[], "riskScore": number, "confidence": number (optional)}.`),
            },
            {
              role: "user",
              // ADR-099: context is admitted verbatim (or the call was rejected
              // with context_rejected) — never silently sliced.
              content: [`Task: ${input.task}`, input.context ? `\nContext:\n${input.context}` : ""]
                .filter(Boolean)
                .join("\n"),
            },
          ],
        })
        for await (const part of result.fullStream) {
          if (part.type === "error") throw part.error
        }
        return await result.object
      },
    })
    return result!
  }

  // First attempt
  const first = await attemptProposal()
  if (first.result) {
    log.info("arena proposal ok", {
      toolName: "arena",
      memberId: input.member.memberId,
      durationMs: Date.now() - started,
      status: "ok",
    })
    return { member: input.member, proposal: clampProposal(first.result) }
  }

  const firstError = first.error ?? ""
  const wasTimeout = firstError.startsWith("timeout:")
  const wasAborted = firstError.startsWith("aborted:") || input.abort.aborted
  log.warn("arena proposal failed", {
    toolName: "arena",
    memberId: input.member.memberId,
    durationMs: Date.now() - started,
    status: wasTimeout ? "timeout" : wasAborted ? "aborted" : "error",
  })

  // Retry once on non-abort, non-timeout failure. ADR-099: skip failures an
  // immediate retry cannot fix (auth, rate limit, unsupported spec version).
  if (retryOnce && !wasTimeout && !wasAborted && !isNonTransientMemberError(firstError)) {
    log.info("arena proposal retrying", {
      toolName: "arena",
      memberId: input.member.memberId,
    })
    const retryStarted = Date.now()
    const retry = await attemptProposal()
    if (retry.result) {
      log.info("arena proposal retry ok", {
        toolName: "arena",
        memberId: input.member.memberId,
        durationMs: Date.now() - retryStarted,
        status: "ok",
      })
      return { member: input.member, proposal: clampProposal(retry.result) }
    }
    const retryError = retry.error ?? ""
    log.warn("arena proposal retry failed", {
      toolName: "arena",
      memberId: input.member.memberId,
      durationMs: Date.now() - retryStarted,
      status: retryError.startsWith("timeout:")
        ? "timeout"
        : retryError.startsWith("aborted:") || input.abort.aborted
          ? "aborted"
          : "error",
    })
    return { member: input.member, error: retry.error ?? "unknown" }
  }

  return { member: input.member, error: first.error ?? "unknown" }
}

// ADR-101: blinded listwise rubric judge for plan mode. One extra structured
// call scores every proposal on a fixed rubric; identities are stripped and
// candidate order is randomized so position/origin cannot steer the scores.
const JudgeScoreSchema = z.object({
  candidate: z.string().min(1).describe('Anonymous candidate label, e.g. "A"'),
  requirementCoverage: z.preprocess(clampNumber(0, 10), z.number()),
  feasibility: z.preprocess(clampNumber(0, 10), z.number()),
  verificationPlan: z.preprocess(clampNumber(0, 10), z.number()),
  riskEvidence: z.preprocess(clampNumber(0, 10), z.number()),
})

const JudgeOutputSchema = z.object({
  scores: z.array(JudgeScoreSchema).describe("Exactly one entry per candidate label; ties are allowed"),
})

export type JudgeDimensionScores = {
  requirementCoverage: number
  feasibility: number
  verificationPlan: number
  riskEvidence: number
  total: number
}

function candidateLabel(index: number): string {
  // A..Z for up to 26 candidates (arena hard max is 5).
  return String.fromCharCode(65 + index)
}

async function runPlanJudge(input: {
  member: EnsembleShared.MemberSpec
  task: string
  context?: string
  proposals: Array<{ memberId: string; approach: string; steps: string[]; risks: string[] }>
  timeoutMs: number
  reasoningScale?: number
  memberOverrides?: Record<string, number>
  abort: AbortSignal
}): Promise<Map<string, JudgeDimensionScores>> {
  const model = await Provider.getModel(input.member.providerID, input.member.modelID)
  const language = await Provider.getLanguage(model)
  const memberTimeoutMs = resolveMemberTimeoutMs({
    providerID: String(input.member.providerID),
    modelID: String(input.member.modelID),
    reasoning: model.capabilities?.reasoning,
    baseTimeoutMs: input.timeoutMs,
    reasoningScale: input.reasoningScale,
    memberOverrides: input.memberOverrides,
  })

  // Blinding: strip member identities and shuffle so the judge cannot map a
  // proposal to a provider or to its fan-out position (its own included).
  const shuffled = [...input.proposals]
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    const tmp = shuffled[i]!
    shuffled[i] = shuffled[j]!
    shuffled[j] = tmp
  }
  const memberIdByLabel = new Map<string, string>()
  const blocks = shuffled.map((proposal, index) => {
    const label = candidateLabel(index)
    memberIdByLabel.set(label, proposal.memberId)
    const steps = proposal.steps.map((step) => `- ${step}`).join("\n")
    const risks = proposal.risks.length ? proposal.risks.map((risk) => `- ${risk}`).join("\n") : "(none stated)"
    return `### Candidate ${label}\nApproach: ${proposal.approach}\nSteps:\n${steps}\nRisks:\n${risks}`
  })

  const user = [
    `Task: ${input.task}`,
    input.context ? `\nContext:\n${input.context}` : "",
    "",
    "Proposals (anonymized, order randomized):",
    "",
    ...blocks,
  ]
    .filter((line) => line !== "")
    .join("\n")

  const attempt = async (): Promise<z.infer<typeof JudgeOutputSchema>> => {
    const [result] = await FanOut.run({
      members: [input.member],
      timeoutMs: memberTimeoutMs,
      abort: input.abort,
      execute: async (_m, signal) => {
        const result = streamObject({
          model: language,
          maxOutputTokens: ProviderTransform.auxMaxOutputTokens(model),
          schema: JudgeOutputSchema,
          maxRetries: 0,
          abortSignal: signal,
          temperature: 0.1,
          messages: [
            {
              role: "system",
              // ensureJsonModeInstruction: Qwen/Alibaba require the word "json" when generateObject
              // uses response_format json_object.
              content: ensureJsonModeInstruction(`You are an independent judge in a coding-agent plan arena.
Score each anonymized proposal on four dimensions from 0 (absent) to 10 (excellent):
- requirementCoverage: how completely the approach addresses the stated task and context.
- feasibility: how realistic the ordered steps are to implement correctly.
- verificationPlan: how well the proposal makes its own correctness checkable (tests, validation).
- riskEvidence: how concretely the stated risks are tied to this task rather than generic boilerplate.
Candidate identities are hidden and order is randomized: do not infer origin, and do not reward style or verbosity.
Score candidates independently; ties are allowed.
Return a json object with this shape: {"scores": [{"candidate": "A", "requirementCoverage": number, "feasibility": number, "verificationPlan": number, "riskEvidence": number}]} with exactly one entry per candidate label.`),
            },
            { role: "user", content: user },
          ],
        })
        for await (const part of result.fullStream) {
          if (part.type === "error") throw part.error
        }
        return await result.object
      },
    })
    if (result.error) throw new Error(result.error)
    return result.result!
  }

  let output: z.infer<typeof JudgeOutputSchema>
  try {
    output = await attempt()
  } catch (firstError) {
    const message = firstError instanceof Error ? firstError.message : String(firstError)
    if (message.startsWith("timeout:") || message.startsWith("aborted:") || isNonTransientMemberError(message)) {
      throw firstError
    }
    output = await attempt()
  }

  const scores = new Map<string, JudgeDimensionScores>()
  for (const entry of output.scores) {
    const memberId = memberIdByLabel.get(entry.candidate.trim())
    if (!memberId || scores.has(memberId)) continue
    const requirementCoverage = Math.round(entry.requirementCoverage)
    const feasibility = Math.round(entry.feasibility)
    const verificationPlan = Math.round(entry.verificationPlan)
    const riskEvidence = Math.round(entry.riskEvidence)
    scores.set(memberId, {
      requirementCoverage,
      feasibility,
      verificationPlan,
      riskEvidence,
      total: requirementCoverage + feasibility + verificationPlan + riskEvidence,
    })
  }
  if (scores.size === 0) throw new Error("judge returned no usable candidate scores")
  return scores
}

type ArenaMetadata = {
  status: string
  strategy?: string
  memberCount?: number
  rankedIds?: string[]
  errorCount?: number
  budgetReasons?: string[]
  mode?: "plan" | "implement"
  worktrees?: string[]
  providerCount?: number
  providerIDs?: string[]
  enabledThisCall?: boolean
  suggestedTool?: string
  baseCommit?: string
  selectionErrors?: string[]
  contextAdmission?: CouncilContext.Admission
  judge?: "ok" | "failed" | "disabled" | "skipped"
  judgeError?: string
}

export const ArenaTool = Tool.define("arena", async () => {
  return {
    description: DESCRIPTION,
    parameters,
    async execute(args, ctx) {
      // Re-read project config so mid-session ax-code.json edits apply (no restart).
      let cfg = await Config.getFresh()
      let modes = (cfg as { modes?: ModePolicy.ModesConfig }).modes
      let enabledThisCall = false
      const providerSnap = await EnsembleShared.snapshotSelectableProviders()
      const suggestedTool = EnsemblePreflight.suggestTool(args.task)
      const arenaMode = args.mode ?? "plan"
      let baseCommit: string | undefined

      // Display-only config path in disabled messages; not a filesystem open.
      const projectConfigHint = path.join(Instance.directory, "ax-code.json")
      if (modes?.arena?.enabled !== true && args.enableIfDisabled !== true) {
        // Pure no-op path: report disabled without an approval prompt (ADR-097).
        const metadata: ArenaMetadata = {
          status: "disabled",
          mode: arenaMode,
          providerCount: providerSnap.count,
          providerIDs: providerSnap.ids,
          suggestedTool,
        }
        return {
          title: "Arena disabled",
          output: EnsemblePreflight.arenaDisabledMessage({
            providers: providerSnap,
            projectConfigHint,
          }),
          metadata,
        }
      }

      // ADR-099: caller context is required evidence, admitted verbatim up to
      // the shared cap or rejected before any preflight IO, approval prompt,
      // worktree creation, or model call — never silently sliced.
      const contextAdmission = CouncilContext.admit(args.context)
      if (contextAdmission.status === "rejected") {
        const metadata: ArenaMetadata = {
          status: "context_rejected",
          mode: arenaMode,
          providerCount: providerSnap.count,
          providerIDs: providerSnap.ids,
          contextAdmission,
        }
        return {
          title: "Arena context rejected",
          output:
            `Arena rejected ${contextAdmission.suppliedCharacters} UTF-16 code units ` +
            `(${contextAdmission.suppliedBytes} bytes) of required context; the limit is ${contextAdmission.maxCharacters}. ` +
            "No approval prompt, worktree, or model call ran and no context was truncated. Split the task into " +
            "explicitly scoped requests or reduce optional background while retaining the required evidence.",
          metadata,
        }
      }

      if (arenaMode === "implement" && (modes?.arena?.enabled === true || args.enableIfDisabled === true)) {
        const preflight = await inspectImplementArenaBase(Instance.worktree)
        if (!preflight.ok) {
          const strategy = args.strategy ?? modes?.arena?.strategy ?? "verify_first"
          const metadata: ArenaMetadata = {
            status: preflight.reason,
            strategy,
            mode: arenaMode,
            providerCount: providerSnap.count,
            providerIDs: providerSnap.ids,
          }
          const changes = preflight.changes.slice(0, 20).map((change) => `- ${JSON.stringify(change)}`)
          const guidance =
            preflight.reason === "not_git"
              ? "Initialize a git repository and create an initial commit, then re-run the implement arena."
              : preflight.reason === "no_base_commit"
                ? "Create an initial commit, then re-run the implement arena."
                : "Commit or stash these changes, then re-run the implement arena."
          return {
            title:
              preflight.reason === "not_git"
                ? "Implement arena requires git"
                : preflight.reason === "no_base_commit"
                  ? "Implement arena requires a base commit"
                  : "Implement arena needs a clean worktree",
            output: [
              preflight.message,
              ...(changes.length ? ["", "Uncommitted paths:", ...changes] : []),
              "",
              guidance,
            ].join("\n"),
            metadata,
          }
        }
        baseCommit = preflight.baseCommit
      }

      const strategy =
        args.strategy ?? modes?.arena?.strategy ?? (arenaMode === "implement" ? "verify_first" : "diversity")
      const maxContestants = Math.min(HARD_MAX, Math.max(1, modes?.arena?.maxContestants ?? DEFAULT_MAX))
      // ADR-099: arena honors the same timeout knobs as council, with the same
      // fallback chain (arena → council → default) as timeoutMs itself.
      const { timeoutMs, reasoningScale, memberOverrides } = arenaTimeoutPolicy(modes)

      // ADR-101: plan contestants cost their call plus the possible retry;
      // the blinded judge is one flat call per invocation. Implement
      // contestants run a full agent trajectory — price the documented
      // per-trajectory estimate, not one review call.
      const judgeEnabled = arenaMode === "plan" && modes?.arena?.judge !== false
      const budgetCheck = Budget.check({
        kind: "arena",
        requestedMembers: args.providers?.length ?? maxContestants,
        callsPerMember: arenaMode === "implement" ? IMPLEMENT_ESTIMATED_CALLS_PER_MEMBER : 2,
        flatCalls: judgeEnabled ? 1 : 0,
        budget: {
          maxMembers: modes?.arena?.maxContestants ?? 3,
          maxContestants,
          timeoutMs,
          maxEstimatedUsd: modes?.budget?.maxEstimatedUsd,
          estimatedUsdPerMember: modes?.budget?.estimatedUsdPerMember,
        },
      })
      if (!budgetCheck.ok) {
        const metadata: ArenaMetadata = {
          status: "budget_rejected",
          strategy,
          mode: arenaMode,
          providerCount: providerSnap.count,
          providerIDs: providerSnap.ids,
          enabledThisCall,
        }
        return {
          title: "Arena budget rejected",
          output: budgetCheck.message,
          metadata,
        }
      }

      const resolution = await EnsembleShared.resolveMembers(
        { requireDistinctProviders: false },
        args.providers,
        budgetCheck.allowedMembers,
        args.task,
      )
      let members = resolution.members
      if (members.length > budgetCheck.allowedMembers) {
        members = members.slice(0, budgetCheck.allowedMembers)
      }

      if (members.length < 2) {
        const metadata: ArenaMetadata = {
          status: "insufficient_members",
          memberCount: members.length,
          strategy,
          budgetReasons: budgetCheck.reasons,
          mode: arenaMode,
          providerCount: providerSnap.count,
          providerIDs: providerSnap.ids,
          enabledThisCall,
          selectionErrors: resolution.rejected,
        }
        return {
          title: "Arena: need ≥2 models",
          output:
            EnsemblePreflight.arenaInsufficientProvidersMessage(providerSnap) +
            (resolution.rejected.length
              ? `\n\nRequested selections skipped:\n${resolution.rejected.map((error) => `- ${error}`).join("\n")}`
              : "") +
            (resolution.notes?.length
              ? `\n\nSelection notes:\n${resolution.notes.map((note) => `- ${note}`).join("\n")}`
              : ""),
          metadata,
        }
      }

      // Ask only after every no-op preflight has passed (ADR-099 extends
      // council's ADR-097 ask-last ordering to arena): the config write below
      // and the fan-out are the first mutating/expensive steps.
      await ctx.ask({
        permission: "arena",
        patterns: ["*"],
        always: ["*"],
        metadata: { task: args.task.slice(0, 200), mode: arenaMode },
      })

      if (modes?.arena?.enabled !== true) {
        // args.enableIfDisabled === true: persist the opt-in, then continue.
        await Config.update({
          modes: {
            arena: {
              enabled: true,
              maxContestants: modes?.arena?.maxContestants ?? DEFAULT_MAX,
              strategy: args.strategy ?? modes?.arena?.strategy ?? "verify_first",
            },
          },
        })
        enabledThisCall = true
        cfg = await Config.getFresh()
        modes = (cfg as { modes?: ModePolicy.ModesConfig }).modes
      }

      if (modes?.arena?.enabled !== true) {
        // Defensive: the persisted opt-in did not take effect.
        const metadata: ArenaMetadata = {
          status: "disabled",
          mode: arenaMode,
          providerCount: providerSnap.count,
          providerIDs: providerSnap.ids,
          suggestedTool,
        }
        return {
          title: "Arena disabled",
          output: EnsemblePreflight.arenaDisabledMessage({
            providers: providerSnap,
            projectConfigHint,
          }),
          metadata,
        }
      }

      // --- Implement arena (worktree-isolated writers + verify) ---
      if (arenaMode === "implement") {
        if (!baseCommit) throw new Error("Implement arena base commit was not resolved")
        const agentName = await Agent.defaultAgent().catch(() => "build")
        const impl = await runImplementArena({
          members,
          task: args.task,
          context: args.context,
          parentSessionID: ctx.sessionID,
          baseCommit,
          agentName,
          strategy,
          abort: ctx.abort,
        })

        const failedIds = impl.ranked.filter((result) => result.verification === "fail").map((result) => result.id)
        const verifiedCount = impl.ranked.filter((result) => result.verification === "pass").length
        void ModeMemory.recordArenaRanking({
          task: args.task,
          rankedIds: impl.ranked.filter((r) => r.verification === "pass").map((r) => r.id),
          failedIds,
        }).catch(() => undefined)

        const metadata: ArenaMetadata = {
          status: verifiedCount > 0 ? "ok" : "no_verified_candidate",
          strategy,
          memberCount: members.length,
          rankedIds: impl.ranked.map((r) => r.id),
          errorCount: failedIds.length,
          budgetReasons: budgetCheck.reasons,
          mode: "implement",
          worktrees: impl.results.map((r) => r.worktreeDirectory).filter((d): d is string => Boolean(d)),
          providerCount: providerSnap.count,
          providerIDs: providerSnap.ids,
          enabledThisCall,
          baseCommit,
          selectionErrors: resolution.rejected,
        }

        return {
          title:
            verifiedCount > 0
              ? `Implement arena ranked ${impl.ranked.length} contestants`
              : "Implement arena found no verified candidate",
          output:
            impl.markdown +
            (enabledThisCall ? "\n\n_Enabled `modes.arena.enabled` for this project during this call._" : "") +
            (resolution.rejected.length ? `\n\n_Skipped selections: ${resolution.rejected.join("; ")}_` : "") +
            (budgetCheck.reasons.length ? `\n\n_Budget: ${budgetCheck.reasons.join(", ")}_` : ""),
          metadata,
        }
      }

      // --- Plan arena (approach comparison only) ---
      let arenaCompleted = 0
      const results = await Promise.all(
        members.map(async (member) => {
          const result = await runProposal({
            member,
            task: args.task,
            context: args.context,
            timeoutMs,
            reasoningScale,
            memberOverrides,
            abort: ctx.abort,
          })
          arenaCompleted++
          log.info("arena proposal progress", {
            toolName: "arena",
            memberId: member.memberId,
            completed: arenaCompleted,
            total: members.length,
          })
          return result
        }),
      )
      // Propagate abort cleanly before aggregation / memory recording.
      ctx.abort.throwIfAborted()
      const candidates: Arena.ArenaCandidate[] = []
      const proposalById = new Map<string, z.infer<typeof ProposalSchema>>()
      const errors: string[] = []
      errors.push(...resolution.rejected.map((error) => `selection: ${error}`))
      const failedIds: string[] = []

      for (const r of results) {
        if (r.error || !r.proposal) {
          errors.push(`${r.member.memberId}: ${r.error ?? "no proposal"}`)
          failedIds.push(r.member.memberId)
          candidates.push({
            id: r.member.memberId,
            providerID: String(r.member.providerID),
            modelID: String(r.member.modelID),
            verification: "fail",
            riskScore: 20,
            popularity: 0,
          })
          continue
        }
        proposalById.set(r.member.memberId, r.proposal)
        candidates.push({
          id: r.member.memberId,
          providerID: String(r.member.providerID),
          modelID: String(r.member.modelID),
          verification: "unknown",
          riskScore: r.proposal.riskScore,
          patchFingerprint: fingerprint(r.proposal.approach + "|" + r.proposal.steps.join("|")),
          popularity: r.proposal.confidence ?? 0,
        })
      }

      // ADR-101: blinded rubric judge — the primary plan ranking signal.
      // Failure (or modes.arena.judge: false) degrades to self-assessed
      // scoring with a disclosure note.
      let judgeStatus: "ok" | "failed" | "disabled" | "skipped" = judgeEnabled ? "skipped" : "disabled"
      let judgeError: string | undefined
      const judgeById = new Map<string, JudgeDimensionScores>()
      if (judgeEnabled && proposalById.size >= 2) {
        try {
          const judged = await runPlanJudge({
            member: members[0]!,
            task: args.task,
            context: args.context,
            proposals: [...proposalById.entries()].map(([memberId, p]) => ({
              memberId,
              approach: p.approach,
              steps: p.steps,
              risks: p.risks,
            })),
            timeoutMs,
            reasoningScale,
            memberOverrides,
            abort: ctx.abort,
          })
          for (const [memberId, score] of judged) judgeById.set(memberId, score)
          judgeStatus = "ok"
        } catch (error) {
          judgeStatus = "failed"
          judgeError = error instanceof Error ? error.message : String(error)
          log.warn("arena plan judge failed; falling back to self-assessed scores", {
            toolName: "arena",
            error: judgeError,
          })
        }
      }
      for (const candidate of candidates) {
        const score = judgeById.get(candidate.id)
        if (score) candidate.judgeScore = score.total
      }

      const ranked = Arena.rankArenaCandidates(candidates, strategy)
      const rankingMd = Arena.renderRankingMarkdown(ranked)

      const detail: string[] = ["", "## Approaches"]
      for (const c of ranked) {
        const p = proposalById.get(c.id)
        if (!p) continue
        detail.push("", `### ${c.rank}. ${c.id}`, "", p.approach, "", "**Steps:**")
        for (const step of p.steps) detail.push(`- ${step}`)
        if (p.risks.length) {
          detail.push("", "**Risks:**")
          for (const risk of p.risks) detail.push(`- ${risk}`)
        }
        detail.push("", `**Self-assessed implementation risk:** ${p.riskScore}/20`)
        const judged = judgeById.get(c.id)
        if (judged) {
          detail.push(
            `**Judge rubric (blinded):** ${judged.total}/40 — coverage ${judged.requirementCoverage}, ` +
              `feasibility ${judged.feasibility}, verification ${judged.verificationPlan}, risk evidence ${judged.riskEvidence}`,
          )
        }
      }
      if (errors.length) {
        detail.push("", "## Errors", ...errors.map((e) => `- ${e}`))
      }
      if (budgetCheck.reasons.length) {
        detail.push("", `_Budget: ${budgetCheck.reasons.join(", ")}_`)
      }
      detail.push(
        "",
        "_Plans are not execution-verified. Use mode=implement for worktree-isolated implement arena with verify-first ranking._",
      )

      const successfulCount = proposalById.size
      if (successfulCount >= 2) {
        void ModeMemory.recordArenaRanking({
          task: args.task,
          rankedIds: ranked.filter((r) => r.verification !== "fail").map((r) => r.id),
          failedIds,
        }).catch(() => undefined)
      }

      const metadata: ArenaMetadata = {
        status: successfulCount >= 2 ? "ok" : successfulCount === 0 ? "no_successful_candidate" : "incomplete",
        strategy,
        memberCount: members.length,
        rankedIds: ranked.map((r) => r.id),
        errorCount: errors.length,
        budgetReasons: budgetCheck.reasons,
        mode: "plan",
        providerCount: providerSnap.count,
        providerIDs: providerSnap.ids,
        enabledThisCall,
        suggestedTool,
        selectionErrors: resolution.rejected,
        judge: judgeStatus,
        ...(judgeError ? { judgeError } : {}),
      }

      const header =
        (enabledThisCall ? "_Enabled `modes.arena.enabled` for this project during this call._\n\n" : "") +
        (suggestedTool === "council"
          ? "_Note: this task looks like a quality/review finding request — **council** may fit better than plan arena._\n\n"
          : "")
      const judgeNote =
        judgeStatus === "ok"
          ? `_Rubric judge: ${members[0]!.memberId} — blinded candidates, randomized order; ranked by rubric total (0–40)._\n\n`
          : judgeStatus === "failed"
            ? `_Rubric judge unavailable (${judgeError ?? "unknown"}); ranking falls back to self-assessed scores._\n\n`
            : ""

      const successfulIds = [...proposalById.keys()]
      const statusBanner =
        successfulCount >= 2
          ? ""
          : [
              "## Result status",
              successfulCount === 0
                ? `**No successful candidates** — 0/${members.length} providers returned a valid proposal. Ranking is unavailable.`
                : `**Incomplete** — ${successfulCount}/${members.length} providers succeeded. Multi-model comparison is incomplete; do not treat this as consensus.`,
              successfulIds.length ? `Successful: ${successfulIds.join(", ")}` : "",
              failedIds.length
                ? `Failed: ${results
                    .filter((r) => r.error || !r.proposal)
                    .map((r) => `${r.member.memberId} (${Council.classifyMemberFailure(r.error ?? "no proposal")})`)
                    .join("; ")}`
                : "",
              "",
            ]
              .filter((line) => line !== "")
              .join("\n") + "\n\n"

      return {
        title:
          successfulCount >= 2
            ? `Arena ranked ${ranked.length} contestants`
            : successfulCount === 0
              ? "Arena produced no valid proposals"
              : `Arena incomplete (${successfulCount}/${members.length} proposals)`,
        output: header + judgeNote + statusBanner + rankingMd + detail.join("\n"),
        metadata,
      }
    },
  }
})
