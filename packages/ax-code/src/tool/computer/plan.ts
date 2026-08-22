/**
 * Plan-level Best-of-N with a behavior judge for computer use (Agent S3's bBoN
 * idea, adapted): N candidate action plans are sampled in parallel from the
 * session model at varied temperatures, and a single judge call compares the
 * behavior narratives — what each plan would actually do on screen — against
 * the current observation, picking the plan most likely to complete the task
 * rather than the most polished text.
 *
 * The LLM calls are injectable (PlanJudgeDeps) so tool tests never touch a
 * real model. Judging is best-effort: candidate failures are tolerated while
 * at least one succeeds, and a judge failure falls back to the first
 * successful candidate — plan infra never blocks the agent.
 */
import { generateObject, generateText } from "ai"
import z from "zod"
import type { Computer } from "@/computer/computer"
import { ensureJsonModeInstruction } from "@/mode/json-mode-prompt"
import type { ProviderModel } from "@/provider/model-info"
import { Provider } from "@/provider/provider"
import { FanOut } from "@/util/fan-out"
import { parseJsonResult } from "@/util/json-value"

export const CandidateSchema = z.object({
  title: z.string(),
  /** narrative GUI steps referencing elements by name/role from the observation */
  steps: z.array(z.string()),
  risks: z.array(z.string()),
})

export const JudgeSchema = z.object({
  /** 0-based index into the presented candidate list */
  winner: z.number().int().min(0),
  rationale: z.string(),
})

export type Candidate = z.infer<typeof CandidateSchema>
export type JudgeVerdict = z.infer<typeof JudgeSchema>

export interface PlanInput {
  task: string
  /** number of candidates to sample (1 skips judging) */
  candidates: number
  /** session model (vision-gated by the caller) */
  model: ProviderModel
  /** rendered current observation (a11y text already capped) */
  observationText: string
  /** recent computer-use history, rendered into the prompts */
  trajectory: Computer.TrajectoryEntry[]
  abort: AbortSignal
}

export interface PlanJudgeDeps {
  generateCandidate?: (input: {
    system: string
    user: string
    temperature: number
    abortSignal: AbortSignal
  }) => Promise<Candidate>
  judge?: (input: { system: string; user: string; abortSignal: AbortSignal }) => Promise<JudgeVerdict>
}

export interface PlanResult {
  winner: Candidate
  /** index into the candidate list that was presented to the judge */
  winnerIndex: number
  candidateCount: number
  judged: boolean
  rationale?: string
  /** one-line titles of the losing candidates */
  losers: string[]
}

const CANDIDATE_TIMEOUT_MS = 30_000
const TEMPERATURES = [0.4, 0.8, 1.1]

// ensureJsonModeInstruction: Qwen/Alibaba require the word "json" when generateObject
// uses response_format json_object.
const CANDIDATE_SYSTEM = ensureJsonModeInstruction(`You are planning GUI actions for a desktop computer-use agent.
Given a task and the current screen state (accessibility tree and element list), propose ONE concrete plan.
Steps are behavior narratives: what you would actually click, type, or scroll on screen, referencing elements
by their name and role from the observation. Do not invent elements that are not on screen.
List the risks honestly (ambiguous targets, destructive actions, timing dependencies).`)

const JUDGE_SYSTEM =
  ensureJsonModeInstruction(`You are judging candidate GUI action plans for a desktop computer-use agent.
Compare the behavior narratives: what each plan would actually do on screen, step by step.
Penalize plans that ignore the current screen state or reference elements that are not in the observation.
Prefer fewer risky actions and the plan most likely to complete the task — NOT the most polished text.
Return the 0-based index of the winning candidate and a short rationale.`)

// Appended to the user message for the generateText fallback so the model
// knows exactly what shape to emit when structured output failed. Contains the
// literal word "json" (required by some providers in json mode).
const JSON_FALLBACK_INSTRUCTION = `Your previous response could not be parsed as structured output.
Respond with ONLY one json object, no markdown fences or extra text, matching the requested shape.`

// AI SDK throws NoObjectGeneratedError when generateObject output fails schema
// conformance. Detect by message/name so the check survives error wrapping.
// (Same fallback strategy as council.ts.)
function isSchemaConformanceError(error: unknown): boolean {
  const name = (error as { name?: string } | null)?.name
  if (name === "AI_NoObjectGeneratedError") return true
  const message = error instanceof Error ? error.message : String(error)
  return /no object generated/i.test(message) || /response did not match schema/i.test(message)
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

async function generate<T>(input: {
  model: ProviderModel
  schema: z.ZodType<T>
  system: string
  user: string
  temperature?: number
  abortSignal: AbortSignal
}): Promise<T> {
  const language = await Provider.getLanguage(input.model)
  const messages = [
    { role: "system" as const, content: input.system },
    { role: "user" as const, content: input.user },
  ]
  try {
    const result = await generateObject({
      model: language,
      schema: input.schema,
      abortSignal: input.abortSignal,
      temperature: input.temperature,
      messages,
    })
    return result.object
  } catch (error) {
    if (!isSchemaConformanceError(error)) throw error
    // generateText fallback: some models return JSON that generateObject's
    // strict structured-output path rejects (same pattern as council.ts).
    const fallback = await generateText({
      model: language,
      abortSignal: input.abortSignal,
      temperature: input.temperature,
      messages: [messages[0], { role: "user" as const, content: `${input.user}\n\n${JSON_FALLBACK_INSTRUCTION}` }],
    })
    const parsed = input.schema.safeParse(parseJsonFromText(fallback.text ?? ""))
    if (!parsed.success) throw error
    return parsed.data
  }
}

let testDeps: PlanJudgeDeps | undefined

/** test-only: replace the candidate/judge generators (undefined restores the real ones) */
export function _setPlanDepsForTests(deps: PlanJudgeDeps | undefined): void {
  testDeps = deps
}

function candidateUser(input: PlanInput): string {
  const history =
    input.trajectory.length > 0
      ? input.trajectory.map((entry, index) => `${index + 1}. ${entry.summary}`).join("\n")
      : "(no prior computer-use steps)"
  return [`Task: ${input.task}`, "", "Current screen:", input.observationText, "", "Recent history:", history].join(
    "\n",
  )
}

function judgeUser(input: PlanInput, candidates: Candidate[]): string {
  const rendered = candidates
    .map((candidate, index) =>
      [
        `Candidate ${index}: "${candidate.title}"`,
        ...candidate.steps.map((step, stepIndex) => `  ${stepIndex + 1}. ${step}`),
        candidate.risks.length > 0 ? `  Risks: ${candidate.risks.join("; ")}` : "  Risks: none listed",
      ].join("\n"),
    )
    .join("\n\n")
  return [`Task: ${input.task}`, "", "Current screen:", input.observationText, "", rendered].join("\n")
}

export async function planWithJudge(input: PlanInput, deps?: PlanJudgeDeps): Promise<PlanResult> {
  const resolved = deps ?? testDeps ?? {}
  const generateCandidate =
    resolved.generateCandidate ??
    ((candidateInput: { system: string; user: string; temperature: number; abortSignal: AbortSignal }) =>
      generate({ model: input.model, schema: CandidateSchema, ...candidateInput }))
  const judge =
    resolved.judge ??
    ((judgeInput: { system: string; user: string; abortSignal: AbortSignal }) =>
      generate({ model: input.model, schema: JudgeSchema, ...judgeInput }))

  const members = TEMPERATURES.slice(0, input.candidates).map((temperature, index) => ({ index, temperature }))
  const results = await FanOut.run({
    members,
    timeoutMs: CANDIDATE_TIMEOUT_MS,
    abort: input.abort,
    concurrency: members.length,
    execute: async (member, signal) =>
      generateCandidate({
        system: CANDIDATE_SYSTEM,
        user: candidateUser(input),
        temperature: member.temperature,
        abortSignal: signal,
      }),
  })

  // tolerate per-candidate failures as long as one plan survives
  const candidates = results.flatMap((result) => (result.result ? [result.result] : []))
  if (candidates.length === 0) {
    const errors = results.map((result) => result.error ?? "unknown").join("; ")
    throw new Error(`All ${members.length} candidate plan generation(s) failed: ${errors}`)
  }

  // judging needs a comparison — skip for a single requested/surviving candidate
  if (candidates.length < 2) {
    return {
      winner: candidates[0]!,
      winnerIndex: 0,
      candidateCount: candidates.length,
      judged: false,
      losers: [],
    }
  }

  try {
    const verdict = await judge({
      system: JUDGE_SYSTEM,
      user: judgeUser(input, candidates),
      abortSignal: input.abort,
    })
    // clamp: a judge index outside the presented range falls back to candidate 0
    const winnerIndex = verdict.winner < candidates.length ? verdict.winner : 0
    return {
      winner: candidates[winnerIndex]!,
      winnerIndex,
      candidateCount: candidates.length,
      judged: true,
      rationale: verdict.rationale,
      losers: candidates.filter((_, index) => index !== winnerIndex).map((candidate) => candidate.title),
    }
  } catch {
    // judge infra must never block the agent: fall back to the first candidate
    return {
      winner: candidates[0]!,
      winnerIndex: 0,
      candidateCount: candidates.length,
      judged: false,
      losers: candidates.slice(1).map((candidate) => candidate.title),
    }
  }
}
