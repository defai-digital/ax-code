/**
 * Multi-provider council tool (ADR-049 Phase 1 + Phase 3 debate/budget/memory).
 * Fans out structured reviews; aggregates via pure Council module.
 */

import { generateObject, generateText } from "ai"
import z from "zod"
import { Config } from "../config/config"
import { Budget } from "../mode/budget"
import { Council } from "../mode/council"
import { Debate } from "../mode/debate"
import { EnsembleShared } from "../mode/ensemble-shared"
import { ensureJsonModeInstruction } from "../mode/json-mode-prompt"
import { EnsemblePreflight } from "../mode/preflight"
import { ModeMemory } from "../mode/memory"
import { ModePolicy } from "../mode/policy"
import { Provider } from "../provider/provider"
import { Log } from "../util/log"
import { parseJsonResult } from "../util/json-value"
import { FanOut } from "../util/fan-out"
import { Tool } from "./tool"
import DESCRIPTION from "./council.txt"

const log = Log.create({ service: "tool.council" })

const DEFAULT_MAX_MEMBERS = 3
// Reasoning members (deepseek-v4-class, o-series, etc.) routinely need minutes
// to emit a structured review; 60s made slow-but-healthy members fail. 180s
// mirrors the generous per-chunk provider timeout used for extended thinking.
// Exported for tests.
export const DEFAULT_TIMEOUT_MS = 180_000
// Reasoning members get this multiple of the configured timeout — thinking
// before the structured answer is exactly what the base budget underestimates.
const REASONING_TIMEOUT_SCALE = 2
const HARD_MAX_MEMBERS = 6

// Length/count caps are enforced by clamping after parse (see clampMemberOutput),
// not by hard zod .max() constraints: verbose members (observed with DeepSeek)
// otherwise fail the whole fan-out with "response did not match schema" just for
// writing a long sentence. Severity is normalized so common off-enum spellings
// ("critical", "info") don't reject an otherwise valid review.
const IssueSeveritySchema = z.preprocess(
  (value) => {
    if (typeof value !== "string") return value
    const lower = value.toLowerCase().trim()
    if (["critical", "blocker", "severe", "major"].includes(lower)) return "high"
    if (["info", "informational", "minor", "nit", "trivial"].includes(lower)) return "low"
    return ["high", "medium", "low"].includes(lower) ? lower : "medium"
  },
  z.enum(["high", "medium", "low"]),
)

const IssueSchema = z.object({
  severity: IssueSeveritySchema,
  category: z.string().min(1).describe("Short category label, at most 64 chars"),
  location: z.string().optional().describe("Optional file:line, at most 200 chars"),
  summary: z.string().min(1).describe("One-sentence summary, at most 400 chars"),
  suggestedFix: z.string().optional().describe("Optional fix sketch, at most 600 chars"),
})

const MemberOutputSchema = z.object({
  overall: z.string().min(1).describe("Overall assessment, at most 800 chars"),
  issues: z.array(IssueSchema).describe("At most 20 issues; prefer fewer, high-signal"),
})

const MAX_ISSUES = 20

function clampText(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max - 1)}…` : value
}

function clampOptionalText(value: string | undefined, max: number): string | undefined {
  if (value === undefined) return undefined
  const trimmed = value.trim()
  if (!trimmed) return undefined
  return clampText(trimmed, max)
}

// Kept local to avoid circular-dependency at module-load time (identical to arena.ts).
const MemberSelectionSchema = z.object({
  providerID: z.string().min(1).max(200),
  modelID: z.string().min(1).max(300).optional(),
})

function validateMemberSelections(
  selections: Array<z.infer<typeof MemberSelectionSchema>>,
  ctx: z.RefinementCtx,
): void {
  const seen = new Set<string>()
  const seenProviders = new Set<string>()
  selections.forEach((selection, index) => {
    const key = `${selection.providerID}\u0000${selection.modelID ?? ""}`
    if (seen.has(key)) {
      ctx.addIssue({ code: "custom", message: "Duplicate provider/model selection", path: [index] })
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
    .superRefine(validateMemberSelections)
    .optional()
    .describe("Optional explicit provider/model members; otherwise auto-select diverse connected providers"),
})

function systemPrompt(kind: "review" | "design"): string {
  // ensureJsonModeInstruction: Qwen/Alibaba require the word "json" when generateObject
  // uses response_format json_object.
  if (kind === "design") {
    return ensureJsonModeInstruction(`You are one independent member of an engineering design council.
Evaluate the question and context. Return structured issues covering trade-offs, risks, and recommendations.
Be concrete. Prefer fewer high-signal issues. Do not claim other models' opinions.`)
  }
  return ensureJsonModeInstruction(`You are one independent member of a multi-LLM code review council.
Review the provided context for correctness, security, architecture, and maintainability.
Return structured issues with severity, category, optional location (file:line), summary, and suggested fix.
Be concrete. Prefer fewer high-signal issues. Do not claim other models' opinions.`)
}

// Appended to the user message for the generateText fallback so the model
// knows exactly what shape to emit when structured output failed. Contains the
// literal word "json" (required by some providers in json mode).
const JSON_FALLBACK_INSTRUCTION = `Your previous response could not be parsed as structured output.
Respond with ONLY one json object, no markdown fences or extra text, matching this shape:
{"overall": string, "issues": [{"severity": "high"|"medium"|"low", "category": string, "location": string (optional), "summary": string, "suggestedFix": string (optional)}]}`

// AI SDK throws NoObjectGeneratedError ("No object generated: could not parse
// the response." / "No object generated: response did not match schema.") when
// generateObject output fails schema conformance. Detect by message/name so the
// check survives error wrapping and test mocks of the "ai" module.
function isSchemaConformanceError(error: unknown): boolean {
  const name = (error as { name?: string } | null)?.name
  if (name === "AI_NoObjectGeneratedError") return true
  const message = error instanceof Error ? error.message : String(error)
  return /no object generated/i.test(message) || /response did not match schema/i.test(message)
}

// The bundled ai major only accepts provider models declaring specificationVersion
// v2/v3; a runtime-installed provider package that is too new declares v4+ and
// every call fails with AI_UnsupportedModelVersionError ("Unsupported model
// version ..."). With the provider SDK compatibility pin this should be rare.
function isUnsupportedSpecVersionError(error: unknown): boolean {
  const name = (error as { name?: string } | null)?.name
  if (name === "AI_UnsupportedModelVersionError") return true
  const message = error instanceof Error ? error.message : String(error)
  return /unsupported model version/i.test(message)
}

// Extract a JSON value from raw model text: accept the bare text, a fenced
// ```json block, or the outermost {...} span. Returns undefined when nothing
// parses.
function parseJsonFromText(text: string): unknown {
  const candidates: string[] = [text.trim()]
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)
  if (fenced?.[1]) candidates.push(fenced[1].trim())
  const start = text.indexOf("{")
  const end = text.lastIndexOf("}")
  if (start >= 0 && end > start) candidates.push(text.slice(start, end + 1))
  for (const candidate of candidates) {
    const parsed = parseJsonResult(candidate)
    if (parsed.ok) return parsed.value
  }
  return undefined
}

async function runMember(input: {
  member: EnsembleShared.MemberSpec
  kind: "review" | "design"
  question: string
  context?: string
  debateContext?: string
  timeoutMs: number
  abort: AbortSignal
  retryOnce?: boolean
}): Promise<Council.CouncilMemberResult> {
  const { member, kind, question, context, debateContext, timeoutMs, abort, retryOnce = true } = input
  const started = Date.now()
  const maxAttempts = retryOnce ? 2 : 1

  // Resolve the model once up front (before the fan-out timer starts) so the
  // member timeout can scale for reasoning models. Lookup failures become
  // member errors, same as failures inside execute would.
  let model: Provider.Model
  try {
    model = await Provider.getModel(member.providerID, member.modelID)
  } catch (error) {
    return {
      memberId: member.memberId,
      providerID: String(member.providerID),
      modelID: String(member.modelID),
      issues: [],
      error: error instanceof Error ? error.message : String(error),
    }
  }
  const memberTimeoutMs = model.capabilities?.reasoning ? timeoutMs * REASONING_TIMEOUT_SCALE : timeoutMs

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    if (abort.aborted) break

    const [fanOutResult] = await FanOut.run({
      members: [member],
      timeoutMs: memberTimeoutMs,
      abort,
      onMemberComplete: (completed, total, m) => {
        log.info("council fan-out member done", {
          toolName: "council",
          memberId: m.memberId,
          completed,
          total,
        })
      },
      execute: async (_m, signal) => {
        const language = await Provider.getLanguage(model)
        const userParts = [
          `Kind: ${kind}`,
          `Question: ${question}`,
          context ? `\nContext:\n${context.slice(0, 24_000)}` : "",
          debateContext ? `\n${debateContext}` : "",
        ]
          .filter(Boolean)
          .join("\n")
        const system = systemPrompt(kind)

        try {
          const r = await generateObject({
            model: language,
            schema: MemberOutputSchema,
            abortSignal: signal,
            temperature: 0.2,
            messages: [
              { role: "system", content: system },
              { role: "user", content: userParts },
            ],
          })
          return r.object
        } catch (error) {
          if (isUnsupportedSpecVersionError(error)) {
            const detail = error instanceof Error ? error.message : String(error)
            throw new Error(
              `provider package for "${member.providerID}" is incompatible with this ax-code build: ${detail} ` +
                "The runtime-installed provider SDK declares an AI SDK specification version the bundled AI SDK does not support; a compatible version must be installed for this provider.",
            )
          }
          if (signal.aborted || !isSchemaConformanceError(error)) throw error
          // generateText fallback: some models return review JSON that
          // generateObject's strict structured-output path rejects
          // ("No object generated"). Retry in plain json mode and validate
          // the parsed text ourselves before declaring the member failed.
          log.info("council member generateObject failed schema, falling back to generateText", {
            toolName: "council",
            memberId: member.memberId,
            error: error instanceof Error ? error.message : String(error),
          })
          const fallback = await generateText({
            model: language,
            abortSignal: signal,
            temperature: 0.2,
            messages: [
              { role: "system", content: system },
              { role: "user", content: `${userParts}\n\n${JSON_FALLBACK_INSTRUCTION}` },
            ],
          })
          const validated = MemberOutputSchema.safeParse(parseJsonFromText(fallback.text ?? ""))
          if (!validated.success) throw error
          return validated.data
        }
      },
    })

    if (fanOutResult?.result) {
      const raw = fanOutResult.result
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
        overall: clampText(raw.overall, 800),
        issues: raw.issues.slice(0, MAX_ISSUES).map((issue) => ({
          memberId: member.memberId,
          severity: issue.severity,
          category: clampText(issue.category, 64),
          location: clampOptionalText(issue.location, 200),
          summary: clampText(issue.summary, 400),
          suggestedFix: clampOptionalText(issue.suggestedFix, 600),
        })),
      }
    }

    const errMessage = fanOutResult?.error ?? "aborted"
    const wasTimeout = errMessage.startsWith("timeout:")
    const wasAborted = errMessage.startsWith("aborted:") || abort.aborted

    if (!wasTimeout && !wasAborted && attempt < maxAttempts) {
      log.info("council member retrying", {
        toolName: "council",
        memberId: member.memberId,
        attempt,
        error: errMessage,
      })
      continue
    }

    log.warn("council member failed", {
      toolName: "council",
      memberId: member.memberId,
      durationMs: Date.now() - started,
      status: wasTimeout ? "timeout" : wasAborted ? "aborted" : "error",
    })
    return {
      memberId: member.memberId,
      providerID: String(member.providerID),
      modelID: String(member.modelID),
      issues: [],
      error: wasTimeout
        ? `${errMessage} — this member (often a reasoning model) needs more time than the council timeout allows. Ask the USER to raise modes.council.timeoutMs in ax-code.json; agents cannot edit that protected config file, so do not attempt to change it yourself.`
        : errMessage,
    }
  }

  return {
    memberId: member.memberId,
    providerID: String(member.providerID),
    modelID: String(member.modelID),
    issues: [],
    error: "aborted",
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
      const providerSnap = await EnsembleShared.snapshotSelectableProviders()
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

      const resolution = await EnsembleShared.resolveMembers(
        { minMembers: 1, maxMembers: budgetCheck.allowedMembers, requireDistinctProviders: true },
        args.providers,
        budgetCheck.allowedMembers,
        args.question,
      )
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
              : "") +
            (resolution.notes?.length
              ? `\n\nSelection notes:\n${resolution.notes.map((note) => `- ${note}`).join("\n")}`
              : ""),
          metadata,
        }
      }

      let councilCompleted = 0
      let results = await Promise.all(
        members.map(async (member) => {
          const result = await runMember({
            member,
            kind,
            question: args.question,
            context: args.context,
            timeoutMs,
            abort: ctx.abort,
          })
          councilCompleted++
          log.info("council member progress", {
            toolName: "council",
            memberId: member.memberId,
            completed: councilCompleted,
            total: members.length,
          })
          return result
        }),
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
              retryOnce: false,
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
      if (resolution.notes?.length) {
        parts.push("", "## Selection notes", ...resolution.notes.map((note) => `- ${note}`))
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
