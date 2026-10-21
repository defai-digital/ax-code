import { Hono } from "hono"
import { bodyLimit } from "hono/body-limit"
import { describeRoute, resolver } from "hono-openapi"
import z from "zod"
import { DesktopBrowser } from "../../mcp/desktop-browser"
import { validator } from "../validation"
import { errors, forbidden } from "../error"
import { lazy } from "../../util/lazy"

// Keep module initialization independent of the Session -> local client -> Server import cycle.
const ProviderParam = z.object({ providerID: z.string().uuid() })
export const DesktopBrowserRoutes = lazy(() => {
  const success = {
    200: { description: "Operation completed", content: { "application/json": { schema: resolver(z.boolean()) } } },
    ...errors(400, 403),
  }
  return (
    new Hono()
      // Even read/poll endpoints require the launcher-only secret. Browser origins are never admitted.
      .use(async (c, next) => {
        if (c.req.header("origin") || !DesktopBrowser.hostAuthorized(c.req.header(DesktopBrowser.HEADER))) {
          return forbidden(c, { message: "Desktop provider authorization required" })
        }
        return next()
      })
      .use(bodyLimit({ maxSize: 264192 }))
      .get(
        "/capability",
        describeRoute({
          operationId: "desktopBrowser.capability",
          summary: "Negotiate the private desktop browser provider",
          responses: {
            200: {
              description: "Native provider capability",
              content: {
                "application/json": {
                  schema: resolver(
                    z.object({ capability: z.literal(DesktopBrowser.CAPABILITY), browserMode: z.literal("embedded") }),
                  ),
                },
              },
            },
            ...errors(403),
          },
        }),
        (c) => c.json({ capability: DesktopBrowser.CAPABILITY, browserMode: "embedded" as const }),
      )
      .post(
        "/provider",
        describeRoute({
          operationId: "desktopBrowser.enroll",
          summary: "Enroll a desktop-owned browser for one coding session",
          responses: {
            200: {
              description: "Provider connection",
              content: { "application/json": { schema: resolver(DesktopBrowser.Connection) } },
            },
            ...errors(400, 403),
          },
        }),
        validator("json", DesktopBrowser.Enrollment),
        // DesktopBrowser.enroll rejects a missing session, another project, and any
        // directory outside the project boundary. A subdirectory inside it is accepted.
        async (c) => c.json(await DesktopBrowser.enroll(c.req.valid("json"))),
      )
      .delete(
        "/provider/:providerID",
        describeRoute({
          operationId: "desktopBrowser.disconnect",
          summary: "Revoke a desktop browser provider",
          responses: success,
        }),
        validator("param", ProviderParam),
        (c) => {
          DesktopBrowser.disconnect(c.req.valid("param").providerID)
          return c.json(true)
        },
      )
      .put(
        "/provider/:providerID/state",
        describeRoute({
          operationId: "desktopBrowser.update",
          summary: "Invalidate changed native browser state",
          responses: success,
        }),
        validator("param", ProviderParam),
        validator("json", DesktopBrowser.Snapshot),
        (c) => {
          DesktopBrowser.update(c.req.valid("param").providerID, c.req.valid("json"))
          return c.json(true)
        },
      )
      .get(
        "/provider/:providerID/next",
        describeRoute({
          operationId: "desktopBrowser.next",
          summary: "Poll private authorized native browser requests",
          responses: {
            200: {
              description: "Private request or heartbeat",
              content: { "application/json": { schema: resolver(DesktopBrowser.Poll) } },
            },
            ...errors(400, 403),
          },
        }),
        validator("param", ProviderParam),
        async (c) => c.json(await DesktopBrowser.poll(c.req.valid("param").providerID, c.req.raw.signal)),
      )
      .post(
        "/provider/:providerID/reply",
        describeRoute({
          operationId: "desktopBrowser.reply",
          summary: "Complete a native browser observation",
          responses: success,
        }),
        validator("param", ProviderParam),
        validator("json", DesktopBrowser.Reply),
        (c) => {
          try {
            DesktopBrowser.respond(c.req.valid("param").providerID, c.req.valid("json"))
            return c.json(true)
          } catch (error) {
            // Cancellation/navigation may win the network race. Discard the reply without retiring a live provider.
            if (
              error instanceof DesktopBrowser.Failure &&
              error.data.message === "Response belongs to an expired browser request"
            )
              return c.json(false)
            throw error
          }
        },
      )
  )
})
