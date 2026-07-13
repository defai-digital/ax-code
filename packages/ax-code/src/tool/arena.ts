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
import { EnsemblePreflight } from "../mode/preflight"
import { ModeMemory } from "../mode/memory"
import type { ModePolicy } from "../mode/policy"
import { Instance } from "../project/instance"
import { Provider } from "../provider/provider"
import { modelSelectableForProvider } from "../provider/model-selectability"
import { ModelID, ProviderID } from "../provider/schema"
import { Agent } from "../agent/agent"
import { Log } from "../util/log"
import { toErrorMessage } from "../util/error-message"
import { Tool } from "./tool"
import { runImplementArena } from "./arena-implement"
import DESCRIPTION from "./arena.txt"

const log = Log.create({ service: "tool.arena" })

const DEFAULT_MAX = 3
const HARD_MAX = 5
const DEFAULT_TIMEOUT_MS = 60_000

const ProposalSchema = z.object({
  approach: z.string().min(1).max(1200),
  steps: z.array(z.string().min(1).max(300)).max(12),
  risks: z.array(z.string().min(1).max(300)).max(8),
  confidence: z.number().min(0).max(1).optional(),
})

const parameters = z.object({
  task: z.string().min(1).describe("The coding task to compare approaches for"),
  context: z.string().optional().describe("Optional codebase or requirements context"),
  mode: z
    .enum(["plan", "implement"])
    .optional()
    .describe(
      "plan (default): multi-model approach comparison only. implement: worktree-isolated implement arena with verify-first ranking.",
    ),
  providers: z
    .array(
      z.object({
        providerID: z.string().min(1),
        modelID: z.string().optional(),
      }),
    )
    .max(HARD_MAX)
    .optional(),
  strategy: z.enum(["verify_first", "diversity", "hybrid_score"]).optional(),
  enableIfDisabled: z
    .boolean()
    .optional()
    .describe(
      "If arena is disabled in config, write modes.arena.enabled=true to project ax-code.json and continue (same session).",
    ),
})

type MemberSpec = { providerID: ProviderID; modelID: ModelID; memberId: string }

async function snapshotSelectableProviders(): Promise<EnsemblePreflight.ProviderSnapshot> {
  await Provider.ready()
  const providers = await Provider.list()
  const ids: string[] = []
  for (const provider of Object.values(providers)) {
    const models = Object.values(provider.models).filter((m) => modelSelectableForProvider(provider.id, m))
    if (models.length === 0) continue
    if (models.every((m) => String(m.id).toLowerCase().includes("embed"))) continue
    ids.push(String(provider.id))
  }
  return { count: ids.length, ids: ids.sort() }
}

function fingerprint(text: string): string {
  const normalized = text.toLowerCase().replace(/\s+/g, " ").trim().slice(0, 500)
  return createHash("sha256").update(normalized).digest("hex").slice(0, 16)
}

async function resolveMembers(
  cfg: Awaited<ReturnType<typeof Config.get>>,
  explicit: Array<{ providerID: string; modelID?: string }> | undefined,
  maxMembers: number,
): Promise<MemberSpec[]> {
  await Provider.ready()
  const providers = await Provider.list()

  if (explicit?.length) {
    const out: MemberSpec[] = []
    for (const item of explicit.slice(0, maxMembers)) {
      const providerID = ProviderID.make(item.providerID)
      const provider = providers[providerID]
      if (!provider) continue
      let modelID: ModelID | undefined
      if (item.modelID) modelID = ModelID.make(item.modelID)
      else {
        const sorted = Provider.sort(
          Object.values(provider.models).filter((m) => modelSelectableForProvider(providerID, m)),
        )
        modelID = sorted[0]?.id
      }
      if (!modelID) continue
      out.push({ providerID, modelID, memberId: `${providerID}/${modelID}` })
    }
    return out
  }

  let candidates: Array<{ providerID: string; modelID: ModelID }> = []
  for (const provider of Object.values(providers)) {
    const models = Provider.sort(
      Object.values(provider.models).filter((m) => modelSelectableForProvider(provider.id, m)),
    )
    const model = models[0]
    if (!model) continue
    if (String(model.id).toLowerCase().includes("embed")) continue
    candidates.push({ providerID: String(provider.id), modelID: model.id })
  }

  try {
    const store = await ModeMemory.load()
    const stats = ModeMemory.aggregateStats(store.outcomes, ModeMemory.classifyTask("implement"))
    candidates = ModeMemory.biasByMemory(
      candidates.map((c) => ({ ...c, modelID: String(c.modelID) })),
      stats,
    ).map((c) => ({ providerID: c.providerID, modelID: ModelID.make(String(c.modelID)) }))
  } catch {
    // best-effort
  }

  const diverse = Council.selectDiverseMembers(candidates, maxMembers)
  return diverse.map((c) => ({
    providerID: ProviderID.make(c.providerID),
    modelID: ModelID.make(String(c.modelID)),
    memberId: `${c.providerID}/${c.modelID}`,
  }))
}

async function runProposal(input: {
  member: MemberSpec
  task: string
  context?: string
  timeoutMs: number
  abort: AbortSignal
}): Promise<{
  member: MemberSpec
  proposal?: z.infer<typeof ProposalSchema>
  error?: string
}> {
  const localAbort = new AbortController()
  const onParent = () => localAbort.abort()
  input.abort.addEventListener("abort", onParent)
  const timer = setTimeout(() => localAbort.abort(), input.timeoutMs)
  const started = Date.now()
  try {
    const model = await Provider.getModel(input.member.providerID, input.member.modelID)
    const language = await Provider.getLanguage(model)
    const proposal = await generateObject({
      model: language,
      schema: ProposalSchema,
      abortSignal: localAbort.signal,
      temperature: 0.3,
      messages: [
        {
          role: "system",
          content: `You are one independent contestant in a coding-agent arena.
Propose a concrete implementation approach for the task. Do not write full source files.
Focus on approach, ordered steps, and risks. Be specific to the context.`,
        },
        {
          role: "user",
          content: [
            `Task: ${input.task}`,
            input.context ? `\nContext:\n${input.context.slice(0, 20_000)}` : "",
          ]
            .filter(Boolean)
            .join("\n"),
        },
      ],
    }).then((r) => r.object)

    log.info("arena proposal ok", {
      toolName: "arena",
      memberId: input.member.memberId,
      durationMs: Date.now() - started,
      status: "ok",
    })
    return { member: input.member, proposal }
  } catch (err) {
    log.warn("arena proposal failed", {
      toolName: "arena",
      memberId: input.member.memberId,
      durationMs: Date.now() - started,
      status: localAbort.signal.aborted ? "timeout" : "error",
      errorCode: err instanceof Error ? err.name : "Unknown",
    })
    return { member: input.member, error: toErrorMessage(err) }
  } finally {
    clearTimeout(timer)
    input.abort.removeEventListener("abort", onParent)
  }
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
      const providerSnap = await snapshotSelectableProviders()
      const suggestedTool = EnsemblePreflight.suggestTool(args.task)

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
          mode: args.mode ?? "plan",
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

      const arenaMode = args.mode ?? "plan"
      const strategy =
        args.strategy ?? modes.arena?.strategy ?? (arenaMode === "implement" ? "verify_first" : "diversity")
      const timeoutMs = modes.council?.timeoutMs ?? DEFAULT_TIMEOUT_MS
      const maxContestants = Math.min(HARD_MAX, Math.max(1, modes.arena?.maxContestants ?? DEFAULT_MAX))

      const budgetCheck = Budget.check({
        kind: "arena",
        requestedMembers: args.providers?.length ?? maxContestants,
        budget: {
          maxMembers: modes.council?.maxMembers ?? 3,
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

      let members = await resolveMembers(cfg, args.providers, budgetCheck.allowedMembers)
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
        }
        return {
          title: "Arena: need ≥2 providers",
          output: EnsemblePreflight.arenaInsufficientProvidersMessage(providerSnap),
          metadata,
        }
      }

      // --- Implement arena (worktree-isolated writers + verify) ---
      if (arenaMode === "implement") {
        const agentName = await Agent.defaultAgent().catch(() => "build")
        const impl = await runImplementArena({
          members,
          task: args.task,
          context: args.context,
          parentSessionID: ctx.sessionID,
          parentMessageID: ctx.messageID,
          agentName,
          strategy,
          abort: ctx.abort,
        })

        const failedIds = impl.results.filter((r) => r.verification === "fail" || r.error).map((r) => r.id)
        void ModeMemory.recordArenaRanking({
          task: args.task,
          rankedIds: impl.ranked.filter((r) => r.verification !== "fail").map((r) => r.id),
          failedIds,
        }).catch(() => undefined)

        const metadata: ArenaMetadata = {
          status: "ok",
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
        }

        return {
          title: `Implement arena ranked ${impl.ranked.length} contestants`,
          output:
            impl.markdown +
            (enabledThisCall ? "\n\n_Enabled `modes.arena.enabled` for this project during this call._" : "") +
            (budgetCheck.reasons.length ? `\n\n_Budget: ${budgetCheck.reasons.join(", ")}_` : ""),
          metadata,
        }
      }

      // --- Plan arena (approach comparison only) ---
      const results = await Promise.all(
        members.map((member) =>
          runProposal({
            member,
            task: args.task,
            context: args.context,
            timeoutMs,
            abort: ctx.abort,
          }),
        ),
      )

      const candidates: Arena.ArenaCandidate[] = []
      const proposalById = new Map<string, z.infer<typeof ProposalSchema>>()
      const errors: string[] = []
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
        const risk = Math.min(20, (r.proposal.risks?.length ?? 0) * 3)
        candidates.push({
          id: r.member.memberId,
          providerID: String(r.member.providerID),
          modelID: String(r.member.modelID),
          verification: "unknown",
          riskScore: risk,
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

      void ModeMemory.recordArenaRanking({
        task: args.task,
        rankedIds: ranked.filter((r) => r.verification !== "fail").map((r) => r.id),
        failedIds,
      }).catch(() => undefined)

      const metadata: ArenaMetadata = {
        status: "ok",
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
      }

      const header =
        (enabledThisCall ? "_Enabled `modes.arena.enabled` for this project during this call._\n\n" : "") +
        (suggestedTool === "council"
          ? "_Note: this task looks like a quality/review finding request — **council** may fit better than plan arena._\n\n"
          : "")

      return {
        title: `Arena ranked ${ranked.length} contestants`,
        output: header + rankingMd + detail.join("\n"),
        metadata,
      }
    },
  }
})
