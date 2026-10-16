import { Bus } from "@/bus"
import { BusEvent } from "@/bus/bus-event"
import { Config } from "@/config/config"
import { Instance } from "@/project/instance"
import { Recorder } from "@/replay/recorder"
import { SessionID, MessageID } from "@/session/schema"
import { Log } from "@/util/log"
import { Env } from "@/util/env"
import { JsonBoolean } from "@/util/schema"
import z from "zod"
import { AutonomousQuestion } from "./autonomous"
import * as Clarify from "./clarify"
import { QuestionID } from "./schema"
import { ScopedFlag } from "@/flag/scoped"

export namespace Question {
  const log = Log.create({ service: "question" })

  // Schemas

  const Option = z
    .object({
      label: z.string().describe("Display text (1-5 words, concise)"),
      description: z.string().describe("Explanation of choice"),
    })
    .meta({ ref: "QuestionOption" })

  export const Info = z
    .object({
      question: z.string().describe("Complete question"),
      header: z.string().describe("Very short label (max 30 chars)"),
      options: z.array(Option).describe("Available choices"),
      multiple: JsonBoolean.optional().describe("Allow selecting multiple choices"),
      custom: JsonBoolean.optional().describe("Allow typing a custom answer (default: true)"),
    })
    .meta({ ref: "QuestionInfo" })
  export type Info = z.infer<typeof Info>

  export const Request = z
    .object({
      id: QuestionID.zod,
      sessionID: SessionID.zod,
      questions: z.array(Info).describe("Questions to ask"),
      tool: z
        .object({
          messageID: MessageID.zod,
          callID: z.string(),
        })
        .optional(),
      // ADR-222: the asking tool call already returned; the answer arrives
      // later as a steering/follow-up message instead of the tool result.
      deferred: z.boolean().optional().describe("Answer is delivered later, not through the tool result"),
    })
    .meta({ ref: "QuestionRequest" })
  export type Request = z.infer<typeof Request>

  export const Answer = z.array(z.string()).meta({ ref: "QuestionAnswer" })
  export type Answer = z.infer<typeof Answer>

  export function autonomousAnswers(questions: Info[]): Answer[] {
    return AutonomousQuestion.answers(questions)
  }

  export function autonomousDecisions(questions: Info[]): AutonomousQuestion.Decision[] {
    return AutonomousQuestion.decisions(questions)
  }

  /** Heuristic ambiguity detection for proactive clarification. */
  export function detectAmbiguity(message: string) {
    return Clarify.detectAmbiguity(message)
  }

  export function shouldClarify(message: string): boolean {
    return Clarify.shouldClarify(message)
  }

  /** Build a structured clarification question. The result is compatible with `ask()`. */
  export function buildClarification(input: Clarify.ClarifyInput): Info {
    return Clarify.build(input) as Info
  }

  function cleanAnswerLabels(answer: Answer): string[] {
    return answer.map((label) => label.replace(/\s*\(Recommended\)\s*$/i, "").trim()).filter(Boolean)
  }

  /**
   * Convert clarification Q&A pairs into constraint strings suitable for
   * `Planner.create({ constraints })`. Strips the `(Recommended)` suffix
   * that `buildClarification` adds so the resulting constraint reads cleanly.
   *
   * Mismatched lengths are tolerated — extra questions/answers are ignored.
   */
  export function toConstraints(questions: Info[], answers: Answer[]): string[] {
    const out: string[] = []
    const len = Math.min(questions.length, answers.length)
    for (let i = 0; i < len; i++) {
      const q = questions[i]
      const a = answers[i]
      if (!q || !a || a.length === 0) continue
      const cleaned = cleanAnswerLabels(a)
      if (cleaned.length === 0) continue
      // `??` only catches null/undefined, not empty/whitespace strings — fall
      // through to question text whenever the header has no usable label.
      const header = q.header?.trim() || q.question?.trim() || ""
      if (!header) continue
      out.push(`${header}: ${cleaned.join(", ")}`)
    }
    return out
  }

  export const Reply = z.object({
    answers: z
      .array(Answer)
      .describe("User answers in order of questions (each answer is an array of selected labels)"),
  })
  export type Reply = z.infer<typeof Reply>

  export const Event = {
    Asked: BusEvent.define("question.asked", Request),
    Replied: BusEvent.define(
      "question.replied",
      z.object({
        sessionID: SessionID.zod,
        requestID: QuestionID.zod,
        answers: z.array(Answer),
      }),
    ),
    Rejected: BusEvent.define(
      "question.rejected",
      z.object({
        sessionID: SessionID.zod,
        requestID: QuestionID.zod,
      }),
    ),
  }

  export class RejectedError extends Error {
    override readonly name = "QuestionRejectedError"

    constructor(options?: ErrorOptions) {
      super("The user dismissed this question", options)
      this.name = "QuestionRejectedError"
    }

    override get message() {
      return "The user dismissed this question"
    }
  }

  interface PromiseDeferred<T> {
    promise: Promise<T>
    resolve(value: T): void
    reject(reason: unknown): void
  }

  interface PendingEntry {
    info: Request
    deferred: PromiseDeferred<Answer[]>
    /** ADR-222: the answer is delivered as a message, not resolved into a tool result. */
    isDeferred?: boolean
  }

  interface AskInput {
    sessionID: SessionID
    questions: Info[]
    tool?: { messageID: MessageID; callID: string }
    signal?: AbortSignal
  }

  const state = Instance.state(
    () => ({
      pending: new Map<QuestionID, PendingEntry>(),
    }),
    async (state) => {
      for (const item of state.pending.values()) {
        item.deferred.reject(new RejectedError())
      }
      state.pending.clear()
    },
  )

  function createDeferred<T>(): PromiseDeferred<T> {
    let resolve!: (value: T) => void
    let reject!: (reason: unknown) => void
    const promise = new Promise<T>((res, rej) => {
      resolve = res
      reject = rej
    })
    return { promise, resolve, reject }
  }

  export async function ask(input: AskInput): Promise<Answer[]> {
    if (ScopedFlag.autonomous()) {
      const decisions = autonomousDecisions(input.questions)
      const escalateOnLow = (await Config.get()).experimental?.autonomous_escalate_low_confidence !== false
      // A question with <= 1 options is not ambiguous — escalating would
      // block forever without giving the user a meaningful choice. Skip
      // escalation in that case even when the heuristic returns "low".
      const lowConfidenceIndex = decisions.findIndex(
        (d, i) => d.confidence === "low" && (input.questions[i]?.options.length ?? 0) > 1,
      )
      if (escalateOnLow && lowConfidenceIndex >= 0) {
        const escalated = decisions[lowConfidenceIndex]
        log.info("autonomous escalating to user", {
          questions: input.questions.length,
          lowConfidenceIndex,
          rationale: escalated?.rationale,
        })
        Recorder.emit({
          type: "autonomous.escalation",
          sessionID: input.sessionID,
          reason: "low_confidence",
          questionHeader: input.questions[lowConfidenceIndex]?.header,
          rationale: escalated?.rationale,
        })
        // Fall through to the human-ask path below.
      } else {
        const answers = decisions.map((d) => d.answer)
        log.info("autonomous auto-answer", { questions: input.questions.length, answers })
        return answers
      }
    }

    const current = await state()
    const id = QuestionID.ascending()
    log.info("asking", { id, questions: input.questions.length })

    const deferred = createDeferred<Answer[]>()
    const info: Request = {
      id,
      sessionID: input.sessionID,
      questions: input.questions,
      tool: input.tool,
    }
    const entry: PendingEntry = { info, deferred }
    current.pending.set(id, entry)
    Bus.publishDetached(Event.Asked, info)
    fireNotificationHook(info)

    // Release the question when the turn aborts, mirroring Permission.ask.
    // Without it the tool never returns, the AI SDK's tool-results stream
    // never closes, and the session stays busy behind an unanswerable prompt.
    const signal = input.signal
    const onAbort = () => {
      if (current.pending.get(id) !== entry || !current.pending.delete(id)) return
      Bus.publishDetached(Event.Rejected, { sessionID: info.sessionID, requestID: id })
      deferred.reject(new RejectedError())
    }
    signal?.addEventListener("abort", onAbort, { once: true })
    if (signal?.aborted) onAbort()

    try {
      return await deferred.promise
    } finally {
      signal?.removeEventListener("abort", onAbort)
      current.pending.delete(id)
    }
  }

  /**
   * ADR-212: observation-only Notification hook (question asked). The
   * payload carries a bounded, redacted first-question label only — never
   * the full questions, which are model-authored text. Fire-and-forget.
   */
  function fireNotificationHook(info: Request) {
    void import("@/hooks/lifecycle")
      .then(({ LifecycleHooks }) => {
        const first = info.questions[0]
        const header = first ? first.header?.trim() || first.question?.trim() || "" : ""
        return LifecycleHooks.runForWorkspace({
          event: "Notification",
          sessionID: info.sessionID,
          args: {
            sessionID: info.sessionID,
            kind: "question",
            questionCount: info.questions.length,
            ...(header ? { header: Env.redactForRecord(header).slice(0, 120) } : {}),
          },
        })
      })
      .catch((error) => log.warn("Notification lifecycle hooks failed", { id: info.id, error }))
  }

  /**
   * ADR-222: record a question without blocking the turn. The request shows
   * up in the UI like any other pending question, but the asking tool call
   * has already returned; when the user answers, `reply()` delivers the
   * answer to the session as a message instead of resolving a tool result.
   *
   * Unlike `ask()`, no abort signal is attached: a deferred question is
   * allowed to outlive the turn that asked it, and it expires with the
   * session (Instance dispose clears the pending map).
   */
  export async function askDeferred(input: Omit<AskInput, "signal">): Promise<QuestionID> {
    const current = await state()
    const id = QuestionID.ascending()
    log.info("asking deferred", { id, questions: input.questions.length })

    const deferred = createDeferred<Answer[]>()
    // Nothing awaits this promise; the dispose-time rejection below would
    // otherwise surface as an unhandled rejection.
    deferred.promise.catch(() => {})
    const info: Request = {
      id,
      sessionID: input.sessionID,
      questions: input.questions,
      tool: input.tool,
      deferred: true,
    }
    const entry: PendingEntry = { info, deferred, isDeferred: true }
    current.pending.set(id, entry)
    Bus.publishDetached(Event.Asked, info)
    fireNotificationHook(info)
    return id
  }

  export async function reply(input: { requestID: QuestionID; answers: Answer[] }): Promise<boolean> {
    const pending = (await state()).pending
    const existing = pending.get(input.requestID)
    if (!existing) {
      log.warn("reply for unknown request", { requestID: input.requestID })
      return false
    }
    // Remove before resolving so a concurrent reply/reject racing on the
    // same requestID (e.g. a duplicate client request) sees it as already
    // gone instead of also acting on it — `ask()`'s own cleanup only runs
    // after this deferred settles, which is too late to close that window.
    // Mirrors the permission module's fix for the same race (#341).
    pending.delete(input.requestID)
    log.info("replied", { requestID: input.requestID, answers: input.answers })
    Bus.publishDetached(Event.Replied, {
      sessionID: existing.info.sessionID,
      requestID: existing.info.id,
      answers: input.answers,
    })
    if (existing.isDeferred) {
      // ADR-222: the asking tool call already returned; hand the answer to
      // the session as a message. Fire-and-forget: the entry is gone, so a
      // delivery failure is logged, never retried and never re-delivered.
      existing.deferred.resolve(input.answers)
      void deliverDeferredAnswer(existing.info, input.answers)
      return true
    }
    existing.deferred.resolve(input.answers)
    return true
  }

  /**
   * ADR-222: deliver a deferred question's answer to the session as a user
   * message, exactly once. Busy session: the existing steering path (ADR-134/
   * 146) admits the text into the running generation, including its durable
   * follow-up row. Idle session (or a refused steer): the same follow-up
   * queue row a queued user message takes, so the answer runs as the next
   * turn instead of starting one out of band.
   */
  async function deliverDeferredAnswer(info: Request, answers: Answer[]): Promise<void> {
    try {
      const text = deferredAnswerText(info.questions, answers)
      const { SessionSteering } = await import("@/session/steering")
      const generation = SessionSteering.view(info.sessionID).generation
      if (generation) {
        try {
          const { SessionPrompt } = await import("@/session/prompt")
          const receipt = await SessionPrompt.steer(info.sessionID, {
            expectedGeneration: generation,
            clientID: `question_${info.id}`,
            text,
          })
          if (receipt.status === "accepted" || receipt.status === "applied") return
          log.warn("deferred answer steer was not admitted", { id: info.id, reason: receipt.reason })
        } catch (error) {
          log.warn("deferred answer steer failed", { id: info.id, error })
        }
      }
      const { TaskQueue } = await import("@/session/task-queue")
      const item = await TaskQueue.enqueueIdempotent({
        sessionID: info.sessionID,
        kind: "followup",
        title: "Deferred question answer",
        sourceMessageID: `question_${info.id}`,
        payload: { body: { parts: [{ type: "text", text }] } },
      })
      const { TaskQueueExecutor } = await import("@/session/task-queue-executor")
      await TaskQueueExecutor.start(item)
    } catch (error) {
      log.error("could not deliver deferred question answer", { id: info.id, error })
    }
  }

  /** Compose the delivered answer text (ADR-222). */
  export function deferredAnswerText(questions: Info[], answers: Answer[]): string {
    const lines = questions.map((question, i) => {
      const answer = answers[i]?.length ? answers[i].join(", ") : "Unanswered"
      return `${question.question} -> ${answer}`
    })
    const lead = lines.length === 1 ? "Answer to your deferred question: " : "Answers to your deferred questions: "
    const text = lead + lines.join("; ")
    // Steering input caps text at 16k characters; answers are validated but
    // question text is model-authored, so clip defensively.
    return text.length > 16_000 ? `${text.slice(0, 15_997)}...` : text
  }

  export async function reject(requestID: QuestionID): Promise<boolean> {
    const pending = (await state()).pending
    const existing = pending.get(requestID)
    if (!existing) {
      log.warn("reject for unknown request", { requestID })
      return false
    }
    // See the matching comment in reply() — remove before rejecting so a
    // racing reply/reject on the same requestID cannot also act on it.
    pending.delete(requestID)
    log.info("rejected", { requestID })
    Bus.publishDetached(Event.Rejected, {
      sessionID: existing.info.sessionID,
      requestID: existing.info.id,
    })
    existing.deferred.reject(new RejectedError())
    return true
  }

  export async function list() {
    const pending = (await state()).pending
    return Array.from(pending.values(), (x) => x.info)
  }
}
