import { Hono } from "hono"
import { describeRoute, validator } from "hono-openapi"
import { resolver } from "hono-openapi"
import { QuestionID } from "@/question/schema"
import { Question } from "../../question"
import z from "zod"
import { errors } from "../error"
import { lazy } from "../../util/lazy"
import { parseRouteParam } from "./route-params"

const QUESTION_REQUEST_ID_PARAM = z.object({
  requestID: QuestionID.zod,
})

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
      async (c) => {
        const json = c.req.valid("json")
        const requestID = parseRouteParam<"requestID", QuestionID>(c, "requestID")
        await Question.reply({ requestID, answers: json.answers })
        return c.json(true)
      },
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
      async (c) => {
        const requestID = parseRouteParam<"requestID", QuestionID>(c, "requestID")
        await Question.reject(requestID)
        return c.json(true)
      },
    ),
)
