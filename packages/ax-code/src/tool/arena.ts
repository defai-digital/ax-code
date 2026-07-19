/**
 * Arena plan-comparison tool (ADR-049 Phase 2 scaffold).
 * Fan-out structured approaches; rank with pure Arena scorer.
 * Does not write files — advisory best-of-N for plans.
 */

import { generateObject } from "ai"
import { createHash } from "crypto"
import z from "zod"
import path from "path"
import { Config } from "../config/config"
import { Arena } from "../mode/arena"
import { Budget } from "../mode/budget"
import { Council } from "../mode/council"
import { EnsembleShared } from "../mode/ensemble-shared"
import { ensureJsonModeInstruction } from "../mode/json-mode-prompt"
import { EnsemblePreflight } from "../mode/preflight"
import { ModeMemory } from "../mode/memory"
import type { ModePolicy } from "../mode/policy"
import { Instance } from "../project/instance"
import { Provider } from "../provider/provider"
import { Agent } from "../agent/agent"
import { Log } from "../util/log"
import { FanOut } from "../util/fan-out"
import { Tool } from "./tool"
import { inspectImplementArenaBase, runImplementArena } from "./arena-implement"
import DESCRIPTION from "./arena.txt"

const log = Log.create({ service: "tool.arena" })

const DEFAULT_MAX = 3
const HARD_MAX = 5
const DEFAULT_TIMEOUT_MS = 60_000

const ProposalSchema = z.object({
  approach: z.string().min(1).max(1200),
  steps: z.array(z.string().min(1).max(300)).min(1).max(12),
  risks: z.array(z.string().min(1).max(300)).max(8),
  riskScore: z.number().int().min(0).max(20),
  confidence: z.number().min(0).max(1).optional(),
})

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
  if (new Set(selections.map((s) => s.providerID)).size < 2) {
    ctx.addIssue({ code: "custom", message: "Arena requires at least two distinct providers", path: [] })
  }
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
  abort: AbortSignal
  retryOnce?: boolean
}): Promise<{
  member: EnsembleShared.MemberSpec
  proposal?: z.infer<typeof ProposalSchema>
  error?: string
}> {
  const started = Date.now()
  const retryOnce = input.retryOnce ?? true

  const attemptProposal = async (): Promise<FanOut.MemberResult<z.infer<typeof ProposalSchema>>> => {
    const [result] = await FanOut.run({
      members: [input.member],
      timeoutMs: input.timeoutMs,
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
        const model = await Provider.getModel(input.member.providerID, input.member.modelID)
        const language = await Provider.getLanguage(model)
        return generateObject({
          model: language,
          schema: ProposalSchema,
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
Give an overall riskScore from 0 (low implementation risk) to 20 (high). Do not lower it by omitting risks.`),
            },
            {
              role: "user",
              content: [`Task: ${input.task}`, input.context ? `\nContext:\n${input.context.slice(0, 20_000)}` : ""]
                .filter(Boolean)
                .join("\n"),
            },
          ],
        }).then((r) => r.object)
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
    return { member: input.member, proposal: first.result }
  }

  const wasAborted = (first.error ?? "").startsWith("aborted:") || input.abort.aborted
  log.warn("arena proposal failed", {
    toolName: "arena",
    memberId: input.member.memberId,
    durationMs: Date.now() - started,
    status: wasAborted ? "timeout" : "error",
  })

  // Retry once on non-abort, non-timeout failure
  if (retryOnce && !wasAborted) {
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
      return { member: input.member, proposal: retry.result }
    }
    log.warn("arena proposal retry failed", {
      toolName: "arena",
      memberId: input.member.memberId,
      durationMs: Date.now() - retryStarted,
      status: (retry.error ?? "").startsWith("aborted:") || input.abort.aborted ? "timeout" : "error",
    })
    return { member: input.member, error: retry.error ?? "unknown" }
  }

  return { member: input.member, error: first.error ?? "unknown" }
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
}

export const ArenaTool = Tool.define("arena", async () => {
  return {
    description: DESCRIPTION,
    parameters,
    async execute(args, ctx) {
      await ctx.ask({
        permission: "arena",
        patterns: ["*"],
        always: ["*"],
        metadata: { task: args.task.slice(0, 200), mode: args.mode ?? "plan" },
      })

      // Re-read project config so mid-session ax-code.json edits apply (no restart).
      let cfg = await Config.getFresh()
      let modes = (cfg as { modes?: ModePolicy.ModesConfig }).modes
      let enabledThisCall = false
      const providerSnap = await EnsembleShared.snapshotSelectableProviders()
      const suggestedTool = EnsemblePreflight.suggestTool(args.task)
      const arenaMode = args.mode ?? "plan"
      let baseCommit: string | undefined

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

      if (modes?.arena?.enabled !== true) {
        if (args.enableIfDisabled === true) {
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
      }

      if (modes?.arena?.enabled !== true) {
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
            projectConfigHint: path.join(Instance.directory, "ax-code.json"),
          }),
          metadata,
        }
      }

      const strategy =
        args.strategy ?? modes.arena?.strategy ?? (arenaMode === "implement" ? "verify_first" : "diversity")
      const timeoutMs = modes.arena?.timeoutMs ?? modes.council?.timeoutMs ?? DEFAULT_TIMEOUT_MS
      const maxContestants = Math.min(HARD_MAX, Math.max(1, modes.arena?.maxContestants ?? DEFAULT_MAX))

      const budgetCheck = Budget.check({
        kind: "arena",
        requestedMembers: args.providers?.length ?? maxContestants,
        budget: {
          maxMembers: modes.arena?.maxContestants ?? 3,
          maxContestants,
          timeoutMs,
          maxEstimatedUsd: modes.budget?.maxEstimatedUsd,
          estimatedUsdPerMember: modes.budget?.estimatedUsdPerMember,
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
        { minMembers: 2, maxMembers: budgetCheck.allowedMembers, requireDistinctProviders: false },
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
          title: "Arena: need ≥2 providers",
          output:
            EnsemblePreflight.arenaInsufficientProvidersMessage(providerSnap) +
            (resolution.rejected.length
              ? `\n\nRequested selections skipped:\n${resolution.rejected.map((error) => `- ${error}`).join("\n")}`
              : ""),
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
      }

      const header =
        (enabledThisCall ? "_Enabled `modes.arena.enabled` for this project during this call._\n\n" : "") +
        (suggestedTool === "council"
          ? "_Note: this task looks like a quality/review finding request — **council** may fit better than plan arena._\n\n"
          : "")

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
        output: header + statusBanner + rankingMd + detail.join("\n"),
        metadata,
      }
    },
  }
})
