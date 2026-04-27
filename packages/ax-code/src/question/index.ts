import { Schema } from "effect"
import { Bus } from "@/bus"
import { BusEvent } from "@/bus/bus-event"
import { Config } from "@/config/config"
import { Instance } from "@/project/instance"
import { Recorder } from "@/replay/recorder"
import { SessionID, MessageID } from "@/session/schema"
import { Log } from "@/util/log"
import z from "zod"
import { AutonomousQuestion } from "./autonomous"
import * as Clarify from "./clarify"
import { QuestionID } from "./schema"

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
      multiple: z.boolean().optional().describe("Allow selecting multiple choices"),
      custom: z.boolean().optional().describe("Allow typing a custom answer (default: true)"),
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
      const cleaned = a.map((label) => label.replace(/\s*\(Recommended\)\s*$/i, "").trim()).filter(Boolean)
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

  export class RejectedError extends Schema.TaggedErrorClass<RejectedError>()("QuestionRejectedError", {}) {
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
  }

  interface State {
    pending: Map<QuestionID, PendingEntry>
  }

  interface AskInput {
    sessionID: SessionID
    questions: Info[]
    tool?: { messageID: MessageID; callID: string }
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
    if (process.env["AX_CODE_AUTONOMOUS"] === "true") {
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
    current.pending.set(id, { info, deferred })
    Bus.publishDetached(Event.Asked, info)

    try {
      return await deferred.promise
    } finally {
      current.pending.delete(id)
    }
  }

  export async function reply(input: { requestID: QuestionID; answers: Answer[] }) {
    const pending = (await state()).pending
    const existing = pending.get(input.requestID)
    if (!existing) {
      log.warn("reply for unknown request", { requestID: input.requestID })
      return
    }
    pending.delete(input.requestID)
    log.info("replied", { requestID: input.requestID, answers: input.answers })
    Bus.publishDetached(Event.Replied, {
      sessionID: existing.info.sessionID,
      requestID: existing.info.id,
      answers: input.answers,
    })
    existing.deferred.resolve(input.answers)
  }

  export async function reject(requestID: QuestionID) {
    const pending = (await state()).pending
    const existing = pending.get(requestID)
    if (!existing) {
      log.warn("reject for unknown request", { requestID })
      return
    }
    pending.delete(requestID)
    log.info("rejected", { requestID })
    Bus.publishDetached(Event.Rejected, {
      sessionID: existing.info.sessionID,
      requestID: existing.info.id,
    })
    existing.deferred.reject(new RejectedError())
  }

  export async function list() {
    const pending = (await state()).pending
    return Array.from(pending.values(), (x) => x.info)
  }
}
