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
import { batch, onMount, onCleanup } from "solid-js"
import { Log } from "@/util/log"
import type { Path } from "@ax-code/sdk"
import { upsert, mergeSorted } from "./sync-util"
import { applyTuiDirectoryHeaders } from "../transport"

export const { use: useSync, provider: SyncProvider } = createSimpleContext({
  name: "Sync",
  init: () => {
    const [store, setStore] = createStore<{
      status: "loading" | "partial" | "complete"
      provider: Provider[]
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
      try {
        const headers: Record<string, string> = { accept: "application/json" }
        applyTuiDirectoryHeaders(headers, sdk.directory)
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
        applyTuiDirectoryHeaders(headers, sdk.directory)
        const res = await sdk.fetch(`${sdk.url}/isolation`, { headers })
        if (!res.ok) return
        const body = (await res.json()) as { mode: "read-only" | "workspace-write" | "full-access"; network: boolean }
        setStore("isolation", reconcile(body))
      } catch {
        // Silent fallback for older servers without the endpoint.
      }
    }

    sdk.event.listen((e) => {
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
            sdk.client.permission.reply({ reply: "once", requestID: request.id })
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
            const answers = request.questions.map((q: { options: { label: string }[] }) =>
              q.options.length > 0 ? [q.options[0].label] : [],
            )
            sdk.client.question.reply({ requestID: request.id, answers })
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
          const result = Binary.search(store.session, event.properties.info.id, (s) => s.id)
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
          const result = Binary.search(parts, event.properties.partID, (p) => p.id)
          if (!result.found) break
          setStore(
            "part",
            event.properties.messageID,
            produce((draft) => {
              const part = draft[result.index]
              const field = event.properties.field as keyof typeof part
              const existing = part[field] as string | undefined
              ;(part[field] as string) = (existing ?? "") + event.properties.delta
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
            .then((x) => setStore("mcp", reconcile(x.data!)))
            .catch(() => {})
          break

        case "lsp.updated": {
          sdk.client.lsp.status().then((x) => setStore("lsp", x.data!))
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
    })

    const exit = useExit()
    const args = useArgs()

    async function bootstrap() {
      fullSyncedSessions.clear()
      const start = Date.now() - 30 * 24 * 60 * 60 * 1000
      const sessionListPromise = sdk.client.session
        .list({ start: start })
        .then((x) => (x.data ?? []).toSorted((a, b) => a.id.localeCompare(b.id)))

      // blocking - include session.list when continuing a session
      const providersPromise = sdk.client.config.providers({}, { throwOnError: true })
      const providerListPromise = sdk.client.provider.list({}, { throwOnError: true })
      const agentsPromise = sdk.client.app.agents({}, { throwOnError: true })
      const configPromise = sdk.client.config.get({}, { throwOnError: true })
      const commandPromise = sdk.client.command.list()
      const blockingRequests: Promise<unknown>[] = [
        providersPromise,
        providerListPromise,
        agentsPromise,
        configPromise,
        commandPromise,
        ...(args.continue ? [sessionListPromise] : []),
      ]

      await Promise.all(blockingRequests)
        .then(() => {
          const providersResponse = providersPromise.then((x) => x.data!)
          const providerListResponse = providerListPromise.then((x) => x.data!)
          const agentsResponse = agentsPromise.then((x) => x.data ?? [])
          const configResponse = configPromise.then((x) => x.data!)
          const sessionListResponse = args.continue ? sessionListPromise : undefined

          const commandResponse = commandPromise.then((x) => x.data ?? [])

          return Promise.all([
            providersResponse,
            providerListResponse,
            agentsResponse,
            configResponse,
            commandResponse,
            ...(sessionListResponse ? [sessionListResponse] : []),
          ]).then((responses) => {
            const providers = responses[0]
            const providerList = responses[1]
            const agents = responses[2]
            const config = responses[3]
            const commands = responses[4]
            const sessions = responses[5]

            batch(() => {
              setStore("provider", reconcile(providers.providers))
              setStore("provider_default", reconcile(providers.default))
              setStore("provider_next", reconcile(providerList))
              setStore("agent", reconcile(agents))
              setStore("config", reconcile(config))
              setStore("command", reconcile(commands))
              if (sessions !== undefined) setStore("session", reconcile(mergeSorted(store.session, sessions)))
            })
          })
        })
        .then(() => {
          if (store.status !== "complete") setStore("status", "partial")
          // non-blocking — each call is individually guarded so one failure
          // doesn't prevent the rest from completing or status from advancing.
          Promise.allSettled([
            ...(args.continue
              ? []
              : [
                  sessionListPromise.then((sessions) =>
                    setStore("session", reconcile(mergeSorted(store.session, sessions))),
                  ),
                ]),
            sdk.client.lsp.status().then((x) => setStore("lsp", reconcile(x.data!))),
            sdk.client.mcp.status().then((x) => setStore("mcp", reconcile(x.data!))),
            sdk.client.experimental.resource.list().then((x) => setStore("mcp_resource", reconcile(x.data ?? {}))),
            sdk.client.formatter.status().then((x) => setStore("formatter", reconcile(x.data!))),
            sdk.client.session.status().then((x) => {
              setStore("session_status", reconcile(x.data!))
            }),
            sdk.client.provider.auth().then((x) => setStore("provider_auth", reconcile(x.data ?? {}))),
            sdk.client.vcs.get().then((x) => setStore("vcs", reconcile(x.data))),
            sdk.client.path.get().then((x) => setStore("path", reconcile(x.data!))),
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
        async sync(sessionID: string) {
          if (fullSyncedSessions.has(sessionID)) return
          const [session, messages, todo, diff] = await Promise.all([
            sdk.client.session.get({ sessionID }, { throwOnError: true }),
            sdk.client.session.messages({ sessionID, limit: 100 }),
            sdk.client.session.todo({ sessionID }),
            sdk.client.session.diff({ sessionID }),
          ])
          setStore(
            produce((draft) => {
              const match = Binary.search(draft.session, sessionID, (s) => s.id)
              if (match.found) draft.session[match.index] = session.data!
              if (!match.found) draft.session.splice(match.index, 0, session.data!)
              draft.todo[sessionID] = todo.data ?? []
              draft.message[sessionID] = messages.data!.map((x) => x.info)
              for (const message of messages.data!) {
                draft.part[message.info.id] = message.parts
              }
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
        sync: syncWorkspaces,
      },
      bootstrap,
    }
    return result
  },
})
