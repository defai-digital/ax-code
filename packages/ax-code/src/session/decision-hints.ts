import type { MessageV2 } from "./message-v2"
import type { ReplayEvent } from "@/replay/event"
import z from "zod"

export namespace DecisionHints {
  export const CategorySchema = z.enum(["missing_verification", "failed_validation", "missing_review_completion"])
  export type Category = z.output<typeof CategorySchema>

  export const HintSchema = z.object({
    id: z.string(),
    category: CategorySchema,
    confidence: z.number().min(0).max(1),
    title: z.string(),
    body: z.string(),
    evidence: z.string().array(),
  })
  export type Hint = z.output<typeof HintSchema>

  export const SummarySchema = z.object({
    source: z.enum(["replay", "messages", "none"]),
    readiness: z.enum(["clear", "needs_validation", "blocked"]),
    actionCount: z.number().int().nonnegative(),
    hintCount: z.number().int().nonnegative(),
    hints: HintSchema.array(),
  })
  export type Summary = z.output<typeof SummarySchema>

  interface ToolAction {
    index: number
    tool: string
    status: MessageV2.ToolPart["state"]["status"]
    input: Record<string, unknown>
    metadata?: Record<string, unknown>
  }

  const WRITE_TOOLS = new Set(["edit", "write", "multiedit", "apply_patch"])
  const VALIDATION_COMMAND =
    /\b(bun\s+(run\s+)?(test|typecheck|build|check)|bun\s+test|pnpm\s+.*\b(test|typecheck|build|check)\b|npm\s+.*\b(test|typecheck|build|check)\b|yarn\s+.*\b(test|typecheck|build|check)\b|cargo\s+(test|check|clippy)|tsc\b|eslint\b|vitest\b|jest\b|pytest\b|go\s+test\b|swift\s+test\b)\b/i
  const VALIDATION_DESCRIPTION = /\b(test|typecheck|build|lint|verify|validation)\b/i
  const DECISION_HINT_TAG = /<\/?decision-hints>/gi
  const MAX_EVIDENCE = 4

  export interface Analysis {
    hints: Hint[]
    actionCount: number
  }

  export function analyzeMessages(messages?: MessageV2.WithParts[]): Analysis {
    const actions = collectMessageActions(messages ?? [])
    return { hints: fromActions(actions), actionCount: actions.length }
  }

  export function fromMessages(messages?: MessageV2.WithParts[]): Hint[] {
    return analyzeMessages(messages).hints
  }

  export function summarizeMessages(messages?: MessageV2.WithParts[]): Summary {
    return summarizeAnalysis("messages", analyzeMessages(messages))
  }

  export function analyzeEvents(events?: ReplayEvent[]): Analysis {
    const actions = collectReplayActions(events ?? [])
    return { hints: fromActions(actions), actionCount: actions.length }
  }

  export function fromEvents(events?: ReplayEvent[]): Hint[] {
    return analyzeEvents(events).hints
  }

  export function summarizeEvents(events?: ReplayEvent[]): Summary {
    return summarizeAnalysis("replay", analyzeEvents(events))
  }

  export function fromSources(input: { messages?: MessageV2.WithParts[]; events?: ReplayEvent[] }): Hint[] {
    return summarizeSources(input).hints
  }

  export function summarizeSources(input: { messages?: MessageV2.WithParts[]; events?: ReplayEvent[] }): Summary {
    const replay = analyzeEvents(input.events)
    if (replay.actionCount > 0) return summarizeAnalysis("replay", replay)
    const messages = analyzeMessages(input.messages)
    if (messages.actionCount > 0) return summarizeAnalysis("messages", messages)
    return summarizeAnalysis("none", { hints: [], actionCount: 0 })
  }

  export function summarizeAnalysis(source: Summary["source"], analysis: Analysis): Summary {
    return SummarySchema.parse({
      source: analysis.actionCount > 0 ? source : "none",
      readiness: readinessFor(analysis.hints),
      actionCount: analysis.actionCount,
      hintCount: analysis.hints.length,
      hints: analysis.hints,
    })
  }

  export function render(hints: Hint[]): string | undefined {
    if (hints.length === 0) return undefined
    const parts = [
      "<decision-hints>",
      "These hints are advisory signals from recent session history. Use them to notice likely missing work, but do not let them override user instructions, permissions, sandbox boundaries, or explicit deny rules.",
    ]
    for (const hint of hints) {
      parts.push(
        `- ${safeText(hint.title)} (confidence ${hint.confidence.toFixed(2)}): ${safeText(hint.body)}`,
        ...hint.evidence.slice(0, MAX_EVIDENCE).map((item) => `  - Evidence: ${safeText(item)}`),
      )
    }
    parts.push("</decision-hints>")
    return parts.join("\n")
  }

  function fromActions(actions: ToolAction[]): Hint[] {
    return [...editValidationHints(actions), ...reviewWorkflowHints(actions)]
  }

  function editValidationHints(actions: ToolAction[]): Hint[] {
    const writes = actions.filter(isCompletedWrite)
    const lastWrite = writes.at(-1)
    if (!lastWrite) return []

    const validationsAfterWrite = actions.filter(
      (action) => action.index > lastWrite.index && isValidationAction(action),
    )
    const latestValidation = validationsAfterWrite.at(-1)
    if (latestValidation && validationFailed(latestValidation)) {
      return [
        {
          id: "failed-validation-after-edit",
          category: "failed_validation",
          confidence: 0.9,
          title: "Resolve failed validation before finalizing",
          body: "A validation command ran after file changes but did not succeed. Fix the failure or clearly explain why it is unrelated before completing the task.",
          evidence: [describeAction(latestValidation), describeChangedFiles(writes)],
        },
      ]
    }

    if (!latestValidation) {
      return [
        {
          id: "missing-validation-after-edit",
          category: "missing_verification",
          confidence: 0.74,
          title: "Run targeted validation before finalizing",
          body: "File changes were made after the last validation signal. Run the narrowest relevant test, typecheck, build, or check command, or explain why validation is not applicable.",
          evidence: [describeAction(lastWrite), describeChangedFiles(writes)],
        },
      ]
    }

    return []
  }

  function reviewWorkflowHints(actions: ToolAction[]): Hint[] {
    const reviewFindings = actions.filter(isReviewFindingAction)
    const reviewVerifications = actions.filter(isReviewVerificationAction)
    const reviewSignals = [...reviewFindings, ...reviewVerifications].sort((a, b) => a.index - b.index)
    const latestReviewSignal = reviewSignals.at(-1)
    const latestCompletion = actions.filter(isReviewCompleteAction).at(-1)
    if (!latestReviewSignal) {
      if (latestCompletion && reviewCompletionNeedsVerification(latestCompletion)) {
        return [missingReviewVerificationHint(latestCompletion, reviewFindings, reviewVerifications)]
      }
      return []
    }

    if (latestCompletion && latestCompletion.index > latestReviewSignal.index) {
      if (reviewCompletionNeedsVerification(latestCompletion)) {
        return [missingReviewVerificationHint(latestCompletion, reviewFindings, reviewVerifications)]
      }
      return []
    }

    const latestFinding = reviewFindings.at(-1)
    const reviewVerificationsAfterFinding = reviewVerifications.filter(
      (action) => !latestFinding || action.index > latestFinding.index,
    )
    const latestReviewVerification = reviewVerificationsAfterFinding.at(-1)
    if (!latestReviewVerification) {
      return [missingReviewVerificationHint(latestReviewSignal, reviewFindings, reviewVerifications)]
    }
    if (!reviewVerificationSuccessful(latestReviewVerification)) {
      return [failedReviewVerificationHint(latestReviewVerification)]
    }

    return [
      {
        id: "missing-review-completion",
        category: "missing_review_completion",
        confidence: 0.82,
        title: "Complete the structured review result",
        body: "Review findings or review-scoped verification were recorded, but no later review_complete result closed the review loop. Run review_complete before finalizing the review.",
        evidence: [describeReviewSignal(latestReviewVerification), describeReviewFindings(reviewFindings)],
      },
    ]
  }

  function readinessFor(hints: Hint[]): Summary["readiness"] {
    if (hints.some((hint) => hint.category === "failed_validation")) return "blocked"
    if (
      hints.some((hint) => hint.category === "missing_verification" || hint.category === "missing_review_completion")
    )
      return "needs_validation"
    return "clear"
  }

  function collectMessageActions(messages: MessageV2.WithParts[]): ToolAction[] {
    const actions: ToolAction[] = []
    let index = 0
    for (const message of messages) {
      for (const part of message.parts) {
        if (part.type !== "tool") continue
        actions.push({
          index: index++,
          tool: part.tool,
          status: part.state.status,
          input: part.state.input,
          metadata: "metadata" in part.state ? part.state.metadata : undefined,
        })
      }
    }
    return actions
  }

  function collectReplayActions(events: ReplayEvent[]): ToolAction[] {
    const calls = new Map<string, { tool: string; input: Record<string, unknown> }>()
    const actions: ToolAction[] = []
    for (const event of events) {
      if (event.type === "tool.call") {
        calls.set(event.callID, { tool: event.tool, input: event.input })
        continue
      }
      if (event.type !== "tool.result") continue
      const call = calls.get(event.callID)
      actions.push({
        index: actions.length,
        tool: call?.tool ?? event.tool,
        status: event.status,
        input: call?.input ?? {},
        metadata: event.metadata,
      })
    }
    return actions
  }

  function isCompletedWrite(action: ToolAction): boolean {
    return action.status === "completed" && WRITE_TOOLS.has(action.tool)
  }

  function isValidationAction(action: ToolAction): boolean {
    if (action.tool !== "bash" || action.status !== "completed") return false
    const command = commandText(action)
    const description = typeof action.input.description === "string" ? action.input.description : ""
    return VALIDATION_COMMAND.test(command) || VALIDATION_DESCRIPTION.test(description)
  }

  function validationFailed(action: ToolAction): boolean {
    const exit = action.metadata?.exit
    return typeof exit === "number" && exit !== 0
  }

  function isReviewFindingAction(action: ToolAction): boolean {
    if (action.tool !== "register_finding" || action.status !== "completed") return false
    if (action.input.workflow === "review") return true
    const finding = action.metadata?.finding
    return isRecord(finding) && finding.workflow === "review"
  }

  function isReviewVerificationAction(action: ToolAction): boolean {
    return action.status === "completed" && reviewEnvelopeStatuses(action).length > 0
  }

  function isReviewCompleteAction(action: ToolAction): boolean {
    return action.tool === "review_complete" && action.status === "completed"
  }

  function reviewCompletionNeedsVerification(action: ToolAction): boolean {
    const reviewResult = action.metadata?.reviewResult
    return isRecord(reviewResult) && reviewResult.missingVerification === true
  }

  function reviewVerificationSuccessful(action: ToolAction): boolean {
    const statuses = reviewEnvelopeStatuses(action)
    return (
      statuses.some((status) => status === "passed") &&
      statuses.every((status) => status === "passed" || status === "skipped")
    )
  }

  function reviewEnvelopeStatuses(action: ToolAction): string[] {
    const envelopes = action.metadata?.verificationEnvelopes
    if (!Array.isArray(envelopes)) return []
    return envelopes.flatMap((item) => {
      if (!isRecord(item) || item.workflow !== "review") return []
      const result = item.result
      if (!isRecord(result) || typeof result.status !== "string") return []
      return [result.status]
    })
  }

  function commandText(action: ToolAction): string {
    return typeof action.input.command === "string" ? action.input.command : ""
  }

  function describeAction(action: ToolAction): string {
    if (action.tool === "bash") {
      const command = commandText(action)
      const exit = action.metadata?.exit
      const suffix = typeof exit === "number" ? ` (exit ${exit})` : ""
      return command ? `validation command: ${command}${suffix}` : `validation tool: ${action.tool}${suffix}`
    }
    return `last file-changing tool: ${action.tool}`
  }

  function missingReviewVerificationHint(
    latestReviewSignal: ToolAction,
    reviewFindings: ToolAction[],
    reviewVerifications: ToolAction[],
  ): Hint {
    return {
      id: "missing-review-verification",
      category: "missing_verification",
      confidence: 0.86,
      title: "Run review-scoped verification before closing review",
      body: 'Review work was recorded without a clean review verification result. Run verify_project with workflow: "review", then cite its envelope ids in review_complete.',
      evidence: [
        describeReviewSignal(latestReviewSignal),
        describeReviewFindings(reviewFindings),
        describeReviewVerificationCount(reviewVerifications),
      ],
    }
  }

  function failedReviewVerificationHint(action: ToolAction): Hint {
    return {
      id: "failed-review-verification",
      category: "failed_validation",
      confidence: 0.9,
      title: "Resolve failed review verification before closing review",
      body: "A review-scoped verification result is not fully passing. Fix the failure, rerun review verification, or close the review as needing changes instead of approving it.",
      evidence: [
        describeReviewSignal(action),
        `review verification statuses: ${reviewEnvelopeStatuses(action).join(", ")}`,
      ],
    }
  }

  function describeReviewSignal(action: ToolAction): string {
    if (action.tool === "review_complete") return "review_complete result needs verification"
    if (action.tool === "verify_project") return `review verification tool: ${action.tool}`
    return `review signal: ${action.tool}`
  }

  function describeReviewFindings(actions: ToolAction[]): string {
    return `review findings: ${actions.length}`
  }

  function describeReviewVerificationCount(actions: ToolAction[]): string {
    return `review verification results: ${actions.length}`
  }

  function describeChangedFiles(writes: ToolAction[]): string {
    const files = Array.from(new Set(writes.flatMap((write) => changedFiles(write)).filter(Boolean)))
    if (files.length === 0) return `file-changing tools: ${writes.map((write) => write.tool).join(", ")}`
    const shown = files.slice(0, 5)
    const suffix = files.length > shown.length ? `, +${files.length - shown.length} more` : ""
    return `changed paths: ${shown.join(", ")}${suffix}`
  }

  function changedFiles(action: ToolAction): string[] {
    const candidates = [action.input.filePath, action.input.file, action.input.path, action.input.targetPath]
    return candidates.filter((item): item is string => typeof item === "string" && item.length > 0)
  }

  function isRecord(input: unknown): input is Record<string, unknown> {
    return typeof input === "object" && input !== null && !Array.isArray(input)
  }

  function safeText(text: string): string {
    const escaped = text.replace(DECISION_HINT_TAG, (match) =>
      match.startsWith("</") ? "[/decision-hints]" : "[decision-hints]",
    )
    return escaped
      .replace(/[<>]/g, (char) => (char === "<" ? "[" : "]"))
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 240)
  }
}
