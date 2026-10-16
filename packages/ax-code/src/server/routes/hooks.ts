import { Hono } from "hono"
import { describeRoute, resolver } from "hono-openapi"
import { LifecycleHooks } from "@/hooks/lifecycle"
import { Instance } from "@/project/instance"
import { lazy } from "@/util/lazy"

// ADR-211: read-only view of the lifecycle hooks in effect for the request's
// directory. Nothing here runs a hook or writes the project file.
export const HookRoutes = lazy(() =>
  new Hono().get(
    "/",
    describeRoute({
      summary: "Get lifecycle hooks",
      description:
        "Get the lifecycle hooks in effect for the directory, the built-in packs, and whether the project hooks file is trusted and valid.",
      operationId: "hooks.get",
      responses: {
        200: {
          description: "Effective lifecycle hook configuration",
          content: {
            "application/json": {
              schema: resolver(LifecycleHooks.Workspace),
            },
          },
        },
      },
    }),
    async (c) => c.json(await LifecycleHooks.describeWorkspace(Instance.directory)),
  ),
)
