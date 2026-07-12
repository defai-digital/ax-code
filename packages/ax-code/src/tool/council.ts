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

const parameters = z.object({
  question: z.string().min(1).describe("The review or design question for the council"),
  context: z
    .string()
    .optional()
    .describe("Optional code, diff, or design context to include for every member"),
  kind: z.enum(["review", "design"]).optional().describe("review (default) or design trade-off"),
  debateRounds: z
    .number()
    .int()
    .min(0)
    .max(3)
    .optional()
    .describe("Optional anonymous debate rounds after the first fan-out (default from config, usually 0)"),
  providers: z
    .array(
      z.object({
        providerID: z.string().min(1),
        modelID: z.string().optional(),
      }),
    )
    .max(HARD_MAX_MEMBERS)
    .optional()
    .describe("Optional explicit provider/model members; otherwise auto-select diverse connected providers"),
})

type MemberSpec = { providerID: ProviderID; modelID: ModelID; memberId: string }

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
      if (item.modelID) {
        modelID = ModelID.make(item.modelID)
      } else {
        const sorted = Provider.sort(
          Object.values(provider.models).filter((m) => modelSelectableForProvider(providerID, m)),
        )
        modelID = sorted[0]?.id
      }
      if (!modelID) continue
      out.push({
        providerID,
        modelID,
        memberId: `${providerID}/${modelID}`,
      })
    }
    return out
  }

  type Cand = { providerID: string; modelID: ModelID }
  let candidates: Cand[] = []
  for (const provider of Object.values(providers)) {
    const models = Provider.sort(
      Object.values(provider.models).filter((m) => modelSelectableForProvider(provider.id, m)),
    )
    const model = models[0]
    if (!model) continue
    const id = String(model.id).toLowerCase()
    if (id.includes("embed")) continue
    candidates.push({ providerID: String(provider.id), modelID: model.id })
  }

  // Soft bias by historical performance, then diversify families
  try {
    const store = await ModeMemory.load()
    const stats = ModeMemory.aggregateStats(store.outcomes)
    candidates = ModeMemory.biasByMemory(
      candidates.map((c) => ({ ...c, modelID: String(c.modelID) })),
      stats,
    ).map((c) => ({ providerID: c.providerID, modelID: ModelID.make(String(c.modelID)) }))
  } catch {
    // memory is best-effort
  }

  const diverse = Council.selectDiverseMembers(candidates, maxMembers)

  return diverse.map((c) => ({
    providerID: ProviderID.make(c.providerID),
    modelID: ModelID.make(String(c.modelID)),
    memberId: `${c.providerID}/${c.modelID}`,
  }))
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
  const onParentAbort = () => localAbort.abort()
  abort.addEventListener("abort", onParentAbort)
  const timer = setTimeout(() => localAbort.abort(), timeoutMs)

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
  singletonCount?: number
  memberIds?: string[]
  debateRoundsRun?: number
  debateStopReason?: string
  budgetReasons?: string[]
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

      const cfg = await Config.get()
      const modes = (cfg as { modes?: ModePolicy.ModesConfig }).modes
      if (modes?.council?.enabled === false) {
        const metadata: CouncilMetadata = { status: "disabled" }
        return {
          title: "Council disabled",
          output: "Council mode is disabled in config (`modes.council.enabled: false`).",
          metadata,
        }
      }

      const timeoutMs = modes?.council?.timeoutMs ?? DEFAULT_TIMEOUT_MS
      const kind = args.kind ?? "review"
      const maxMembers = Math.min(
        HARD_MAX_MEMBERS,
        Math.max(1, modes?.council?.maxMembers ?? DEFAULT_MAX_MEMBERS),
      )
      const maxRounds = args.debateRounds ?? modes?.council?.debateRounds ?? 0

      const budgetCheck = Budget.check({
        kind: "council",
        requestedMembers: args.providers?.length ?? maxMembers,
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

      let members = await resolveMembers(cfg, args.providers, budgetCheck.allowedMembers)
      if (members.length > budgetCheck.allowedMembers) {
        members = members.slice(0, budgetCheck.allowedMembers)
      }

      if (members.length === 0) {
        const metadata: CouncilMetadata = { status: "no_members", totalMembers: 0, successfulMembers: 0 }
        return {
          title: "Council: no members",
          output:
            "No connected providers with selectable models were found for the council. Connect at least two providers via /connect or providers login.",
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
        if (!decision.continue && round > 1) {
          debateStopReason = decision.reason
          break
        }
        if (round === 1 && !decision.continue && decision.reason !== "continue:agreement=0.00") {
          // Still allow first debate round if incomplete or disabled handled above
          if (decision.reason === "incomplete_members" || decision.reason === "debate_disabled") {
            debateStopReason = decision.reason
            break
          }
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
        report = Council.aggregateCouncil(results)
        debateRoundsRun = round
        debateStopReason = Debate.shouldContinueDebate({ round, maxRounds, report }).reason
        if (!Debate.shouldContinueDebate({ round, maxRounds, report }).continue) break
      }

      const markdown = Council.renderReportMarkdown(report, args.question)
      const overallLines = results
        .filter((r) => !r.error && r.overall)
        .map((r) => `- **${r.memberId}:** ${r.overall}`)

      const parts = [markdown]
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
        singletonCount: report.singleton.length,
        memberIds: results.map((r) => r.memberId),
        debateRoundsRun,
        debateStopReason,
        budgetReasons: budgetCheck.reasons,
      }

      return {
        title: report.incomplete
          ? `Council incomplete (${report.successfulMembers}/${report.totalMembers})`
          : `Council ${report.consensus.length}c/${report.majority.length}m/${report.singleton.length}s` +
            (debateRoundsRun ? ` d${debateRoundsRun}` : ""),
        output: parts.join("\n"),
        metadata,
      }
    },
  }
})
