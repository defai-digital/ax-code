import z from "zod"
import { Tool } from "./tool"
import { Question } from "../question"
import DESCRIPTION from "./question.txt"

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

    const formatted = params.questions.map((q, i) => `"${q.question}"="${format(answers[i])}"`).join(", ")
    const autonomous = process.env["AX_CODE_AUTONOMOUS"] === "true"
    const actor = autonomous ? "Autonomous mode selected answers for" : "User has answered"
    const reminder = autonomous ? " Record these autonomous decisions in your final response." : ""

    return {
      title: `Asked ${params.questions.length} question${params.questions.length > 1 ? "s" : ""}`,
      output: `${actor} your questions: ${formatted}. You can now continue with these answers in mind.${reminder}`,
      metadata: {
        answers,
        autonomous,
      },
    }
  },
})
