import { Hono } from "hono"
import { describeRoute } from "hono-openapi"
import { validator } from "../validation"
import { resolver } from "hono-openapi"
import { Question } from "../../question"
import z from "zod"
import { errors, invalidRequest, notFound } from "../error"
import { lazy } from "../../util/lazy"
import { QUESTION_REQUEST_ID_PARAM, withQuestionRequestID } from "./route-params"

export const QuestionRoutes = lazy(() =>
  new Hono()
    .get(
      "/",
      describeRoute({
        summary: "List pending questions",
        description: "Get all pending question requests across all sessions.",
        operationId: "question.list",
        responses: {
          200: {
            description: "List of pending questions",
            content: {
              "application/json": {
                schema: resolver(Question.Request.array()),
              },
            },
          },
        },
      }),
      async (c) => {
        const questions = await Question.list()
        return c.json(questions)
      },
    )
    .post(
      "/:requestID/reply",
      describeRoute({
        summary: "Reply to question request",
        description: "Provide answers to a question request from the AI assistant.",
        operationId: "question.reply",
        responses: {
          200: {
            description: "Question answered successfully",
            content: {
              "application/json": {
                schema: resolver(z.boolean()),
              },
            },
          },
          ...errors(400, 404),
        },
      }),
      validator("param", QUESTION_REQUEST_ID_PARAM),
      validator("json", Question.Reply),
      withQuestionRequestID(async (requestID, c) => {
        const json = c.req.valid("json") as Question.Reply
        const pending = await Question.list()
        const request = pending.find((r) => r.id === requestID)
        if (!request) {
          return notFound(c, {
            name: "QuestionUnavailableError",
            message: "Question request is unavailable",
            resource: "question",
          })
        }
        // Validate the reply against the pending question definitions so
        // malformed answers from SDK/external clients are rejected instead of
        // silently becoming constraints for the assistant. See #242.
        const validation = validateQuestionAnswers(request.questions, json.answers)
        if (!validation.ok) {
          return invalidRequest(c, { message: validation.message })
        }
        await Question.reply({ requestID, answers: validation.answers })
        return c.json(true)
      }),
    )
    .post(
      "/:requestID/reject",
      describeRoute({
        summary: "Reject question request",
        description: "Reject a question request from the AI assistant.",
        operationId: "question.reject",
        responses: {
          200: {
            description: "Question rejected successfully",
            content: {
              "application/json": {
                schema: resolver(z.boolean()),
              },
            },
          },
          ...errors(400, 404),
        },
      }),
      validator("param", QUESTION_REQUEST_ID_PARAM),
      withQuestionRequestID(async (requestID, c) => {
        const pending = await Question.list()
        if (!pending.some((request) => request.id === requestID)) {
          return notFound(c, {
            name: "QuestionUnavailableError",
            message: "Question request is unavailable",
            resource: "question",
          })
        }
        await Question.reject(requestID)
        return c.json(true)
      }),
    ),
)

/**
 * Validate user answers against a pending question definition.
 * Returns an error message string when invalid, or null when the answers are
 * acceptable. Rules (see #242):
 *  - answer count must match question count
 *  - empty strings and whitespace-only values are rejected
 *  - duplicate selections within a single answer are rejected
 *  - when multiple !== true, an answer may contain at most one value
 *  - when custom === false, every value must match one of the option labels
 */
function validateQuestionAnswers(
  questions: Question.Info[],
  answers: Question.Answer[],
): { ok: true; answers: Question.Answer[] } | { ok: false; message: string } {
  if (answers.length !== questions.length) {
    return { ok: false, message: `Expected ${questions.length} answer(s) but received ${answers.length}` }
  }
  const normalized: Question.Answer[] = []
  for (let i = 0; i < questions.length; i++) {
    const question = questions[i]
    const answer = answers[i] ?? []
    const index = i + 1
    // Reject empty / whitespace-only answers.
    const cleaned = answer.map((v) => v.trim())
    if (cleaned.some((v) => !v)) {
      return { ok: false, message: `Question ${index}: answers must not be empty` }
    }
    // Reject duplicate selections within a single answer.
    if (new Set(cleaned).size !== cleaned.length) {
      return { ok: false, message: `Question ${index}: duplicate selections are not allowed` }
    }
    // Single-select (multiple !== true) must contain at most one value.
    if (question.multiple !== true && cleaned.length > 1) {
      return { ok: false, message: `Question ${index}: only one selection is allowed` }
    }
    // When custom answers are disabled, every value must be a known option.
    if (question.custom === false) {
      const labels = new Set(question.options.map((o) => o.label))
      const unknown = cleaned.filter((v) => !labels.has(v))
      if (unknown.length > 0) {
        return { ok: false, message: `Question ${index}: invalid option "${unknown[0]}"` }
      }
    }
    normalized.push(cleaned)
  }
  return { ok: true, answers: normalized }
}
