import { Hono } from "hono"
import { describeRoute, resolver } from "hono-openapi"
import { validator } from "../validation"
import z from "zod"
import { Permission } from "@/permission"
import { ServerRuntimeAuth } from "../runtime-auth"
import { errors, notFound } from "../error"
import { lazy } from "../../util/lazy"
import { PERMISSION_REQUEST_ID_PARAM, withPermissionRequestID } from "./route-params"

export const PermissionRoutes = lazy(() =>
  new Hono()
    .get(
      "/auto-accept",
      describeRoute({
        summary: "Read project auto-accept state",
        operationId: "permission.autoAcceptStatus",
        responses: {
          200: {
            description: "Current state",
            content: { "application/json": { schema: resolver(Permission.AutoAcceptState) } },
          },
        },
      }),
      async (c) => c.json(await Permission.autoAcceptStatus()),
    )
    .put(
      "/auto-accept",
      describeRoute({
        summary: "Set project auto-accept for the running instance",
        operationId: "permission.setAutoAccept",
        responses: {
          200: {
            description: "Effective state",
            content: { "application/json": { schema: resolver(Permission.AutoAcceptState) } },
          },
        },
      }),
      validator("json", z.object({ enabled: z.boolean() }).strict()),
      async (c) => {
        const unauthorized = ServerRuntimeAuth.require(c)
        if (unauthorized) return unauthorized
        return c.json(await Permission.setAutoAccept(c.req.valid("json").enabled))
      },
    )
    .post(
      "/:requestID/webmcp-allowlist",
      describeRoute({
        summary: "Save a WebMCP approval and allow the pending operation",
        operationId: "permission.saveWebMcpApproval",
        responses: {
          200: { description: "Approval saved", content: { "application/json": { schema: resolver(z.boolean()) } } },
          ...errors(400, 404),
        },
      }),
      validator("param", PERMISSION_REQUEST_ID_PARAM),
      withPermissionRequestID(async (requestID, c) => {
        const unauthorized = ServerRuntimeAuth.require(c)
        if (unauthorized) return unauthorized
        const unavailable = () =>
          notFound(c, {
            name: "PermissionUnavailableError",
            message: "WebMCP approval request is unavailable",
            resource: "permission",
          })
        try {
          const applied = await Permission.saveWebMcpApproval(requestID)
          if (!applied) return unavailable()
          return c.json(true)
        } catch (error) {
          // A concurrent reply, abort, or policy change can resolve the pending
          // entry during the save; saveWebMcpApproval then throws the same "the
          // request is gone" condition it returns false for before the call.
          // Report the declared 404 instead of an internal 500.
          if (error instanceof Error && /WebMCP approval request (is no longer valid|was canceled)/.test(error.message))
            return unavailable()
          throw error
        }
      }),
    )
    .post(
      "/:requestID/reply",
      describeRoute({
        summary: "Respond to permission request",
        description: "Approve or deny a permission request from the AI assistant.",
        operationId: "permission.reply",
        responses: {
          200: {
            description: "Permission processed successfully",
            content: {
              "application/json": {
                schema: resolver(z.boolean()),
              },
            },
          },
          ...errors(400, 404),
        },
      }),
      validator("param", PERMISSION_REQUEST_ID_PARAM),
      validator("json", z.object({ reply: Permission.Reply, message: z.string().optional() })),
      withPermissionRequestID(async (requestID, c) => {
        const json = c.req.valid("json")
        // Check the actual reply outcome, not just pre-call pendingness — a
        // concurrent reply for the same requestID (e.g. a client retry after
        // a timed-out first attempt) can resolve the request in the gap
        // between a pre-check and the reply call, which would otherwise
        // report success for a reply that silently did nothing. See #341.
        const applied = await Permission.reply({ requestID, reply: json.reply, message: json.message })
        if (!applied) {
          return notFound(c, {
            name: "PermissionUnavailableError",
            message: "Permission request is unavailable",
            resource: "permission",
          })
        }
        return c.json(true)
      }),
    )
    .get(
      "/",
      describeRoute({
        summary: "List pending permissions",
        description: "Get all pending permission requests across all sessions.",
        operationId: "permission.list",
        responses: {
          200: {
            description: "List of pending permissions",
            content: {
              "application/json": {
                schema: resolver(Permission.Request.array()),
              },
            },
          },
        },
      }),
      async (c) => {
        const permissions = await Permission.list()
        return c.json(permissions)
      },
    ),
)
