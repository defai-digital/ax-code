import type {
  Message,
  Agent,
  Provider,
  Session,
  Part,
  Config,
  Todo,
  Command,
  PermissionRequest,
  QuestionRequest,
  LspStatus,
  McpStatus,
  McpResource,
  FormatterStatus,
  SessionStatus,
  ProviderListResponse,
  ProviderAuthMethod,
  VcsInfo,
} from "@ax-code/sdk/v2"
import { createStore, produce, reconcile } from "solid-js/store"
import { useSDK } from "@tui/context/sdk"
import { Binary } from "@ax-code/util/binary"
import { createSimpleContext } from "./helper"
import type { Snapshot } from "@/snapshot"
import { useExit } from "./exit"
import { useArgs } from "./args"
import { batch, createEffect, on, onMount, onCleanup } from "solid-js"
import { Log } from "@/util/log"
import type { Path } from "@ax-code/sdk"
import { upsert, mergeSorted } from "./sync-util"
import { AutonomousQuestion } from "@/question/autonomous"
import { createReconnectRecoveryGate } from "../util/reconnect-recovery"
import { withTimeout } from "@/util/timeout"
import { Flag } from "@/flag/flag"
import { createTuiStartupSpan, recordTuiStartupOnce } from "@tui/util/startup-trace"

const BOOTSTRAP_REQUEST_TIMEOUT_MS = 10_000
const SESSION_SYNC_REQUEST_TIMEOUT_MS = 10_000

function withSyncTimeout<T>(label: string, promise: Promise<T>, timeoutMs = BOOTSTRAP_REQUEST_TIMEOUT_MS) {
  return withTimeout(promise, timeoutMs, `${label} timed out after ${timeoutMs}ms`)
}

export const { use: useSync, provider: SyncProvider } = createSimpleContext({
  name: "Sync",
  init: () => {
    const [store, setStore] = createStore<{
      status: "loading" | "partial" | "complete"
      session_loaded: boolean
      provider: Provider[]
      provider_loaded: boolean
      provider_failed: boolean
      provider_default: Record<string, string>
      provider_next: ProviderListResponse
      provider_auth: Record<string, ProviderAuthMethod[]>
      agent: Agent[]
      command: Command[]
      permission: {
        [sessionID: string]: PermissionRequest[]
      }
      question: {
        [sessionID: string]: QuestionRequest[]
      }
      config: Config
      session: Session[]
      session_status: {
        [sessionID: string]: SessionStatus
      }
      session_diff: {
        [sessionID: string]: Snapshot.FileDiff[]
      }
      todo: {
        [sessionID: string]: Todo[]
      }
      message: {
        [sessionID: string]: Message[]
      }
      part: {
        [messageID: string]: Part[]
      }
      lsp: LspStatus[]
      // Debugging & Refactoring Engine status.
      //
      // `pendingPlans` drives the footer indicator: when > 0 the footer
      // lights up a "• N Plans" chip so users don't forget about
      // refactor plans they haven't applied yet. `plans` holds a
      // short preview list used by the `/plans` slash command dialog.
      //
      // `toolCount` and `graph` (v2.3.6) drive the sidebar DRE empty
      // state so users can tell at a glance whether DRE is ready to
      // use. A non-zero `toolCount` with `graph.nodeCount === 0` means
      // "DRE is enabled but the code graph hasn't been indexed yet,
      // so tool results will be empty" — a distinct failure mode from
      // plain "DRE is off".
      //
      // When AX_CODE_EXPERIMENTAL_DEBUG_ENGINE is off, the server
      // returns zero counts unconditionally, so this store field
      // stays silent without any branching on the flag in the TUI
      // layer.
      debugEngine: {
        pendingPlans: number
        plans: Array<{
          planId: string
          kind: string
          risk: string
          summary: string
          affectedFileCount: number
          affectedSymbolCount: number
          timeCreated: number
        }>
        toolCount: number
        graph: {
          nodeCount: number
          edgeCount: number
          lastIndexedAt: number | null
          // v2.3.13: indexing progress & failure. `state` drives
          // which sidebar message is shown (idle vs. indexing vs.
          // failed). `completed/total` feeds the progress counter
          // while a run is in flight. `error` holds a short
          // human-readable message when state === "failed".
          state: "idle" | "indexing" | "failed"
          completed: number
          total: number
          error: string | null
        }
      }
      isolation: {
        mode: "read-only" | "workspace-write" | "full-access"
        network: boolean
      }
      autonomous: boolean
      smartLlm: boolean
      mcp: {
        [key: string]: McpStatus
      }
      mcp_resource: {
        [key: string]: McpResource
      }
      formatter: FormatterStatus[]
      vcs: VcsInfo | undefined
      path: Path
      workspaceList: string[]
    }>({
      provider_next: {
        all: [],
        default: {},
        connected: [],
      },
      session_loaded: false,
      provider_loaded: false,
      provider_failed: false,
      provider_auth: {},
      config: {},
      status: "loading",
      agent: [],
      permission: {},
      question: {},
      command: [],
      provider: [],
      provider_default: {},
      session: [],
      session_status: {},
      session_diff: {},
      todo: {},
      message: {},
      part: {},
      lsp: [],
      debugEngine: {
        pendingPlans: 0,
        plans: [],
        toolCount: 0,
        graph: {
          nodeCount: 0,
          edgeCount: 0,
          lastIndexedAt: null,
          state: "idle",
          completed: 0,
          total: 0,
          error: null,
        },
      },
      isolation: { mode: "workspace-write", network: false },
      autonomous: true,
      smartLlm: false,
      mcp: {},
      mcp_resource: {},
      formatter: [],
      vcs: undefined,
      path: { state: "", config: "", worktree: "", directory: "" },
      workspaceList: [],
    })

    const sdk = useSDK()
    const groupBySession = <T extends { sessionID: string; id: string }>(items: T[]) => {
      return items.reduce<Record<string, T[]>>((acc, item) => {
        const list = acc[item.sessionID] ?? []
        list.push(item)
        acc[item.sessionID] = list
        return acc
      }, {})
    }

    async function syncWorkspaces() {
      const result = await sdk.client.worktree.list().catch(() => undefined)
      if (!result?.data) return
      setStore("workspaceList", reconcile(result.data))
    }

    // Debugging & Refactoring Engine poll. Hits the server's
    // /debug-engine/pending-plans route directly via sdk.fetch because
    // the route is new in v2.3.1 and the generated SDK client hasn't
    // been regenerated yet. Wrapped in a try/catch so a server without
    // the endpoint (older peer) silently returns zero plans rather
    // than logging errors every poll. The `toolCount` / `graph` fields
    // were added in v2.3.6 and default to zero if the server is an
    // older peer that doesn't send them.
    async function syncDebugEngine() {
      if (!Flag.AX_CODE_EXPERIMENTAL_DEBUG_ENGINE) return
      try {
        const headers: Record<string, string> = { accept: "application/json" }
        if (sdk.directory) {
          const encoded = /[^\x00-\x7F]/.test(sdk.directory) ? encodeURIComponent(sdk.directory) : sdk.directory
          headers["x-ax-code-directory"] = encoded
          headers["x-opencode-directory"] = encoded
        }
        const res = await sdk.fetch(`${sdk.url}/debug-engine/pending-plans`, { headers })
        if (!res.ok) return
        const body = (await res.json()) as {
          count: number
          plans: Array<{
            planId: string
            kind: string
            risk: string
            summary: string
            affectedFileCount: number
            affectedSymbolCount: number
            timeCreated: number
          }>
          toolCount?: number
          graph?: {
            nodeCount: number
            edgeCount: number
            lastIndexedAt: number | null
            // v2.3.13 fields — older servers omit them, so default
            // to idle/zero to stay backward compatible.
            state?: "idle" | "indexing" | "failed"
            completed?: number
            total?: number
            error?: string | null
          }
        }
        setStore(
          "debugEngine",
          reconcile({
            pendingPlans: body.count,
            plans: body.plans,
            toolCount: body.toolCount ?? 0,
            graph: {
              nodeCount: body.graph?.nodeCount ?? 0,
              edgeCount: body.graph?.edgeCount ?? 0,
              lastIndexedAt: body.graph?.lastIndexedAt ?? null,
              state: body.graph?.state ?? "idle",
              completed: body.graph?.completed ?? 0,
              total: body.graph?.total ?? 0,
              error: body.graph?.error ?? null,
            },
          }),
        )
      } catch {
        // Silent fallback — an older server returns 404 and we leave
        // the field at its default zero state.
      }
    }

    async function syncAutonomous() {
      try {
        const res = await sdk.fetch(`${sdk.url}/autonomous`)
        if (!res.ok) return
        const body = (await res.json()) as { enabled: boolean }
        setStore("autonomous", body.enabled)
      } catch {
        // Silent fallback for older servers without the endpoint.
      }
    }

    async function syncSmartLlm() {
      try {
        const res = await sdk.fetch(`${sdk.url}/smart-llm`)
        if (!res.ok) return
        const body = (await res.json()) as { enabled: boolean }
        setStore("smartLlm", body.enabled)
      } catch {
        // Silent fallback for older servers without the endpoint.
      }
    }

    async function syncIsolation() {
      try {
        const headers: Record<string, string> = { accept: "application/json" }
        if (sdk.directory) {
          const encoded = /[^\x00-\x7F]/.test(sdk.directory) ? encodeURIComponent(sdk.directory) : sdk.directory
          headers["x-ax-code-directory"] = encoded
          headers["x-opencode-directory"] = encoded
        }
        const res = await sdk.fetch(`${sdk.url}/isolation`, { headers })
        if (!res.ok) return
        const body = (await res.json()) as { mode: "read-only" | "workspace-write" | "full-access"; network: boolean }
        setStore("isolation", reconcile(body))
      } catch {
        // Silent fallback for older servers without the endpoint.
      }
    }

    const fullSyncedSessions = new Set<string>()
    const inFlightSessions = new Set<string>()
    const unsubscribeEvents = sdk.event.listen((e) => {
      try {
      const event = e.details
      switch (event.type) {
        case "server.instance.disposed":
          bootstrap()
          break
        case "permission.replied": {
          const requests = store.permission[event.properties.sessionID]
          if (!requests) break
          const match = Binary.search(requests, event.properties.requestID, (r) => r.id)
          if (!match.found) break
          setStore(
            "permission",
            event.properties.sessionID,
            produce((draft) => {
              draft.splice(match.index, 1)
            }),
          )
          break
        }

        case "permission.asked": {
          const request = event.properties
          if (store.autonomous) {
            sdk.client.permission.reply({ reply: "once", requestID: request.id }).catch((error) => {
              Log.Default.warn("autonomous permission reply failed", { error })
            })
            break
          }
          const requests = store.permission[request.sessionID]
          if (!requests) {
            setStore("permission", request.sessionID, [request])
            break
          }
          const match = Binary.search(requests, request.id, (r) => r.id)
          if (match.found) {
            setStore("permission", request.sessionID, match.index, reconcile(request))
            break
          }
          setStore(
            "permission",
            request.sessionID,
            produce((draft) => {
              draft.splice(match.index, 0, request)
            }),
          )
          break
        }

        case "question.replied":
        case "question.rejected": {
          const requests = store.question[event.properties.sessionID]
          if (!requests) break
          const match = Binary.search(requests, event.properties.requestID, (r) => r.id)
          if (!match.found) break
          setStore(
            "question",
            event.properties.sessionID,
            produce((draft) => {
              draft.splice(match.index, 1)
            }),
          )
          break
        }

        case "question.asked": {
          const request = event.properties
          if (store.autonomous) {
            const answers = AutonomousQuestion.answers(request.questions)
            sdk.client.question.reply({ requestID: request.id, answers }).catch((error) => {
              Log.Default.warn("autonomous question reply failed", { error })
            })
            break
          }
          const requests = store.question[request.sessionID]
          if (!requests) {
            setStore("question", request.sessionID, [request])
            break
          }
          const match = Binary.search(requests, request.id, (r) => r.id)
          if (match.found) {
            setStore("question", request.sessionID, match.index, reconcile(request))
            break
          }
          setStore(
            "question",
            request.sessionID,
            produce((draft) => {
              draft.splice(match.index, 0, request)
            }),
          )
          break
        }

        case "todo.updated":
          setStore("todo", event.properties.sessionID, event.properties.todos)
          break

        case "session.diff":
          setStore("session_diff", event.properties.sessionID, event.properties.diff)
          break

        case "session.deleted": {
          const sessionID = event.properties.info.id
          fullSyncedSessions.delete(sessionID)
          inFlightSessions.delete(sessionID)
          const result = Binary.search(store.session, sessionID, (s) => s.id)
          if (result.found) {
            setStore(
              "session",
              produce((draft) => {
                draft.splice(result.index, 1)
              }),
            )
          }
          break
        }
        case "session.created":
        case "session.updated": {
          setStore(
            "session",
            produce((draft) => {
              upsert(draft, event.properties.info)
            }),
          )
          break
        }

        case "session.status": {
          setStore("session_status", event.properties.sessionID, event.properties.status)
          break
        }

        case "message.updated": {
          const messages = store.message[event.properties.info.sessionID]
          if (!messages) {
            setStore("message", event.properties.info.sessionID, [event.properties.info])
            break
          }
          const result = Binary.search(messages, event.properties.info.id, (m) => m.id)
          if (result.found) {
            setStore("message", event.properties.info.sessionID, result.index, reconcile(event.properties.info))
            break
          }
          setStore(
            "message",
            event.properties.info.sessionID,
            produce((draft) => {
              draft.splice(result.index, 0, event.properties.info)
            }),
          )
          const updated = store.message[event.properties.info.sessionID]
          if (updated.length > 100) {
            const oldest = updated[0]
            batch(() => {
              setStore(
                "message",
                event.properties.info.sessionID,
                produce((draft) => {
                  draft.shift()
                }),
              )
              setStore(
                "part",
                produce((draft) => {
                  delete draft[oldest.id]
                }),
              )
            })
          }
          break
        }
        case "message.removed": {
          const messages = store.message[event.properties.sessionID]
          if (!messages) break
          const result = Binary.search(messages, event.properties.messageID, (m) => m.id)
          if (result.found) {
            setStore(
              "message",
              event.properties.sessionID,
              produce((draft) => {
                draft.splice(result.index, 1)
              }),
            )
          }
          break
        }
        case "message.part.updated": {
          const parts = store.part[event.properties.part.messageID]
          if (!parts) {
            setStore("part", event.properties.part.messageID, [event.properties.part])
            break
          }
          const result = Binary.search(parts, event.properties.part.id, (p) => p.id)
          if (result.found) {
            setStore("part", event.properties.part.messageID, result.index, reconcile(event.properties.part))
            break
          }
          setStore(
            "part",
            event.properties.part.messageID,
            produce((draft) => {
              draft.splice(result.index, 0, event.properties.part)
            }),
          )
          break
        }

        case "message.part.delta": {
          const parts = store.part[event.properties.messageID]
          if (!parts) break
          if (event.properties.field !== "text") break
          const result = Binary.search(parts, event.properties.partID, (p) => p.id)
          if (!result.found) break
          setStore(
            "part",
            event.properties.messageID,
            produce((draft) => {
              const part = draft[result.index]
              if (part.type !== "text" && part.type !== "reasoning") return
              const existing = part.text
              part.text = (existing ?? "") + event.properties.delta
            }),
          )
          break
        }

        case "message.part.removed": {
          const parts = store.part[event.properties.messageID]
          if (!parts) break
          const result = Binary.search(parts, event.properties.partID, (p) => p.id)
          if (result.found)
            setStore(
              "part",
              event.properties.messageID,
              produce((draft) => {
                draft.splice(result.index, 1)
              }),
            )
          break
        }

        case "mcp.tools.changed":
          sdk.client.mcp
            .status()
            .then((x) => {
              if (x.data) setStore("mcp", reconcile(x.data))
            })
            .catch((error) => Log.Default.warn("mcp status sync failed", { error }))
          break

        case "lsp.updated": {
          sdk.client.lsp
            .status()
            .then((x) => {
              if (x.data) setStore("lsp", x.data)
            })
            .catch((error) => Log.Default.warn("lsp status sync failed", { error }))
          // Piggyback on lsp.updated as a cheap "project state changed"
          // trigger until DRE ships its own Bus event in a later
          // release. LSP updates fire frequently enough to keep the
          // pending-plans chip reasonably fresh without adding a
          // separate timer.
          syncDebugEngine()
          break
        }

        // v2.3.13 code-index events. The SDK types for these are not
        // regenerated yet, so the type narrowing below casts through
        // `any`. Each event triggers a re-sync of the debug-engine
        // endpoint — the server is the single source of truth for
        // graph.state / graph.completed / graph.total, so we just
        // refetch rather than maintaining parallel state in the TUI.
        case "code.index.progress" as never:
        case "code.index.state" as never: {
          syncDebugEngine()
          break
        }

        case "vcs.branch.updated": {
          setStore("vcs", { branch: event.properties.branch })
          break
        }
      }
      } catch (err) {
        Log.Default.error("sync event handler error", {
          type: e.details?.type,
          error: err instanceof Error ? err.message : String(err),
        })
      }
    })
    onCleanup(unsubscribeEvents)

    const exit = useExit()
    const args = useArgs()

    let bootstrapPromise: Promise<void> | undefined
    async function bootstrap() {
      if (bootstrapPromise) return bootstrapPromise
      bootstrapPromise = (async () => {
        const isStartupBootstrap = store.status === "loading"
        const startupBootstrap = isStartupBootstrap ? createTuiStartupSpan("tui.startup.bootstrap") : undefined
        let finishCoreBootstrap: ReturnType<typeof createTuiStartupSpan> | undefined
        let finishDeferredBootstrap: ReturnType<typeof createTuiStartupSpan> | undefined

        try {
          fullSyncedSessions.clear()
          setStore("session_loaded", false)
          const start = Date.now() - 30 * 24 * 60 * 60 * 1000
          const sessionListPromise = withSyncTimeout(
            "tui bootstrap session.list",
            sdk.client.session
              .list({ start: start })
              .then((x) => (x.data ?? []).toSorted((a, b) => a.id.localeCompare(b.id))),
          ).finally(() => {
            setStore("session_loaded", true)
            recordTuiStartupOnce("tui.startup.sessionListReady")
          })
          const providersPromise = withSyncTimeout(
            "tui bootstrap config.providers",
            sdk.client.config.providers({}, { throwOnError: true }),
          )
          const providerListPromise = withSyncTimeout(
            "tui bootstrap provider.list",
            sdk.client.provider.list({}, { throwOnError: true }),
          )
          const agentsPromise = withSyncTimeout(
            "tui bootstrap app.agents",
            sdk.client.app.agents({}, { throwOnError: true }),
          )
          const configPromise = withSyncTimeout(
            "tui bootstrap config.get",
            sdk.client.config.get({}, { throwOnError: true }),
          )
          const commandPromise = withSyncTimeout("tui bootstrap command.list", sdk.client.command.list())
          const permissionPromise = withSyncTimeout("tui bootstrap permission.list", sdk.client.permission.list())
          const questionPromise = withSyncTimeout("tui bootstrap question.list", sdk.client.question.list())
          const blockingRequests = args.continue
            ? [
                sessionListPromise.then((sessions) => {
                  setStore("session", reconcile(mergeSorted(store.session, sessions)))
                }),
              ]
            : []

          const blockingResults = await Promise.allSettled(blockingRequests)
          for (const result of blockingResults) {
            if (result.status === "rejected") {
              Log.Default.warn("blocking bootstrap item failed", {
                error: String(result.reason),
              })
            }
          }

          if (store.status === "loading") {
            setStore("status", "partial")
            recordTuiStartupOnce("tui.startup.syncPartial")
          }

          finishCoreBootstrap = isStartupBootstrap ? createTuiStartupSpan("tui.startup.bootstrapCore") : undefined
          const coreBootstrapTasks = [
            providersPromise
              .then((x) => x.data ?? { providers: [], default: {} })
              .then((providers) => {
                batch(() => {
                  setStore("provider", reconcile(providers.providers))
                  setStore("provider_default", reconcile(providers.default))
                  setStore("provider_loaded", true)
                  setStore("provider_failed", false)
                })
                recordTuiStartupOnce("tui.startup.providersReady", { failed: false })
              })
              .catch((error) => {
                batch(() => {
                  setStore("provider_loaded", true)
                  setStore("provider_failed", true)
                })
                recordTuiStartupOnce("tui.startup.providersReady", { failed: true })
                throw error
              }),
            providerListPromise.then((x) => setStore("provider_next", reconcile(x.data ?? store.provider_next))),
            agentsPromise.then((x) => setStore("agent", reconcile(x.data ?? []))),
            configPromise.then((x) => setStore("config", reconcile(x.data ?? store.config))),
            commandPromise.then((x) => setStore("command", reconcile(x.data ?? []))),
            ...(args.continue
              ? []
              : [
                  sessionListPromise.then((sessions) =>
                    setStore("session", reconcile(mergeSorted(store.session, sessions))),
                  ),
                ]),
            permissionPromise.then((x) => setStore("permission", reconcile(groupBySession(x.data ?? [])))),
            questionPromise.then((x) => setStore("question", reconcile(groupBySession(x.data ?? [])))),
            withSyncTimeout("tui bootstrap session.status", sdk.client.session.status()).then((x) => {
              setStore("session_status", reconcile(x.data ?? {}))
            }),
            withSyncTimeout("tui bootstrap provider.auth", sdk.client.provider.auth()).then((x) =>
              setStore("provider_auth", reconcile(x.data ?? {})),
            ),
            withSyncTimeout("tui bootstrap path.get", sdk.client.path.get()).then((x) =>
              setStore("path", reconcile(x.data ?? store.path)),
            ),
            withSyncTimeout("tui bootstrap isolation", syncIsolation()),
            withSyncTimeout("tui bootstrap autonomous", syncAutonomous()),
          ]

          const coreResults = await Promise.allSettled(coreBootstrapTasks)
          const coreRejected = coreResults.filter((result) => result.status === "rejected")
          for (const result of coreRejected) {
            Log.Default.error("core bootstrap item failed", { error: String(result.reason) })
          }
          recordTuiStartupOnce("tui.startup.bootstrapCoreReady", { rejected: coreRejected.length })
          finishCoreBootstrap?.({ rejected: coreRejected.length })

          setStore("status", "complete")

          // Defer lower-priority status/metadata hydration so startup does not fan out
          // every auxiliary request before the first usable home/session state settles.
          // Keep bootstrapPromise alive until these finish so reconnect-triggered
          // bootstraps do not overlap and race each other.
          finishDeferredBootstrap = isStartupBootstrap
            ? createTuiStartupSpan("tui.startup.bootstrapDeferred")
            : undefined
          const deferredBootstrapTasks = [
            withSyncTimeout("tui bootstrap lsp.status", sdk.client.lsp.status()).then((x) =>
              setStore("lsp", reconcile(x.data ?? [])),
            ),
            withSyncTimeout("tui bootstrap mcp.status", sdk.client.mcp.status()).then((x) =>
              setStore("mcp", reconcile(x.data ?? {})),
            ),
            withSyncTimeout("tui bootstrap resource.list", sdk.client.experimental.resource.list()).then((x) =>
              setStore("mcp_resource", reconcile(x.data ?? {})),
            ),
            withSyncTimeout("tui bootstrap formatter.status", sdk.client.formatter.status()).then((x) =>
              setStore("formatter", reconcile(x.data ?? [])),
            ),
            withSyncTimeout("tui bootstrap vcs.get", sdk.client.vcs.get()).then((x) =>
              setStore("vcs", reconcile(x.data)),
            ),
            withSyncTimeout("tui bootstrap worktree.list", syncWorkspaces()),
            withSyncTimeout("tui bootstrap debug-engine", syncDebugEngine()),
            withSyncTimeout("tui bootstrap smart-llm", syncSmartLlm()),
          ]
          const deferredResults = await Promise.allSettled(deferredBootstrapTasks)
          const deferredRejected = deferredResults.filter((result) => result.status === "rejected")
          for (const result of deferredRejected) {
            Log.Default.error("deferred bootstrap item failed", { error: String(result.reason) })
          }
          recordTuiStartupOnce("tui.startup.bootstrapDeferredReady", { rejected: deferredRejected.length })
          finishDeferredBootstrap?.({ rejected: deferredRejected.length })
          startupBootstrap?.()
        } catch (error) {
          finishDeferredBootstrap?.({ ok: false, error: String(error) })
          finishCoreBootstrap?.({ ok: false, error: String(error) })
          startupBootstrap?.({ ok: false, error: String(error) })
          Log.Default.error("tui bootstrap failed", { error })
          await exit(error)
        }
      })().finally(() => {
        bootstrapPromise = undefined
      })
      return bootstrapPromise
    }

    onMount(() => {
      bootstrap()
      // Poll the DRE stats endpoint periodically so the sidebar
      // picks up out-of-band graph changes (e.g. the user runs
      // `ax-code index` in a separate terminal, or the background
      // auto-index fires on session start and finishes a minute
      // later). Previously the only refresh triggers were the
      // initial bootstrap and LSP updated events — neither fires
      // when the graph is populated by a different process, so
      // the sidebar's "graph not indexed · run ax-code index"
      // label stuck around even after the user ran the command.
      // 10s is a deliberate compromise: fast enough that indexing
      // in another terminal reflects within a single UI beat,
      // slow enough to add negligible server load (the endpoint
      // runs two COUNT(*) queries against indexed columns).
      if (Flag.AX_CODE_EXPERIMENTAL_DEBUG_ENGINE) {
        const debugEnginePoll = setInterval(() => {
          void syncDebugEngine()
        }, 10_000)
        onCleanup(() => clearInterval(debugEnginePoll))
      }
    })

    const reconnectBootstrap = createReconnectRecoveryGate({
      recover: bootstrap,
    })
    createEffect(
      on(
        () => sdk.sseConnected,
        (connected) => reconnectBootstrap.onConnectionChange(connected),
      ),
    )

    const result = {
      data: store,
      set: setStore,
      get status() {
        return store.status
      },
      get ready() {
        return store.status !== "loading"
      },
      session: {
        get(sessionID: string) {
          const match = Binary.search(store.session, sessionID, (s) => s.id)
          if (match.found) return store.session[match.index]
          return undefined
        },
        status(sessionID: string) {
          const session = result.session.get(sessionID)
          if (!session) return "idle"
          if (session.time.compacting) return "compacting"
          const messages = store.message[sessionID] ?? []
          const last = messages.at(-1)
          if (!last) return "idle"
          if (last.role === "user") return "working"
          return last.time.completed ? "idle" : "working"
        },
        async sync(sessionID: string, input?: { force?: boolean }) {
          if (!input?.force && (fullSyncedSessions.has(sessionID) || inFlightSessions.has(sessionID))) return
          inFlightSessions.add(sessionID)
          try {
            const [session, messages, todo, diff] = await Promise.all([
              withSyncTimeout(
                `tui session sync ${sessionID} session.get`,
                sdk.client.session.get({ sessionID }, { throwOnError: true }),
                SESSION_SYNC_REQUEST_TIMEOUT_MS,
              ),
              withSyncTimeout(
                `tui session sync ${sessionID} session.messages`,
                sdk.client.session.messages({ sessionID, limit: 100 }),
                SESSION_SYNC_REQUEST_TIMEOUT_MS,
              ),
              withSyncTimeout(
                `tui session sync ${sessionID} session.todo`,
                sdk.client.session.todo({ sessionID }),
                SESSION_SYNC_REQUEST_TIMEOUT_MS,
              ),
              withSyncTimeout(
                `tui session sync ${sessionID} session.diff`,
                sdk.client.session.diff({ sessionID }),
                SESSION_SYNC_REQUEST_TIMEOUT_MS,
              ),
            ])
            if (!session.data) {
              Log.Default.warn("session sync returned no session data", { sessionID })
              return
            }
            const messageList = messages.data ?? []
            setStore(
              produce((draft) => {
                const match = Binary.search(draft.session, sessionID, (s) => s.id)
                if (match.found) draft.session[match.index] = session.data
                if (!match.found) draft.session.splice(match.index, 0, session.data)
                draft.todo[sessionID] = todo.data ?? []
                draft.message[sessionID] = messageList.map((x) => x.info)
                for (const message of messageList) {
                  draft.part[message.info.id] = message.parts
                }
                draft.session_diff[sessionID] = diff.data ?? []
              }),
            )
            fullSyncedSessions.add(sessionID)
          } finally {
            inFlightSessions.delete(sessionID)
          }
        },
      },
      workspace: {
        get(workspaceID: string) {
          return store.workspaceList.find((workspace) => workspace === workspaceID)
        },
        sync: syncWorkspaces,
      },
      bootstrap,
    }
    return result
  },
})
