import z from "zod"
import { Locale } from "../util/locale"
import { JsonBoolean } from "../util/schema"
import { Tool } from "./tool"
import { Question } from "../question"
import { QuestionID } from "../question/schema"
import { Session } from "../session"
import DESCRIPTION from "./question.txt"
import { ScopedFlag } from "../flag/scoped"
import { sliceCodeUnits } from "../util/format"

const MAX_AUTONOMOUS_DECISION_TEXT = 500

function normalizePromptText(value: string) {
  return value.replace(/\s+/g, " ").trim()
}

function escapePromptText(value: string) {
  return normalizePromptText(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
}

function clipPromptText(value: string): string
function clipPromptText(value: string | undefined): string | undefined
function clipPromptText(value: string | undefined) {
  if (value === undefined) return undefined
  const escaped = escapePromptText(value)
  if (escaped.length <= MAX_AUTONOMOUS_DECISION_TEXT) return escaped
  // Bound the escaped text, but never end on half an entity or half a
  // surrogate pair.
  const cut = sliceCodeUnits(escaped, MAX_AUTONOMOUS_DECISION_TEXT).replace(/&[a-z]*$/, "")
  return `${cut}...`
}

type AutonomousDecision = {
  question: string
  header: string
  multiple: boolean
  selected: (string | undefined)[]
  confidence: string
  rationale: string
  selectedOptions: { label: string; description: string | undefined }[]
  optionCount: number
}

type QuestionToolMetadata = {
  answers?: Question.Answer[]
  autonomous?: boolean
  autonomousDecisions?: AutonomousDecision[]
  /** ADR-222: true when the question was recorded via askDeferred and the tool returned without answers. */
  deferred?: boolean
  requestID?: QuestionID
}

export const QuestionTool = Tool.define("question", {
  description: DESCRIPTION,
  parameters: z.object({
    questions: z.array(Question.Info.omit({ custom: true })).describe("Questions to ask"),
    defer: JsonBoolean.optional().describe(
      "Record the question and return immediately instead of blocking for the answer (ADR-222). The answer arrives later as a user message; not available in subagent sessions, ignored in autonomous mode",
    ),
  }),
  async execute(params, ctx): Promise<{ title: string; output: string; metadata: QuestionToolMetadata }> {
    if (params.defer === true) {
      const session = await Session.get(ctx.sessionID)
      if (session.parentID) {
        return {
          title: "Deferred question unavailable",
          output:
            "Error: deferred questions are not available in subagent sessions. Ask the question again without defer (it will be routed to the parent session's user) or proceed with your own best judgment.",
          metadata: { deferred: false },
        }
      }
      if (!ScopedFlag.autonomous()) {
        const requestID = await Question.askDeferred({
          sessionID: ctx.sessionID,
          questions: params.questions,
          tool: ctx.callID ? { messageID: ctx.messageID, callID: ctx.callID } : undefined,
        })
        const summary = params.questions.map((q) => `"${escapePromptText(q.question)}"`).join(", ")
        return {
          title: Locale.pluralize(params.questions.length, "Deferred {} question", "Deferred {} questions"),
          output: `Question(s) deferred to the user: ${summary}. This tool call has already returned and the turn continues. The user's answer will arrive later as a new user message - do not wait for it and do not depend on it in this turn. Continue with work that does not rely on the answer.`,
          metadata: { deferred: true, requestID },
        }
      }
      // Autonomous mode: drop defer and keep today's auto-answer behaviour.
    }

    const answers = await Question.ask({
      sessionID: ctx.sessionID,
      questions: params.questions,
      tool: ctx.callID ? { messageID: ctx.messageID, callID: ctx.callID } : undefined,
      signal: ctx.abort,
    })

    function format(answer: Question.Answer | undefined) {
      if (!answer?.length) return "Unanswered"
      return answer.join(", ")
    }

    const formatted = params.questions
      .map((q, i) => `"${escapePromptText(q.question)}"="${escapePromptText(format(answers[i]))}"`)
      .join(", ")
    const autonomous = ScopedFlag.autonomous()
    const actor = autonomous ? "Autonomous mode selected answers for" : "User has answered"
    const reminder = autonomous ? " Record these autonomous decisions in your final response." : ""
    const deferNote =
      params.defer === true && autonomous
        ? " (defer was ignored in autonomous mode; the question was answered by the autonomous runtime.)"
        : ""
    const recommendedDecisions = autonomous ? Question.autonomousDecisions(params.questions) : []
    const autonomousDecisions = autonomous
      ? params.questions.map((question, index) => {
          const selected = answers[index] ?? []
          const recommended = recommendedDecisions[index]
          const matchesRecommended = selected.join("\0") === (recommended?.answer ?? []).join("\0")
          const fallbackRationale =
            "Selected answer came from the question flow but did not match the current autonomous recommendation."
          return {
            question: clipPromptText(question.question),
            header: clipPromptText(question.header),
            multiple: question.multiple === true,
            selected: selected.map(clipPromptText),
            confidence: matchesRecommended ? (recommended?.confidence ?? "low") : "low",
            rationale: clipPromptText(
              matchesRecommended ? (recommended?.rationale ?? fallbackRationale) : fallbackRationale,
            ),
            selectedOptions: selected.map((label) => {
              const option = question.options.find((item) => item.label === label)
              return {
                label: clipPromptText(label),
                description: clipPromptText(option?.description),
              }
            }),
            optionCount: question.options.length,
          }
        })
      : undefined

    return {
      title: Locale.pluralize(params.questions.length, "Asked {} question", "Asked {} questions"),
      output: `${actor} your questions: ${formatted}. You can now continue with these answers in mind.${reminder}${deferNote}`,
      metadata: {
        answers,
        autonomous,
        ...(autonomousDecisions ? { autonomousDecisions } : {}),
      },
    }
  },
})
