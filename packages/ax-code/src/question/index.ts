import { Effect, Layer, Schema, ServiceMap } from "effect"
import { Bus } from "@/bus"
import { BusEvent } from "@/bus/bus-event"
import { Instance } from "@/project/instance"
import { SessionID, MessageID } from "@/session/schema"
import { Log } from "@/util/log"
import z from "zod"
import { AutonomousQuestion } from "./autonomous"
import { QuestionID } from "./schema"

export namespace Question {
  const log = Log.create({ service: "question" })

  // Schemas

  export const Option = z
    .object({
      label: z.string().describe("Display text (1-5 words, concise)"),
      description: z.string().describe("Explanation of choice"),
    })
    .meta({ ref: "QuestionOption" })
  export type Option = z.infer<typeof Option>

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

  async function askPromise(input: AskInput): Promise<Answer[]> {
    if (process.env["AX_CODE_AUTONOMOUS"] === "true") {
      const answers = autonomousAnswers(input.questions)
      log.info("autonomous auto-answer", { questions: input.questions.length, answers })
      return answers
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

  async function replyPromise(input: { requestID: QuestionID; answers: Answer[] }) {
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

  async function rejectPromise(requestID: QuestionID) {
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

  async function listPromise() {
    const pending = (await state()).pending
    return Array.from(pending.values(), (x) => x.info)
  }

  // Service

  export interface Interface {
    readonly ask: (input: AskInput) => Effect.Effect<Answer[], RejectedError>
    readonly reply: (input: { requestID: QuestionID; answers: Answer[] }) => Effect.Effect<void>
    readonly reject: (requestID: QuestionID) => Effect.Effect<void>
    readonly list: () => Effect.Effect<Request[]>
  }

  export class Service extends ServiceMap.Service<Service, Interface>()("@ax-code/Question") {}

  export const layer = Layer.effect(
    Service,
    Effect.sync(() => {
      const ask = Effect.fn("Question.ask")((input: AskInput) =>
        Effect.tryPromise({
          try: () => askPromise(input),
          catch: (error) => error as RejectedError,
        }),
      )

      const reply = Effect.fn("Question.reply")((input: { requestID: QuestionID; answers: Answer[] }) =>
        Effect.promise(() => replyPromise(input)),
      )

      const reject = Effect.fn("Question.reject")((requestID: QuestionID) => Effect.promise(() => rejectPromise(requestID)))

      const list = Effect.fn("Question.list")(() => Effect.promise(() => listPromise()))

      return Service.of({ ask, reply, reject, list })
    }),
  )

  export async function ask(input: AskInput): Promise<Answer[]> {
    return askPromise(input)
  }

  export async function reply(input: { requestID: QuestionID; answers: Answer[] }) {
    return replyPromise(input)
  }

  export async function reject(requestID: QuestionID) {
    return rejectPromise(requestID)
  }

  export async function list() {
    return listPromise()
  }
}
