import z from "zod"
import { Tool } from "./tool"
import { Question } from "../question"
import DESCRIPTION from "./question.txt"

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
  return `${escaped.slice(0, MAX_AUTONOMOUS_DECISION_TEXT)}...`
}

export const QuestionTool = Tool.define("question", {
  description: DESCRIPTION,
  parameters: z.object({
    questions: z.array(Question.Info.omit({ custom: true })).describe("Questions to ask"),
  }),
  async execute(params, ctx) {
    const answers = await Question.ask({
      sessionID: ctx.sessionID,
      questions: params.questions,
      tool: ctx.callID ? { messageID: ctx.messageID, callID: ctx.callID } : undefined,
    })

    function format(answer: Question.Answer | undefined) {
      if (!answer?.length) return "Unanswered"
      return answer.join(", ")
    }

    const formatted = params.questions
      .map((q, i) => `"${escapePromptText(q.question)}"="${escapePromptText(format(answers[i]))}"`)
      .join(", ")
    const autonomous = process.env["AX_CODE_AUTONOMOUS"] === "true"
    const actor = autonomous ? "Autonomous mode selected answers for" : "User has answered"
    const reminder = autonomous ? " Record these autonomous decisions in your final response." : ""
    const autonomousDecisions = autonomous
      ? params.questions.map((question, index) => {
          const selected = answers[index] ?? []
          return {
            question: clipPromptText(question.question),
            header: clipPromptText(question.header),
            multiple: question.multiple === true,
            selected: selected.map(clipPromptText),
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
      title: `Asked ${params.questions.length} question${params.questions.length > 1 ? "s" : ""}`,
      output: `${actor} your questions: ${formatted}. You can now continue with these answers in mind.${reminder}`,
      metadata: {
        answers,
        autonomous,
        ...(autonomousDecisions ? { autonomousDecisions } : {}),
      },
    }
  },
})
