import { Hono } from "hono"
import { describeRoute, resolver } from "hono-openapi"
import { validator } from "../validation"
import z from "zod"
import { lazy } from "@/util/lazy"
import { PromptHistory } from "@/prompt-history"
import { PromptHistoryEntry } from "@/prompt-history/schema"
import { errors } from "../error"
import { OptionalQueryNumber } from "./query"

const PromptHistoryListQuery = z.object({
  limit: OptionalQueryNumber(z.number().int().positive().max(PromptHistory.MAX_ENTRIES)),
})

export const PromptHistoryRoutes = lazy(() =>
  new Hono()
    .get(
      "/",
      describeRoute({
        summary: "List prompt history",
        description: "Return prompt recall history scoped to the current project.",
        operationId: "promptHistory.list",
        responses: {
          200: {
            description: "Project-scoped prompt history entries.",
            content: {
              "application/json": {
                schema: resolver(PromptHistoryEntry.array()),
              },
            },
          },
          ...errors(400),
        },
      }),
      validator("query", PromptHistoryListQuery),
      async (c) => {
        const query = c.req.valid("query")
        return c.json(PromptHistory.list({ limit: query.limit }))
      },
    )
    .post(
      "/",
      describeRoute({
        summary: "Append prompt history",
        description: "Append one prompt recall entry to the current project history.",
        operationId: "promptHistory.append",
        responses: {
          200: {
            description: "Stored prompt history entry.",
            content: {
              "application/json": {
                schema: resolver(PromptHistoryEntry),
              },
            },
          },
          ...errors(400),
        },
      }),
      validator("json", PromptHistoryEntry),
      async (c) => {
        const entry = c.req.valid("json")
        return c.json(PromptHistory.append(entry))
      },
    ),
)
