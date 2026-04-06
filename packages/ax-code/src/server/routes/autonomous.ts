import { Hono } from "hono"
import { describeRoute, resolver, validator } from "hono-openapi"
import z from "zod"
import { Log } from "../../util/log"
import { lazy } from "../../util/lazy"

const log = Log.create({ service: "autonomous" })

const AutonomousState = z
  .object({
    enabled: z.boolean(),
  })
  .meta({ ref: "AutonomousState" })

export const AutonomousRoutes = lazy(() =>
  new Hono()
    .get(
      "/",
      describeRoute({
        summary: "Get autonomous mode state",
        description: "Returns whether autonomous mode is enabled.",
        operationId: "autonomous.get",
        responses: {
          200: {
            description: "Autonomous mode state",
            content: {
              "application/json": {
                schema: resolver(AutonomousState),
              },
            },
          },
        },
      }),
      async (c) => {
        const enabled = process.env["AX_CODE_AUTONOMOUS"] === "true"
        return c.json({ enabled })
      },
    )
    .put(
      "/",
      describeRoute({
        summary: "Set autonomous mode",
        description: "Toggle autonomous mode on or off.",
        operationId: "autonomous.set",
        responses: {
          200: {
            description: "Updated autonomous state",
            content: {
              "application/json": {
                schema: resolver(AutonomousState),
              },
            },
          },
        },
      }),
      validator("json", z.object({ enabled: z.boolean() })),
      async (c) => {
        const { enabled } = c.req.valid("json")
        process.env["AX_CODE_AUTONOMOUS"] = String(enabled)
        log.info("autonomous mode changed", { enabled })
        return c.json({ enabled })
      },
    ),
)
