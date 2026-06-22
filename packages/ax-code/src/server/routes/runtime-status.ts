import { Hono } from "hono"
import { describeRoute, resolver } from "hono-openapi"
import { LSP } from "@/lsp"
import { DebugEngine } from "@/debug-engine"
import { DiagnosticCorrelation } from "@/debug-engine"
import { CodeIntelligence } from "@/code-intelligence"
import { AutoIndex } from "@/code-intelligence/auto-index"
import { Format } from "@/format"
import { Instance } from "@/project/instance"
import { Flag } from "@/flag/flag"
import { ToolRegistry } from "@/tool/registry"
import { lazy } from "@/util/lazy"
import z from "zod"

export const RuntimeStatusRoutes = lazy(() =>
  new Hono()
    .get(
      "/lsp",
      describeRoute({
        summary: "Get LSP status",
        description: "Get LSP server status",
        operationId: "lsp.status",
        responses: {
          200: {
            description: "LSP server status",
            content: {
              "application/json": {
                schema: resolver(LSP.Status.array()),
              },
            },
          },
        },
      }),
      async (c) => {
        return c.json(await LSP.status())
      },
    )
    .get(
      "/debug-engine/pending-plans",
      describeRoute({
        summary: "DRE status and pending refactor plans",
        description:
          "Return the current project's pending refactor plans plus DRE health information (graph node count, last-indexed timestamp, registered tool count). The TUI footer uses the plans count for its chip; the TUI sidebar uses the graph and tool fields to render the DRE section empty state so users can tell at a glance whether DRE is ready to use. Fields default to zero / null when the experimental DRE flag is off, so callers can poll unconditionally. The `graph` and `toolCount` fields were added in v2.3.6 - older clients ignore unknown fields and continue to work against the original `{ count, plans }` shape.",
        operationId: "debugEngine.pendingPlans",
        responses: {
          200: {
            description: "DRE status + pending refactor plans",
            content: {
              "application/json": {
                schema: resolver(
                  z.object({
                    count: z.number(),
                    plans: z.array(
                      z.object({
                        planId: z.string(),
                        kind: z.string(),
                        risk: z.string(),
                        summary: z.string(),
                        affectedFileCount: z.number(),
                        affectedSymbolCount: z.number(),
                        timeCreated: z.number(),
                      }),
                    ),
                    // v2.3.6 additions: surface DRE readiness in the TUI sidebar.
                    toolCount: z.number(),
                    graph: z.object({
                      nodeCount: z.number(),
                      edgeCount: z.number(),
                      lastIndexedAt: z.number().nullable(),
                      // v2.3.13 additions: surface in-progress and failed
                      // auto-index runs so the sidebar can distinguish
                      // "not indexed, about to start" from "indexing"
                      // from "indexing failed, here's why".
                      state: z.union([z.literal("idle"), z.literal("indexing"), z.literal("failed")]),
                      completed: z.number(),
                      total: z.number(),
                      error: z.string().nullable(),
                    }),
                  }),
                ),
              },
            },
          },
        },
      }),
      async (c) => {
        // Silent no-op when the flag is off so the TUI can poll
        // unconditionally without branching on flag state. The v2.3.6
        // fields (`toolCount`, `graph`) default to zero / null so the
        // sidebar renders a coherent "DRE disabled" empty state
        // without any flag branching on the client.
        if (!Flag.AX_CODE_EXPERIMENTAL_DEBUG_ENGINE) {
          return c.json({
            count: 0,
            plans: [],
            toolCount: 0,
            graph: {
              nodeCount: 0,
              edgeCount: 0,
              lastIndexedAt: null,
              state: "idle" as const,
              completed: 0,
              total: 0,
              error: null,
            },
          })
        }
        const projectID = Instance.project.id
        const plans = DebugEngine.listPlans(projectID, { status: "pending", limit: 25 })
        const DRE_TOOL_COUNT = ToolRegistry.debugEngineToolCount()
        const graph = CodeIntelligence.status(projectID)
        if (graph.nodeCount === 0) {
          try {
            AutoIndex.maybeStart(projectID)
          } catch {
            // Best-effort only: the status endpoint must never fail
            // just because background indexing could not be scheduled.
          }
        }
        const indexState = AutoIndex.getState(projectID)
        return c.json({
          count: plans.length,
          plans: plans.map((p) => ({
            planId: p.planId as unknown as string,
            kind: p.kind,
            risk: p.risk,
            // Trim the markdown summary for list display; the full
            // summary is still available via getPlan if a caller wants it.
            summary: p.summary.split("\n").slice(0, 2).join("\n"),
            affectedFileCount: p.affectedFiles.length,
            affectedSymbolCount: p.affectedSymbols.length,
            timeCreated: p.explain.indexedAt,
          })),
          toolCount: DRE_TOOL_COUNT,
          graph: {
            nodeCount: graph.nodeCount,
            edgeCount: graph.edgeCount,
            lastIndexedAt: graph.lastUpdated,
            state: indexState.state,
            completed: indexState.completed,
            total: indexState.total,
            error: indexState.error,
          },
        })
      },
    )
    .get(
      "/formatter",
      describeRoute({
        summary: "Get formatter status",
        description: "Get formatter status",
        operationId: "formatter.status",
        responses: {
          200: {
            description: "Formatter status",
            content: {
              "application/json": {
                schema: resolver(Format.Status.array()),
              },
            },
          },
        },
      }),
      async (c) => {
        return c.json(await Format.status())
      },
    )
    .get(
      "/debug-engine/correlated-diagnostics",
      describeRoute({
        summary: "Get correlated diagnostics for a file",
        description:
          "Return DRE cross-file root-cause correlations for a given file. Each entry maps an LSP error to a possible root-cause location in another file, with a confidence level and a symbol chain linking the error back to its origin. Returns an empty array when the DRE flag is off or no correlations are cached.",
        operationId: "debugEngine.correlatedDiagnostics",
        responses: {
          200: {
            description: "Correlated diagnostics",
            content: {
              "application/json": {
                schema: resolver(DebugEngine.CorrelatedDiagnosticSchema.array()),
              },
            },
          },
        },
      }),
      async (c) => {
        if (!Flag.AX_CODE_EXPERIMENTAL_DEBUG_ENGINE) {
          return c.json([])
        }
        const file = c.req.query("file")
        if (!file) {
          return c.json([])
        }
        return c.json(DiagnosticCorrelation.correlateDiagnostics(file))
      },
    ),
)
