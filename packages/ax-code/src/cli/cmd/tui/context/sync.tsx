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
  Path,
  VcsInfo,
} from "@ax-code/sdk/v2"
import { createStore, produce, reconcile } from "solid-js/store"
import { useSDK } from "@tui/context/sdk"
import { Binary } from "@ax-code/util/binary"
import { createSimpleContext } from "./helper"
import type { Snapshot } from "@/snapshot"
import { useExit } from "./exit"
import { useArgs } from "./args"
import { batch, createEffect, onMount, onCleanup } from "solid-js"
import { Log } from "@/util/log"
import type { AppStateBootstrap } from "@/cli/cmd/tui/state/actions"
import { createTuiStateStore } from "@/cli/cmd/tui/state/store"
import { mergeSorted } from "./sync-util"
import { AutonomousQuestion } from "@/question/autonomous"
import { useRoute } from "./route"

export const { use: useSync, provider: SyncProvider } = createSimpleContext({
  name: "Sync",
  init: () => {
    type ManagedTuiKey =
      | "workspaceList"
      | "session"
      | "session_status"
      | "message"
      | "part"
      | "permission"
      | "question"
      | "vcs"
      | "path"

    const [store, setStore] = createStore<{
      status: "loading" | "partial" | "complete"
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
      path: { home: "", state: "", config: "", worktree: "", directory: "" },
      workspaceList: [],
    })
    const tuiState = createTuiStateStore({
      initial: {
        path: { home: "", state: "", config: "", worktree: "", directory: "" },
      },
    })

    function applyTuiStateSnapshot() {
      const snapshot = tuiState.getSnapshot()
      batch(() => {
        setStore("workspaceList", reconcile(snapshot.workspaceList))
        setStore("session", reconcile(snapshot.session))
        setStore("session_status", reconcile(snapshot.sessionStatus))
        setStore("message", reconcile(snapshot.message))
        setStore("part", reconcile(snapshot.part))
        setStore("permission", reconcile(snapshot.permission))
        setStore("question", reconcile(snapshot.question))
        setStore("vcs", snapshot.vcs)
        setStore("path", reconcile(snapshot.path))
      })
    }

    const unsubscribeTuiState = tuiState.subscribe(applyTuiStateSnapshot)
    onCleanup(unsubscribeTuiState)

    const sdk = useSDK()
    const route = useRoute()

    function resolveUpdater<T>(value: T | ((current: T) => T), current: T): T {
      return typeof value === "function" ? (value as (current: T) => T)(current) : value
    }

    function hydrateTuiState(data: AppStateBootstrap) {
      tuiState.dispatch({
        type: "bootstrap.hydrated",
        data,
      })
    }

    function setManagedTuiField(key: ManagedTuiKey, value: unknown) {
      const snapshot = tuiState.getSnapshot()
      switch (key) {
        case "workspaceList":
          hydrateTuiState({
            workspaceList: resolveUpdater(
              value as string[] | ((current: string[]) => string[]),
              snapshot.workspaceList,
            ),
          })
          return
        case "session":
          hydrateTuiState({
            session: resolveUpdater(value as Session[] | ((current: Session[]) => Session[]), snapshot.session),
          })
          return
        case "session_status":
          hydrateTuiState({
            sessionStatus: resolveUpdater(
              value as
                | Record<string, SessionStatus>
                | ((current: Record<string, SessionStatus>) => Record<string, SessionStatus>),
              snapshot.sessionStatus,
            ),
          })
          return
        case "message":
          hydrateTuiState({
            message: resolveUpdater(
              value as Record<string, Message[]> | ((current: Record<string, Message[]>) => Record<string, Message[]>),
              snapshot.message,
            ),
          })
          return
        case "part":
          hydrateTuiState({
            part: resolveUpdater(
              value as Record<string, Part[]> | ((current: Record<string, Part[]>) => Record<string, Part[]>),
              snapshot.part,
            ),
          })
          return
        case "permission":
          hydrateTuiState({
            permission: resolveUpdater(
              value as
                | Record<string, PermissionRequest[]>
                | ((current: Record<string, PermissionRequest[]>) => Record<string, PermissionRequest[]>),
              snapshot.permission,
            ),
          })
          return
        case "question":
          hydrateTuiState({
            question: resolveUpdater(
              value as
                | Record<string, QuestionRequest[]>
                | ((current: Record<string, QuestionRequest[]>) => Record<string, QuestionRequest[]>),
              snapshot.question,
            ),
          })
          return
        case "vcs":
          hydrateTuiState({
            vcs: resolveUpdater(
              value as VcsInfo | undefined | ((current: VcsInfo | undefined) => VcsInfo | undefined),
              snapshot.vcs,
            ),
          })
          return
        case "path":
          hydrateTuiState({
            path: resolveUpdater(value as Path | ((current: Path) => Path), snapshot.path),
          })
          return
      }
    }

    let workspaceSyncToken = 0
    let activeWorkspaceID: string | undefined

    async function activateWorkspace(workspaceID?: string) {
      if (activeWorkspaceID === workspaceID) return
      activeWorkspaceID = workspaceID
      const token = ++workspaceSyncToken
      tuiState.dispatch({
        type: "workspace.selected",
        workspaceID,
      })
      sdk.setWorkspace(workspaceID)
      const [pathResult, vcsResult] = await Promise.allSettled([sdk.client.path.get(), sdk.client.vcs.get()])
      if (token !== workspaceSyncToken) return
      if (pathResult.status === "fulfilled" && pathResult.value.data) {
        tuiState.dispatch({
          type: "path.synced",
          path: pathResult.value.data,
        })
      }
      if (vcsResult.status === "fulfilled") {
        tuiState.dispatch({
          type: "vcs.synced",
          vcs: vcsResult.value.data,
        })
      }
    }

    async function syncWorkspaces() {
      const result = await sdk.client.worktree.list().catch(() => undefined)
      if (!result?.data) return
      tuiState.dispatch({
        type: "workspace.list.synced",
        workspaceList: result.data,
      })
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

    const unsubscribeEvents = sdk.event.listen((e) => {
      const event = e.details
      switch (event.type) {
        case "server.instance.disposed":
          bootstrap()
          break
        case "permission.replied": {
          tuiState.dispatchEvent(event)
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
          tuiState.dispatchEvent(event)
          break
        }

        case "question.replied":
        case "question.rejected": {
          tuiState.dispatchEvent(event)
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
          tuiState.dispatchEvent(event)
          break
        }

        case "todo.updated":
          setStore("todo", event.properties.sessionID, event.properties.todos)
          break

        case "session.diff":
          setStore("session_diff", event.properties.sessionID, event.properties.diff)
          break

        case "session.deleted": {
          tuiState.dispatchEvent(event)
          fullSyncedSessions.delete(event.properties.info.id)
          setStore(
            produce((draft) => {
              delete draft.todo[event.properties.info.id]
              delete draft.session_diff[event.properties.info.id]
            }),
          )
          break
        }
        case "session.created":
        case "session.updated": {
          tuiState.dispatchEvent(event)
          break
        }

        case "session.status": {
          tuiState.dispatchEvent(event)
          break
        }

        case "session.idle": {
          tuiState.dispatchEvent(event)
          break
        }

        case "message.updated": {
          tuiState.dispatchEvent(event)
          break
        }
        case "message.removed": {
          tuiState.dispatchEvent(event)
          break
        }
        case "message.part.updated": {
          tuiState.dispatchEvent(event)
          break
        }

        case "message.part.delta": {
          tuiState.dispatchEvent(event)
          break
        }

        case "message.part.removed": {
          tuiState.dispatchEvent(event)
          break
        }

        case "tui.prompt.append": {
          tuiState.dispatchEvent(event)
          break
        }

        case "tui.session.select": {
          tuiState.dispatchEvent(event)
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
          tuiState.dispatchEvent(event)
          break
        }
      }
    })
    onCleanup(unsubscribeEvents)

    const exit = useExit()
    const args = useArgs()

    async function bootstrap() {
      fullSyncedSessions.clear()
      const start = Date.now() - 30 * 24 * 60 * 60 * 1000
      const sessionListPromise = sdk.client.session
        .list({ start: start })
        .then((x) => (x.data ?? []).toSorted((a, b) => a.id.localeCompare(b.id)))

      // Only keep the continue-session lookup on the blocking path. The
      // home route can render immediately with empty provider/agent/config
      // state and hydrate those details afterward.
      const providersPromise = sdk.client.config.providers({}, { throwOnError: true })
      const providerListPromise = sdk.client.provider.list({}, { throwOnError: true })
      const agentsPromise = sdk.client.app.agents({}, { throwOnError: true })
      const configPromise = sdk.client.config.get({}, { throwOnError: true })
      const commandPromise = sdk.client.command.list()
      const blockingRequests: Promise<unknown>[] = args.continue ? [sessionListPromise] : []

      await Promise.all(blockingRequests)
        .then(() => {
          if (args.continue) {
            return sessionListPromise.then((sessions) => {
              hydrateTuiState({
                session: mergeSorted(tuiState.getSnapshot().session, sessions),
              })
            })
          }
        })
        .then(() => {
          if (store.status === "loading") setStore("status", "partial")
          // non-blocking — each call is individually guarded so one failure
          // doesn't prevent the rest from completing or status from advancing.
          Promise.allSettled([
            providersPromise
              .then((x) => x.data ?? { providers: [], default: {} })
              .then((providers) => {
                batch(() => {
                  setStore("provider", reconcile(providers.providers))
                  setStore("provider_default", reconcile(providers.default))
                  setStore("provider_loaded", true)
                  setStore("provider_failed", false)
                })
              })
              .catch((error) => {
                batch(() => {
                  setStore("provider_loaded", true)
                  setStore("provider_failed", true)
                })
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
                    hydrateTuiState({
                      session: mergeSorted(tuiState.getSnapshot().session, sessions),
                    }),
                  ),
                ]),
            sdk.client.lsp.status().then((x) => setStore("lsp", reconcile(x.data ?? []))),
            sdk.client.mcp.status().then((x) => setStore("mcp", reconcile(x.data ?? {}))),
            sdk.client.experimental.resource.list().then((x) => setStore("mcp_resource", reconcile(x.data ?? {}))),
            sdk.client.formatter.status().then((x) => setStore("formatter", reconcile(x.data ?? []))),
            sdk.client.session.status().then((x) => {
              hydrateTuiState({ sessionStatus: x.data ?? {} })
            }),
            sdk.client.provider.auth().then((x) => setStore("provider_auth", reconcile(x.data ?? {}))),
            sdk.client.vcs.get().then((x) => hydrateTuiState({ vcs: x.data })),
            sdk.client.path.get().then((x) => hydrateTuiState({ path: x.data ?? tuiState.getSnapshot().path })),
            syncWorkspaces(),
            syncDebugEngine(),
            syncIsolation(),
            syncAutonomous(),
            syncSmartLlm(),
          ]).then((results) => {
            for (const r of results) {
              if (r.status === "rejected")
                Log.Default.error("non-blocking bootstrap item failed", { error: String(r.reason) })
            }
            setStore("status", "complete")
          })
        })
        .catch(async (e) => {
          Log.Default.error("tui bootstrap failed", {
            error: e instanceof Error ? e.message : String(e),
            name: e instanceof Error ? e.name : undefined,
            stack: e instanceof Error ? e.stack : undefined,
          })
          await exit(e)
        })
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
      const debugEnginePoll = setInterval(() => {
        void syncDebugEngine()
      }, 10_000)
      onCleanup(() => clearInterval(debugEnginePoll))
    })

    const fullSyncedSessions = new Set<string>()
    createEffect(() => {
      const data = route.data
      tuiState.dispatch({
        type: "route.session.selected",
        sessionID: data.type === "session" ? data.sessionID : undefined,
      })
      const workspaceID =
        data.type === "session" ? store.session.find((item) => item.id === data.sessionID)?.directory : data.workspaceID
      void activateWorkspace(workspaceID)
    })

    const result = {
      data: store,
      set(...args: unknown[]) {
        if (args.length === 2) {
          const [key, value] = args as [ManagedTuiKey | string, unknown]
          if (
            key === "workspaceList" ||
            key === "session" ||
            key === "session_status" ||
            key === "message" ||
            key === "part" ||
            key === "permission" ||
            key === "question" ||
            key === "vcs" ||
            key === "path"
          ) {
            setManagedTuiField(key, value)
            return
          }
        }
        ;(setStore as (...args: unknown[]) => void)(...args)
      },
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
        cache(session: Session) {
          tuiState.dispatch({
            type: "session.upserted",
            session,
          })
        },
        remove(sessionID: string) {
          tuiState.dispatch({
            type: "session.deleted",
            sessionID,
          })
          fullSyncedSessions.delete(sessionID)
          setStore(
            produce((draft) => {
              delete draft.todo[sessionID]
              delete draft.session_diff[sessionID]
            }),
          )
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
        async sync(sessionID: string) {
          if (fullSyncedSessions.has(sessionID)) return
          const [session, messages, todo, diff] = await Promise.all([
            sdk.client.session.get({ sessionID }, { throwOnError: true }),
            sdk.client.session.messages({ sessionID, limit: 100 }),
            sdk.client.session.todo({ sessionID }),
            sdk.client.session.diff({ sessionID }),
          ])
          if (!session.data) {
            Log.Default.warn("session sync returned no session data", { sessionID })
            return
          }
          const messageList = messages.data ?? []
          const snapshot = tuiState.getSnapshot()
          const nextPart = {
            ...snapshot.part,
          }
          for (const existing of snapshot.message[sessionID] ?? []) {
            delete nextPart[existing.id]
          }
          for (const message of messageList) {
            nextPart[message.info.id] = message.parts
          }
          hydrateTuiState({
            session: mergeSorted(snapshot.session, [session.data]),
            message: {
              ...snapshot.message,
              [sessionID]: messageList.map((item) => item.info),
            },
            part: nextPart,
          })
          setStore(
            produce((draft) => {
              draft.todo[sessionID] = todo.data ?? []
              draft.session_diff[sessionID] = diff.data ?? []
            }),
          )
          fullSyncedSessions.add(sessionID)
        },
      },
      workspace: {
        get(workspaceID: string) {
          return store.workspaceList.find((workspace) => workspace === workspaceID)
        },
        activate: activateWorkspace,
        sync: syncWorkspaces,
      },
      bootstrap,
    }
    return result
  },
})
