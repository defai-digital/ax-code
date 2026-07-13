/**
 * Multi-provider council tool (ADR-049 Phase 1 + Phase 3 debate/budget/memory).
 * Fans out structured reviews; aggregates via pure Council module.
 */

import { generateObject } from "ai"
import z from "zod"
import { Config } from "../config/config"
import { Budget } from "../mode/budget"
import { Council } from "../mode/council"
import { Debate } from "../mode/debate"
import { EnsemblePreflight } from "../mode/preflight"
import { ModeMemory } from "../mode/memory"
import { ModePolicy } from "../mode/policy"
import { Provider } from "../provider/provider"
import { modelSelectableForProvider } from "../provider/model-selectability"
import { ModelID, ProviderID } from "../provider/schema"
import { Log } from "../util/log"
import { toErrorMessage } from "../util/error-message"
import { Tool } from "./tool"
import DESCRIPTION from "./council.txt"

const log = Log.create({ service: "tool.council" })

const DEFAULT_MAX_MEMBERS = 3
const DEFAULT_TIMEOUT_MS = 60_000
const HARD_MAX_MEMBERS = 6

const IssueSchema = z.object({
  severity: z.enum(["high", "medium", "low"]),
  category: z.string().min(1).max(64),
  location: z.string().max(200).optional(),
  summary: z.string().min(1).max(400),
  suggestedFix: z.string().max(600).optional(),
})

const MemberOutputSchema = z.object({
  overall: z.string().min(1).max(800),
  issues: z.array(IssueSchema).max(20),
})

const MemberSelectionSchema = z.object({
  providerID: z.string().min(1).max(200),
  modelID: z.string().min(1).max(300).optional(),
})

function uniqueMemberSelections(selections: Array<z.infer<typeof MemberSelectionSchema>>, ctx: z.RefinementCtx): void {
  const seen = new Set<string>()
  const seenProviders = new Set<string>()
  selections.forEach((selection, index) => {
    const key = `${selection.providerID}\u0000${selection.modelID ?? ""}`
    if (seen.has(key)) {
      ctx.addIssue({
        code: "custom",
        message: "Duplicate provider/model selection",
        path: [index],
      })
    }
    seen.add(key)
    if (seenProviders.has(selection.providerID)) {
      ctx.addIssue({
        code: "custom",
        message: "Council members must use distinct providers",
        path: [index, "providerID"],
      })
    }
    seenProviders.add(selection.providerID)
  })
}

const parameters = z.object({
  question: z.string().min(1).describe("The review or design question for the council"),
  context: z.string().optional().describe("Optional code, diff, or design context to include for every member"),
  kind: z.enum(["review", "design"]).optional().describe("review (default) or design trade-off"),
  debateRounds: z
    .number()
    .int()
    .min(0)
    .max(3)
    .optional()
    .describe("Optional anonymous debate rounds after the first fan-out (default from config, usually 0)"),
  providers: z
    .array(MemberSelectionSchema)
    .min(1)
    .max(HARD_MAX_MEMBERS)
    .superRefine(uniqueMemberSelections)
    .optional()
    .describe("Optional explicit provider/model members; otherwise auto-select diverse connected providers"),
})

type MemberSpec = { providerID: ProviderID; modelID: ModelID; memberId: string }
type MemberResolution = { members: MemberSpec[]; rejected: string[] }

function systemPrompt(kind: "review" | "design"): string {
  if (kind === "design") {
    return `You are one independent member of an engineering design council.
Evaluate the question and context. Return structured issues covering trade-offs, risks, and recommendations.
Be concrete. Prefer fewer high-signal issues. Do not claim other models' opinions.`
  }
  return `You are one independent member of a multi-LLM code review council.
Review the provided context for correctness, security, architecture, and maintainability.
Return structured issues with severity, category, optional location (file:line), summary, and suggested fix.
Be concrete. Prefer fewer high-signal issues. Do not claim other models' opinions.`
}

async function resolveMembers(
  explicit: Array<{ providerID: string; modelID?: string }> | undefined,
  maxMembers: number,
  task: string,
): Promise<MemberResolution> {
  await Provider.ready()
  const providers = await Provider.list()

  if (explicit?.length) {
    const out: MemberSpec[] = []
    const rejected: string[] = []
    for (const item of explicit) {
      const providerID = ProviderID.make(item.providerID)
      const provider = providers[providerID]
      if (!provider) {
        rejected.push(`Unknown provider ${JSON.stringify(item.providerID)}`)
        continue
      }
      let modelID: ModelID | undefined
      if (item.modelID) {
        const model = Object.values(provider.models).find(
          (candidate) =>
            String(candidate.id) === item.modelID &&
            modelSelectableForProvider(providerID, candidate) &&
            !String(candidate.id).toLowerCase().includes("embed"),
        )
        modelID = model?.id
        if (!modelID) {
          rejected.push(`Unknown or unselectable model ${JSON.stringify(`${item.providerID}/${item.modelID}`)}`)
        }
      } else {
        const sorted = Provider.sort(
          Object.values(provider.models).filter(
            (model) =>
              modelSelectableForProvider(providerID, model) && !String(model.id).toLowerCase().includes("embed"),
          ),
        )
        modelID = sorted[0]?.id
      }
      if (!modelID) {
        if (!item.modelID) rejected.push(`No selectable coding model for ${JSON.stringify(item.providerID)}`)
        continue
      }
      out.push({
        providerID,
        modelID,
        memberId: `${providerID}/${modelID}`,
      })
    }
    return { members: Council.dedupeMembers(out).slice(0, maxMembers), rejected }
  }

  type Cand = { providerID: string; modelID: ModelID }
  let candidates: Cand[] = []
  for (const provider of Object.values(providers)) {
    const models = Provider.sort(
      Object.values(provider.models).filter(
        (model) => modelSelectableForProvider(provider.id, model) && !String(model.id).toLowerCase().includes("embed"),
      ),
    )
    const model = models[0]
    if (!model) continue
    candidates.push({ providerID: String(provider.id), modelID: model.id })
  }

  // Soft bias by historical performance, then diversify families
  try {
    const store = await ModeMemory.load()
    const stats = ModeMemory.aggregateStats(store.outcomes, ModeMemory.classifyTask(task))
    candidates = ModeMemory.biasByMemory(
      candidates.map((c) => ({ ...c, modelID: String(c.modelID) })),
      stats,
    ).map((c) => ({ providerID: c.providerID, modelID: ModelID.make(String(c.modelID)) }))
  } catch {
    // memory is best-effort
  }

  const diverse = Council.selectDiverseMembers(candidates, maxMembers)

  return {
    members: diverse.map((c) => ({
      providerID: ProviderID.make(c.providerID),
      modelID: ModelID.make(String(c.modelID)),
      memberId: `${c.providerID}/${c.modelID}`,
    })),
    rejected: [],
  }
}

async function runMember(input: {
  member: MemberSpec
  kind: "review" | "design"
  question: string
  context?: string
  debateContext?: string
  timeoutMs: number
  abort: AbortSignal
}): Promise<Council.CouncilMemberResult> {
  const { member, kind, question, context, debateContext, timeoutMs, abort } = input
  const started = Date.now()
  const localAbort = new AbortController()
  const onParentAbort = () => localAbort.abort(abort.reason)
  if (abort.aborted) onParentAbort()
  else abort.addEventListener("abort", onParentAbort, { once: true })
  const timer = setTimeout(() => localAbort.abort(), timeoutMs)
  timer.unref?.()

  try {
    const model = await Provider.getModel(member.providerID, member.modelID)
    const language = await Provider.getLanguage(model)
    const userParts = [
      `Kind: ${kind}`,
      `Question: ${question}`,
      context ? `\nContext:\n${context.slice(0, 24_000)}` : "",
      debateContext ? `\n${debateContext}` : "",
    ]
      .filter(Boolean)
      .join("\n")

    const raw = await generateObject({
      model: language,
      schema: MemberOutputSchema,
      abortSignal: localAbort.signal,
      temperature: 0.2,
      messages: [
        { role: "system", content: systemPrompt(kind) },
        { role: "user", content: userParts },
      ],
    }).then((r) => r.object)

    log.info("council member ok", {
      toolName: "council",
      memberId: member.memberId,
      durationMs: Date.now() - started,
      status: "ok",
      issueCount: raw.issues.length,
    })

    return {
      memberId: member.memberId,
      providerID: String(member.providerID),
      modelID: String(member.modelID),
      overall: raw.overall,
      issues: raw.issues.map((issue) => ({
        memberId: member.memberId,
        severity: issue.severity,
        category: issue.category,
        location: issue.location,
        summary: issue.summary,
        suggestedFix: issue.suggestedFix,
      })),
    }
  } catch (err) {
    const aborted = localAbort.signal.aborted
    const message = aborted ? `timeout or aborted: ${toErrorMessage(err)}` : toErrorMessage(err)
    log.warn("council member failed", {
      toolName: "council",
      memberId: member.memberId,
      durationMs: Date.now() - started,
      status: aborted ? "timeout" : "error",
      errorCode: err instanceof Error ? err.name : "Unknown",
    })
    return {
      memberId: member.memberId,
      providerID: String(member.providerID),
      modelID: String(member.modelID),
      issues: [],
      error: message,
    }
  } finally {
    clearTimeout(timer)
    abort.removeEventListener("abort", onParentAbort)
  }
}

type CouncilMetadata = {
  status: string
  totalMembers?: number
  successfulMembers?: number
  failedMembers?: number
  consensusCount?: number
  majorityCount?: number
  minorityCount?: number
  singletonCount?: number
  memberIds?: string[]
  debateRoundsRun?: number
  debateStopReason?: string
  budgetReasons?: string[]
  providerCount?: number
  providerIDs?: string[]
  selectionErrors?: string[]
}

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

export const CouncilTool = Tool.define("council", async () => {
  return {
    description: DESCRIPTION,
    parameters,
    async execute(args, ctx) {
      await ctx.ask({
        permission: "council",
        patterns: ["*"],
        always: ["*"],
        metadata: {
          question: args.question.slice(0, 200),
          kind: args.kind ?? "review",
        },
      })

      // Re-read project config so mid-session ax-code.json edits apply.
      const cfg = await Config.getFresh()
      const modes = (cfg as { modes?: ModePolicy.ModesConfig }).modes
      const providerSnap = await snapshotSelectableProviders()
      if (modes?.council?.enabled === false) {
        const metadata: CouncilMetadata = {
          status: "disabled",
          providerCount: providerSnap.count,
          providerIDs: providerSnap.ids,
        }
        return {
          title: "Council disabled",
          output: EnsemblePreflight.councilDisabledMessage(),
          metadata,
        }
      }

      const timeoutMs = modes?.council?.timeoutMs ?? DEFAULT_TIMEOUT_MS
      const kind = args.kind ?? "review"
      const maxMembers = Math.min(HARD_MAX_MEMBERS, Math.max(1, modes?.council?.maxMembers ?? DEFAULT_MAX_MEMBERS))
      const maxRounds = Debate.resolveMaxRounds(args.debateRounds ?? modes?.council?.debateRounds)

      const budgetCheck = Budget.check({
        kind: "council",
        requestedMembers: args.providers?.length ?? maxMembers,
        callsPerMember: maxRounds + 1,
        budget: {
          maxMembers,
          maxContestants: modes?.arena?.maxContestants ?? 3,
          timeoutMs,
          maxEstimatedUsd: modes?.budget?.maxEstimatedUsd,
          estimatedUsdPerMember: modes?.budget?.estimatedUsdPerMember,
        },
      })
      if (!budgetCheck.ok) {
        const metadata: CouncilMetadata = { status: "budget_rejected" }
        return {
          title: "Council budget rejected",
          output: budgetCheck.message,
          metadata,
        }
      }

      const resolution = await resolveMembers(args.providers, budgetCheck.allowedMembers, args.question)
      let members = resolution.members
      if (members.length > budgetCheck.allowedMembers) {
        members = members.slice(0, budgetCheck.allowedMembers)
      }

      if (members.length === 0) {
        const metadata: CouncilMetadata = {
          status: "no_members",
          totalMembers: 0,
          successfulMembers: 0,
          providerCount: providerSnap.count,
          providerIDs: providerSnap.ids,
          selectionErrors: resolution.rejected,
        }
        return {
          title: "Council: no members",
          output:
            EnsemblePreflight.councilInsufficientProvidersMessage(providerSnap) +
            (resolution.rejected.length
              ? `\n\nRequested selections skipped:\n${resolution.rejected.map((error) => `- ${error}`).join("\n")}`
              : ""),
          metadata,
        }
      }

      let results = await Promise.all(
        members.map((member) =>
          runMember({
            member,
            kind,
            question: args.question,
            context: args.context,
            timeoutMs,
            abort: ctx.abort,
          }),
        ),
      )
      ctx.abort.throwIfAborted()

      let report = Council.aggregateCouncil(results)
      let debateRoundsRun = 0
      let debateStopReason = maxRounds > 0 ? "not_started" : "debate_disabled"
      const debateNotes: string[] = []

      for (let round = 1; round <= maxRounds; round++) {
        const decision = Debate.shouldContinueDebate({
          round: round - 1,
          maxRounds,
          report,
        })
        if (!decision.continue) {
          debateStopReason = decision.reason
          break
        }

        const summary = Debate.buildAnonymousSynthesis(report, round)
        const synthesis = Debate.renderSynthesisPrompt(summary)
        debateNotes.push(`### Debate round ${round}`, "", synthesis, "")

        results = await Promise.all(
          members.map((member) =>
            runMember({
              member,
              kind,
              question: args.question,
              context: args.context,
              debateContext: synthesis,
              timeoutMs,
              abort: ctx.abort,
            }),
          ),
        )
        ctx.abort.throwIfAborted()
        report = Council.aggregateCouncil(results)
        debateRoundsRun = round
        const postRound = Debate.shouldContinueDebate({ round, maxRounds, report })
        debateStopReason = postRound.reason
        if (!postRound.continue) break
      }

      const markdown = Council.renderReportMarkdown(report, args.question)
      const overallLines = results.filter((r) => !r.error && r.overall).map((r) => `- **${r.memberId}:** ${r.overall}`)

      const parts = [markdown]
      if (resolution.rejected.length) {
        parts.push("", "## Skipped member selections", ...resolution.rejected.map((error) => `- ${error}`))
      }
      if (overallLines.length) {
        parts.push("", "## Member overall assessments", ...overallLines)
      }
      if (debateRoundsRun > 0) {
        parts.push("", `## Debate (${debateRoundsRun} round(s), stop: ${debateStopReason})`, ...debateNotes)
      }
      if (budgetCheck.reasons.length) {
        parts.push("", `_Budget: ${budgetCheck.reasons.join(", ")}_`)
      }

      void ModeMemory.recordCouncilParticipation({
        question: args.question,
        memberIds: results.map((r) => r.memberId),
        successfulIds: results.filter((r) => !r.error).map((r) => r.memberId),
      }).catch(() => undefined)

      const metadata: CouncilMetadata = {
        status: report.incomplete ? "incomplete" : "ok",
        totalMembers: report.totalMembers,
        successfulMembers: report.successfulMembers,
        failedMembers: report.failedMembers,
        consensusCount: report.consensus.length,
        majorityCount: report.majority.length,
        minorityCount: report.minority.length,
        singletonCount: report.singleton.length,
        memberIds: results.map((r) => r.memberId),
        debateRoundsRun,
        debateStopReason,
        budgetReasons: budgetCheck.reasons,
        selectionErrors: resolution.rejected,
      }

      return {
        title: report.incomplete
          ? `Council incomplete (${report.successfulMembers}/${report.totalMembers})`
          : `Council ${report.consensus.length}c/${report.majority.length}m/${report.minority.length}mi/${report.singleton.length}s` +
            (debateRoundsRun ? ` d${debateRoundsRun}` : ""),
        output: parts.join("\n"),
        metadata,
      }
    },
  }
})
