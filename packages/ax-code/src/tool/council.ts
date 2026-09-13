/**
 * Multi-provider council tool (ADR-049 Phase 1 + Phase 3 debate/budget/memory).
 * Fans out structured reviews; aggregates via pure Council module.
 */

import { streamObject, streamText } from "ai"
import z from "zod"
import { createHash } from "node:crypto"
import { Config } from "../config/config"
import { Budget } from "../mode/budget"
import { Council } from "../mode/council"
import { CouncilContext } from "../mode/council-context"
import { Debate } from "../mode/debate"
import { EnsembleLedger } from "../mode/ensemble-ledger"
import { EnsembleShared, isNonTransientMemberError } from "../mode/ensemble-shared"
import { ensureJsonModeInstruction } from "../mode/json-mode-prompt"
import { EnsemblePreflight } from "../mode/preflight"
import { ModeMemory } from "../mode/memory"
import { ModePolicy } from "../mode/policy"
import { Provider } from "../provider/provider"
import { stripThinkTags } from "../provider/think-tags"
import { ProviderTransform } from "../provider/transform"
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
// Default 3: deepseek-v4-pro was observed timing out at the old 2× (360s) on
// large-context reviews. Configurable via modes.council.reasoningTimeoutScale.
// Exported for tests.
export const DEFAULT_REASONING_TIMEOUT_SCALE = 3
const HARD_MAX_MEMBERS = 6

// Resolve the effective timeout for one council member. Absolute overrides in
// modes.council.memberTimeoutMs win — "providerID/modelID" first, then the
// provider-wide "providerID" key — because a known-slow model should not force
// the global base/scale up for every other member. Otherwise reasoning models
// get base × scale and everyone else gets the base.
export function resolveMemberTimeoutMs(input: {
  providerID: string
  modelID: string
  reasoning?: boolean
  baseTimeoutMs: number
  reasoningScale?: number
  memberOverrides?: Record<string, number>
}): number {
  const { providerID, modelID, reasoning, baseTimeoutMs, memberOverrides } = input
  const exact = memberOverrides?.[`${providerID}/${modelID}`]
  if (exact !== undefined) return exact
  const providerWide = memberOverrides?.[providerID]
  if (providerWide !== undefined) return providerWide
  const scale = input.reasoningScale ?? DEFAULT_REASONING_TIMEOUT_SCALE
  return reasoning ? baseTimeoutMs * scale : baseTimeoutMs
}

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
  selections.forEach((selection, index) => {
    const key = `${selection.providerID}\u0000${selection.modelID ?? ""}`
    if (seen.has(key)) {
      ctx.addIssue({ code: "custom", message: "Duplicate provider/model selection", path: [index] })
    }
    seen.add(key)
  })
}

const parameters = z.object({
  question: z.string().min(1).describe("The review or design question for the council"),
  context: z
    .string()
    .optional()
    .describe("Required evidence shared verbatim with every member when supplied; maximum 24000 UTF-16 code units"),
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

// Include the output shape in both requests: JSON-only gateways may omit the
// SDK schema from the model prompt. The text fallback repeats it. Contains the
// literal word "json" (required by some providers in json mode).
const JSON_OUTPUT_INSTRUCTION = `Respond with ONLY one json object, no markdown fences or extra text, matching this shape:
{"overall": string, "issues": [{"severity": "high"|"medium"|"low", "category": string, "location": string (optional), "summary": string, "suggestedFix": string (optional)}]}`

// Use streaming for both paths: buffered reasoning responses can exceed gateway
// response deadlines even while the upstream model is healthy. Consume the full
// stream and propagate error events before accepting the validated final object.
// AI SDK throws NoObjectGeneratedError ("No object generated: could not parse
// the response." / "No object generated: response did not match schema.") when
// streamObject output fails schema conformance. Detect by message/name so the
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

type ResolvedMember = {
  member: EnsembleShared.MemberSpec
  model?: Provider.Model
  error?: string
}

async function runMember(input: {
  resolved: ResolvedMember
  system: string
  userParts: string
  timeoutMs: number
  reasoningScale?: number
  memberOverrides?: Record<string, number>
  abort: AbortSignal
  retryOnce?: boolean
  /** ADR-102: local call-ledger switch + phase label; the hook and prompt hash are built here where the effective timeout and final prompt strings are known. */
  ledger?: { enabled: boolean; phase: string }
}): Promise<Council.CouncilMemberResult> {
  const { resolved, system, userParts, timeoutMs, abort, retryOnce = true } = input
  const { member } = resolved
  const started = Date.now()
  const maxAttempts = retryOnce ? 2 : 1

  // Models are resolved before shared prompt admission. Keep SDK loading
  // outside the member timer and preserve lookup failures as member errors.
  let model: Provider.Model
  let language: Awaited<ReturnType<typeof Provider.getLanguage>>
  try {
    if (!resolved.model) throw new Error(resolved.error ?? "Model resolution failed")
    model = resolved.model
    // Resolve the language model up front too (same rationale as getModel
    // above): a cold SDK load/install must not count against the member's
    // reasoning timeout. A load failure becomes a member error, as before.
    language = await Provider.getLanguage(model)
  } catch (error) {
    return {
      memberId: member.memberId,
      providerID: String(member.providerID),
      modelID: String(member.modelID),
      issues: [],
      error: FanOut.describeError(error),
    }
  }
  const memberTimeoutMs = resolveMemberTimeoutMs({
    providerID: String(member.providerID),
    modelID: String(member.modelID),
    reasoning: model.capabilities?.reasoning,
    baseTimeoutMs: timeoutMs,
    reasoningScale: input.reasoningScale,
    memberOverrides: input.memberOverrides,
  })
  const telemetry = input.ledger?.enabled
    ? EnsembleLedger.telemetryFor<EnsembleShared.MemberSpec>({
        enabled: true,
        tool: "council",
        timeoutMs: memberTimeoutMs,
        phase: input.ledger.phase,
        promptHash: createHash("sha256").update(`${system}\n\n${userParts}`).digest("hex"),
        memberId: (m) => m.memberId,
      })
    : undefined

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    if (abort.aborted) break

    const [fanOutResult] = await FanOut.run({
      members: [member],
      timeoutMs: memberTimeoutMs,
      abort,
      telemetry,
      onMemberComplete: (completed, total, m) => {
        log.info("council fan-out member done", {
          toolName: "council",
          memberId: m.memberId,
          completed,
          total,
        })
      },
      execute: async (_m, signal) => {
        try {
          const r = streamObject({
            model: language,
            maxOutputTokens: ProviderTransform.auxMaxOutputTokens(model),
            schema: MemberOutputSchema,
            maxRetries: 0,
            abortSignal: signal,
            temperature: 0.2,
            messages: [
              { role: "system", content: system },
              { role: "user", content: userParts },
            ],
          })
          for await (const part of r.fullStream) {
            if (part.type === "error") throw part.error
          }
          return await r.object
        } catch (error) {
          if (isUnsupportedSpecVersionError(error)) {
            const detail = error instanceof Error ? error.message : String(error)
            throw new Error(
              `provider package for "${member.providerID}" is incompatible with this ax-code build: ${detail} ` +
                "The runtime-installed provider SDK declares an AI SDK specification version the bundled AI SDK does not support; a compatible version must be installed for this provider.",
            )
          }
          if (signal.aborted || !isSchemaConformanceError(error)) throw error
          // streamText fallback: some models return review JSON that
          // streamObject's strict structured-output path rejects
          // ("No object generated"). Retry in plain json mode and validate
          // the parsed text ourselves before declaring the member failed.
          log.info("council member streamObject failed schema, falling back to streamText", {
            toolName: "council",
            memberId: member.memberId,
            error: FanOut.describeError(error),
          })
          const fallback = streamText({
            model: language,
            maxRetries: 0,
            maxOutputTokens: ProviderTransform.auxMaxOutputTokens(model),
            abortSignal: signal,
            temperature: 0.2,
            messages: [
              { role: "system", content: system },
              { role: "user", content: `${userParts}\n\n${JSON_OUTPUT_INSTRUCTION}` },
            ],
          })
          for await (const part of fallback.fullStream) {
            if (part.type === "error") throw part.error
          }
          // MiniMax-M3 on vLLM/PAI writes `<mm:think>` reasoning into the text
          // stream. The main prompt path splits those blocks out
          // (attachThinkTagStream in session/llm-impl.ts), but these direct
          // structured calls do not, so the JSON arrives behind a reasoning
          // block whose own braces defeat the outermost-{...} extraction.
          // Strip complete think-tag blocks before parsing.
          const fallbackText = stripThinkTags((await fallback.text) ?? "")
          const validated = MemberOutputSchema.safeParse(parseJsonFromText(fallbackText))
          if (!validated.success) {
            // Surface both stages plus a bounded tail instead of re-throwing
            // the bare primary error: "could not parse the response" alone
            // hides whether the member returned nothing, truncated, or a
            // schema miss, and operators cannot diagnose it from the report.
            const finishReason = await fallback.finishReason
            throw new Error(
              `council member produced neither a schema-valid object nor parseable json ` +
                `(primary streamObject: ${FanOut.describeError(error)}; ` +
                `fallback finishReason=${finishReason ?? "unknown"}, length=${fallbackText.length}, ` +
                `snippet=${JSON.stringify(fallbackText.trim().slice(0, 500))})`,
            )
          }
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

    // ADR-099: retry only failures an immediate retry can fix — auth,
    // rate-limit, and unsupported-spec failures fail again and add pressure.
    if (!wasTimeout && !wasAborted && !isNonTransientMemberError(errMessage) && attempt < maxAttempts) {
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
        ? `${errMessage} — this member (often a reasoning model) needs more time than the council timeout allows. Ask the USER to raise modes.council.timeoutMs or set a per-member modes.council.memberTimeoutMs override (e.g. { "${member.providerID}": 600000 }) in ax-code.json; agents cannot edit that protected config file, so do not attempt to change it yourself.`
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

// ADR-102: opt-in blinded chairman (modes.council.chairman, default off).
// One synthesis call over the anonymized, pre-aggregated findings — member
// identities are never included. Deterministic tiering stays the primary
// output; chairman text is appended and advisory.
const ChairmanOutputSchema = z.object({
  verdict: z.string().min(1).describe("Single consolidated verdict, at most 600 chars"),
  recommendedActions: z
    .array(z.string().min(1))
    .describe("Ordered recommended actions, at most 8, each at most 300 chars"),
  dissent: z.array(z.string().min(1)).describe("Unresolved disagreements to weigh, at most 6, each at most 300 chars"),
})

const CHAIRMAN_SYSTEM = `You are the chairman of a multi-model review council.
You receive the council's anonymized, pre-aggregated findings (agreement tiers; member identities removed) for one question.
Produce a single consolidated verdict and ordered recommended actions.
Rules: the findings are evidence, not proof — do not overstate. Weigh consensus and majority above minority and singleton tiers.
Do not invent new findings, and do not attribute findings to any model or vendor.
Return a json object with this shape: {"verdict": string, "recommendedActions": string[], "dissent": string[]}.`

function clampChairmanOutput(output: z.infer<typeof ChairmanOutputSchema>): z.infer<typeof ChairmanOutputSchema> {
  return {
    verdict: clampText(output.verdict, 600),
    recommendedActions: output.recommendedActions.slice(0, 8).map((action) => clampText(action, 300)),
    dissent: output.dissent.slice(0, 6).map((item) => clampText(item, 300)),
  }
}

/** Anonymized findings text for the chairman: tiers and counts, no memberIds. */
export function chairmanBrief(report: Council.CouncilReport): string {
  const section = (title: string, items: Council.AggregatedIssue[]) => {
    if (!items.length) return []
    return [
      `## ${title}`,
      ...items.map(
        (item) =>
          `- [${item.severity}] ${item.category}${item.location ? ` @ ${item.location}` : ""}: ${item.summary} (${item.supportCount}/${item.totalMembers} members)` +
          (item.suggestedFix ? ` Suggested: ${item.suggestedFix}` : ""),
      ),
    ]
  }
  return [
    ...section("Consensus", report.consensus),
    ...section("Majority", report.majority),
    ...section("Minority observations", report.minority),
    ...section("Singleton observations", report.singleton),
  ].join("\n")
}

async function runChairman(input: {
  resolved: ResolvedMember
  user: string
  timeoutMs: number
  reasoningScale?: number
  memberOverrides?: Record<string, number>
  abort: AbortSignal
  /** ADR-102: local call-ledger switch; phase is fixed to "chairman". */
  ledger?: { enabled: boolean }
}): Promise<z.infer<typeof ChairmanOutputSchema>> {
  const { member } = input.resolved
  if (!input.resolved.model) throw new Error(input.resolved.error ?? "Model resolution failed")
  const model = input.resolved.model
  const language = await Provider.getLanguage(model)
  const memberTimeoutMs = resolveMemberTimeoutMs({
    providerID: String(member.providerID),
    modelID: String(member.modelID),
    reasoning: model.capabilities?.reasoning,
    baseTimeoutMs: input.timeoutMs,
    reasoningScale: input.reasoningScale,
    memberOverrides: input.memberOverrides,
  })
  const system = ensureJsonModeInstruction(CHAIRMAN_SYSTEM)
  const telemetry = input.ledger?.enabled
    ? EnsembleLedger.telemetryFor<EnsembleShared.MemberSpec>({
        enabled: true,
        tool: "council",
        timeoutMs: memberTimeoutMs,
        phase: "chairman",
        promptHash: createHash("sha256").update(`${system}\n\n${input.user}`).digest("hex"),
        memberId: (m) => m.memberId,
      })
    : undefined

  const attempt = async (): Promise<z.infer<typeof ChairmanOutputSchema>> => {
    const [result] = await FanOut.run({
      members: [member],
      timeoutMs: memberTimeoutMs,
      abort: input.abort,
      telemetry,
      execute: async (_m, signal) => {
        const r = streamObject({
          model: language,
          maxOutputTokens: ProviderTransform.auxMaxOutputTokens(model),
          schema: ChairmanOutputSchema,
          maxRetries: 0,
          abortSignal: signal,
          temperature: 0.2,
          messages: [
            { role: "system", content: system },
            { role: "user", content: input.user },
          ],
        })
        for await (const part of r.fullStream) {
          if (part.type === "error") throw part.error
        }
        return await r.object
      },
    })
    if (result.error) throw new Error(result.error)
    return result.result!
  }

  try {
    return clampChairmanOutput(await attempt())
  } catch (firstError) {
    const message = firstError instanceof Error ? firstError.message : String(firstError)
    if (message.startsWith("timeout:") || message.startsWith("aborted:") || isNonTransientMemberError(message)) {
      throw firstError
    }
    return clampChairmanOutput(await attempt())
  }
}

// ADR-102: adaptive fan-out triggers (modes.council.adaptive, default off).
// Start with two members; expand one at a time while the evidence is weak.
// These thresholds are deliberately conservative and harness-tunable — sweep
// evidence for changing them lands through the normal PRD/ADR path.
const ADAPTIVE_INITIAL_MEMBERS = 2

/** Expand while coverage is below quorum, the fan-out is incomplete, or no consensus finding exists with material dissent. */
export function adaptiveShouldExpand(report: Council.CouncilReport): boolean {
  if (report.incomplete) return true
  if (report.successfulMembers < report.quorum) return true
  return report.consensus.length === 0 && report.minority.length + report.singleton.length >= 2
}

type CouncilMetadata = {
  status: string
  contextAdmission?: CouncilContext.Admission
  promptBudget?: CouncilContext.PromptBudget
  totalMembers?: number
  successfulMembers?: number
  failedMembers?: number
  consensusCount?: number
  majorityCount?: number
  minorityCount?: number
  singletonCount?: number
  /** ADR-101: minimum successes before the consensus tier may fire. */
  quorum?: number
  chairman?: "ok" | "failed" | "disabled" | "skipped"
  chairmanError?: string
  /** ADR-102: members added by the adaptive lane beyond the initial two. */
  adaptiveExpanded?: number
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
      // Re-read project config so mid-session ax-code.json edits apply.
      const cfg = await Config.getFresh()
      const modes = (cfg as { modes?: ModePolicy.ModesConfig }).modes
      if (modes?.council?.enabled === false) {
        // Short-circuit before provider discovery: the disabled path neither
        // needs nor uses the provider snapshot, so don't pay for Provider.ready()
        // + auth decryption just to print the disabled message.
        const metadata: CouncilMetadata = { status: "disabled" }
        return {
          title: "Council disabled",
          output: EnsemblePreflight.councilDisabledMessage(),
          metadata,
        }
      }
      ctx.abort.throwIfAborted()
      const contextAdmission = CouncilContext.admit(args.context)
      if (contextAdmission.status === "rejected") {
        return {
          title: "Council context rejected",
          output:
            `Council rejected ${contextAdmission.suppliedCharacters} UTF-16 code units ` +
            `(${contextAdmission.suppliedBytes} bytes) of required context; the limit is ${contextAdmission.maxCharacters}. ` +
            "No member inference ran and no context was truncated. Split the review into explicitly scoped requests " +
            "or reduce optional background while retaining the required evidence.",
          metadata: { status: "context_rejected", successfulMembers: 0, contextAdmission } as CouncilMetadata,
        }
      }
      const providerSnap = await EnsembleShared.snapshotSelectableProviders()

      const timeoutMs = modes?.council?.timeoutMs ?? DEFAULT_TIMEOUT_MS
      const reasoningScale = modes?.council?.reasoningTimeoutScale
      const memberOverrides = modes?.council?.memberTimeoutMs
      const kind = args.kind ?? "review"
      const maxMembers = Math.min(HARD_MAX_MEMBERS, Math.max(1, modes?.council?.maxMembers ?? DEFAULT_MAX_MEMBERS))
      const maxRounds = Debate.resolveMaxRounds(args.debateRounds ?? modes?.council?.debateRounds)

      const budgetCheck = Budget.check({
        kind: "council",
        requestedMembers: args.providers?.length ?? maxMembers,
        // ADR-101: worst case per round is the structured call plus its
        // schema-fallback, and the initial round can retry once — price 2×
        // per round instead of the optimistic 1×.
        callsPerMember: 2 * (maxRounds + 1),
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
        { requireDistinctProviders: false },
        args.providers,
        budgetCheck.allowedMembers,
        args.question,
      )
      let members = resolution.members
      if (members.length > budgetCheck.allowedMembers) {
        members = members.slice(0, budgetCheck.allowedMembers)
      }

      if (members.length < 2) {
        // Mirror the arena guard: a one-member "council" can never reach
        // consensus, so report instead of burning a review call (ADR-097).
        // Explicit same-gateway model pairs still count as two members.
        const insufficient = members.length > 0
        const metadata: CouncilMetadata = {
          status: insufficient ? "insufficient_members" : "no_members",
          totalMembers: members.length,
          successfulMembers: 0,
          providerCount: providerSnap.count,
          providerIDs: providerSnap.ids,
          selectionErrors: resolution.rejected,
        }
        return {
          title: insufficient ? "Council: need ≥2 members" : "Council: no members",
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

      // Ask only once the council can actually run: preflight paths (disabled,
      // rejected context, budget, no/insufficient members) never prompt (ADR-097).
      await ctx.ask({
        permission: "council",
        patterns: ["*"],
        always: ["*"],
        metadata: {
          question: args.question.slice(0, 200),
          kind: args.kind ?? "review",
        },
      })

      const resolvedMembers: ResolvedMember[] = await Promise.all(
        members.map(async (member) => {
          try {
            return { member, model: await Provider.getModel(member.providerID, member.modelID) }
          } catch (error) {
            return { member, error: FanOut.describeError(error) }
          }
        }),
      )
      ctx.abort.throwIfAborted()
      const system = `${systemPrompt(kind)}\n\n${JSON_OUTPUT_INSTRUCTION}`
      const userParts = CouncilContext.userPrompt({ kind, question: args.question, context: args.context })
      const checkPrompt = (user: string) =>
        CouncilContext.checkPrompt({
          system,
          user,
          fallbackInstruction: JSON_OUTPUT_INSTRUCTION,
          members: resolvedMembers
            .filter((resolved) => resolved.model)
            .map(({ member, model }) => ({
              memberId: member.memberId,
              limit: model?.limit,
              maxOutputTokens: ProviderTransform.auxMaxOutputTokens(model),
            })),
        })
      let promptBudget = checkPrompt(userParts)
      if (!promptBudget.ok) {
        return {
          title: "Council input budget rejected",
          output:
            "Council rejected the complete prompt before any member inference. No context was truncated.\n\n" +
            promptBudget.reasons.join("\n") +
            "\n\nThe budget uses a conservative UTF-8-byte estimate plus schema/framing reserve, not a tokenizer count. " +
            "Split the review into explicitly scoped requests, reduce optional background, or select models with sufficient input capacity.",
          metadata: {
            status: "context_rejected",
            successfulMembers: 0,
            contextAdmission,
            promptBudget,
          } as CouncilMetadata,
        }
      }

      // ADR-102: the adaptive lane starts with two members and expands one at
      // a time while round-1 evidence is weak; the fixed lane runs the full set.
      const adaptive = modes?.council?.adaptive === true
      const ledgerEnabled = modes?.ensembleLedger !== false
      const initialMembers = adaptive ? resolvedMembers.slice(0, ADAPTIVE_INITIAL_MEMBERS) : resolvedMembers
      let councilCompleted = 0
      const runOne = (resolved: ResolvedMember) =>
        runMember({
          resolved,
          system,
          userParts,
          timeoutMs,
          reasoningScale,
          memberOverrides,
          abort: ctx.abort,
          ledger: { enabled: ledgerEnabled, phase: "fanout" },
        }).then((result) => {
          councilCompleted++
          log.info("council member progress", {
            toolName: "council",
            memberId: resolved.member.memberId,
            completed: councilCompleted,
            total: members.length,
          })
          return result
        })
      let results = await Promise.all(initialMembers.map((resolved) => runOne(resolved)))
      ctx.abort.throwIfAborted()
      let report = Council.aggregateCouncil(results)
      let adaptiveExpanded = 0
      if (adaptive) {
        for (let next = initialMembers.length; next < resolvedMembers.length && adaptiveShouldExpand(report); next++) {
          log.info("council adaptive expansion", { toolName: "council", expandingTo: next + 1 })
          const result = await runOne(resolvedMembers[next]!)
          results = [...results, result]
          adaptiveExpanded++
          ctx.abort.throwIfAborted()
          report = Council.aggregateCouncil(results)
        }
      }
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
        const debatePrompt = CouncilContext.userPrompt({
          kind,
          question: args.question,
          context: args.context,
          debateContext: synthesis,
        })
        promptBudget = checkPrompt(debatePrompt)
        if (!promptBudget.ok) {
          debateStopReason = "input_budget_rejected"
          break
        }
        debateNotes.push(`### Debate round ${round}`, "", synthesis, "")

        results = await Promise.all(
          resolvedMembers.map((resolved) =>
            runMember({
              resolved,
              system,
              userParts: debatePrompt,
              timeoutMs,
              reasoningScale,
              memberOverrides,
              abort: ctx.abort,
              retryOnce: false,
              ledger: { enabled: ledgerEnabled, phase: `debate-${round}` },
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

      // ADR-102: opt-in blinded chairman synthesis (modes.council.chairman).
      // Runs after the final aggregation (and any debate rounds); an
      // incomplete report has nothing worth synthesizing.
      let chairmanStatus: "ok" | "failed" | "disabled" | "skipped" =
        modes?.council?.chairman === true ? "skipped" : "disabled"
      let chairmanError: string | undefined
      let chairmanOutput: z.infer<typeof ChairmanOutputSchema> | undefined
      if (modes?.council?.chairman === true && !report.incomplete) {
        const chairmanUser =
          CouncilContext.userPrompt({ kind, question: args.question, context: args.context }) +
          `\n\nReport status: ${report.successfulMembers}/${report.totalMembers} members succeeded (quorum ${report.quorum}).\n\n` +
          chairmanBrief(report)
        if (!checkPrompt(chairmanUser).ok) {
          chairmanStatus = "skipped"
          chairmanError = "chairman prompt rejected by the input budget"
        } else {
          try {
            chairmanOutput = await runChairman({
              resolved: resolvedMembers[0]!,
              user: chairmanUser,
              timeoutMs,
              reasoningScale,
              memberOverrides,
              abort: ctx.abort,
              ledger: { enabled: ledgerEnabled },
            })
            chairmanStatus = "ok"
          } catch (error) {
            chairmanStatus = "failed"
            chairmanError = error instanceof Error ? error.message : String(error)
            log.warn("council chairman failed; deterministic report retained", {
              toolName: "council",
              error: chairmanError,
            })
          }
        }
      }

      const markdown = Council.renderReportMarkdown(report, args.question)
      const overallLines = results.filter((r) => !r.error && r.overall).map((r) => `- **${r.memberId}:** ${r.overall}`)

      const parts = [markdown]
      if (!promptBudget.ok) {
        parts.unshift(
          "Council is incomplete: the next debate round was rejected before inference. The last completed round is retained below.",
          ...promptBudget.reasons,
          "",
        )
      }
      parts.push(
        "",
        `Context admission: accepted ${contextAdmission.suppliedCharacters} UTF-16 code units verbatim; no truncation. ` +
          "This describes supplied text only, not semantic evidence completeness.",
        "Input budget uses a conservative UTF-8-byte estimate with schema/framing reserve, not a tokenizer count.",
      )
      if (promptBudget.unknownLimitMembers.length) {
        parts.push(`Model input limits are unknown for: ${promptBudget.unknownLimitMembers.join(", ")}.`)
      }
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
      if (chairmanStatus === "ok" && chairmanOutput) {
        parts.push(
          "",
          "## Chairman synthesis (advisory)",
          "",
          `**Verdict:** ${chairmanOutput.verdict}`,
          "",
          "**Recommended actions:**",
          ...chairmanOutput.recommendedActions.map((action) => `- ${action}`),
          ...(chairmanOutput.dissent.length
            ? ["", "**Dissent to weigh:**", ...chairmanOutput.dissent.map((item) => `- ${item}`)]
            : []),
          "",
          `_Chairman: one synthesis call by ${resolvedMembers[0]!.member.memberId} over anonymized findings; the deterministic tiers above remain the primary output._`,
        )
      } else if (chairmanStatus === "failed") {
        parts.push(
          "",
          `_Chairman unavailable (${chairmanError ?? "unknown"}); the deterministic tiers above are the complete output._`,
        )
      } else if (chairmanStatus === "skipped" && chairmanError) {
        parts.push("", `_Chairman skipped: ${chairmanError}._`)
      }
      if (adaptive) {
        const started = Math.min(ADAPTIVE_INITIAL_MEMBERS, resolvedMembers.length)
        parts.push(
          "",
          adaptiveExpanded > 0
            ? `_Adaptive fan-out: started ${started}, expanded to ${started + adaptiveExpanded} of ${resolvedMembers.length} members on weak round-1 evidence._`
            : `_Adaptive fan-out: round-1 evidence was sufficient at ${results.length} members; no expansion._`,
        )
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
        status: report.incomplete || !promptBudget.ok ? "incomplete" : "ok",
        contextAdmission,
        promptBudget,
        totalMembers: report.totalMembers,
        successfulMembers: report.successfulMembers,
        failedMembers: report.failedMembers,
        consensusCount: report.consensus.length,
        majorityCount: report.majority.length,
        minorityCount: report.minority.length,
        singletonCount: report.singleton.length,
        quorum: report.quorum,
        chairman: chairmanStatus,
        ...(chairmanError ? { chairmanError } : {}),
        ...(adaptive ? { adaptiveExpanded } : {}),
        memberIds: results.map((r) => r.memberId),
        debateRoundsRun,
        debateStopReason,
        budgetReasons: budgetCheck.reasons,
        selectionErrors: resolution.rejected,
      }

      return {
        title:
          report.incomplete || !promptBudget.ok
            ? `Council incomplete (${report.successfulMembers}/${report.totalMembers})`
            : `Council ${report.consensus.length}c/${report.majority.length}m/${report.minority.length}mi/${report.singleton.length}s` +
              (debateRoundsRun ? ` d${debateRoundsRun}` : ""),
        output: parts.join("\n"),
        metadata,
      }
    },
  }
})
