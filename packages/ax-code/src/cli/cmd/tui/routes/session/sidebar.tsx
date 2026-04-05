import { useSync } from "@tui/context/sync"
import { createMemo, createSignal, For, Match, onCleanup, onMount, Show, Switch } from "solid-js"
import { createStore } from "solid-js/store"
import { useTheme } from "../../context/theme"
import { Locale } from "@/util/locale"
import path from "path"
import type { AssistantMessage } from "@ax-code/sdk/v2"
import { Global } from "@/global"
import { Installation } from "@/installation"
import { useKeybind } from "../../context/keybind"
import { useDirectory } from "../../context/directory"
import { useKV } from "../../context/kv"
import { TodoItem } from "../../component/todo-item"
import { Usage } from "./usage"
import { Flag } from "@/flag/flag"

function bar(input: { pct?: number | null; busy: boolean; tick: number }) {
  const width = 20
  const pct = Math.max(0, Math.min(100, input.pct ?? 0))
  const fill = Math.max(0, Math.min(width, Math.round((pct / 100) * width)))
  const cells: string[] = Array.from({ length: width }, (_, i) => (i < fill ? "█" : "░"))

  if (input.busy) {
    const pos = input.tick % width
    cells[pos] = pos < fill ? "▓" : "▒"
  }

  return cells.join("")
}

export function Sidebar(props: { sessionID: string; overlay?: boolean }) {
  const sync = useSync()
  const { theme } = useTheme()
  const session = createMemo(() => sync.session.get(props.sessionID)!)
  const diff = createMemo(() => sync.data.session_diff[props.sessionID] ?? [])
  const todo = createMemo(() => sync.data.todo[props.sessionID] ?? [])
  const messages = createMemo(() => sync.data.message[props.sessionID] ?? [])
  const status = createMemo(() => sync.data.session_status?.[props.sessionID] ?? { type: "idle" as const })
  const [tick, setTick] = createSignal(0)

  onMount(() => {
    const id = setInterval(() => {
      if (status().type === "idle") return
      setTick((x) => x + 1)
    }, 120)

    onCleanup(() => clearInterval(id))
  })

  const [expanded, setExpanded] = createStore({
    mcp: true,
    diff: true,
    todo: true,
    lsp: true,
    // DRE section defaults to expanded so users see the pending-plan
    // list (or the "DRE is active" placeholder) immediately after
    // enabling the experimental flag. Collapses if the plan list
    // grows beyond 2 entries, same rule as LSP / Todo.
    dre: true,
  })

  // Sort MCP servers alphabetically for consistent display order
  const mcpEntries = createMemo(() => Object.entries(sync.data.mcp).sort(([a], [b]) => a.localeCompare(b)))

  // Count connected and error MCP servers for collapsed header display
  const connectedMcpCount = createMemo(() => mcpEntries().filter(([_, item]) => item.status === "connected").length)
  const errorMcpCount = createMemo(
    () =>
      mcpEntries().filter(
        ([_, item]) =>
          item.status === "failed" || item.status === "needs_auth" || item.status === "needs_client_registration",
      ).length,
  )

  const context = createMemo(() => {
    const last = Usage.last(messages()) as AssistantMessage
    if (!last) return
    const total = Usage.total(last)
    const model = sync.data.provider.find((x) => x.id === last.providerID)?.models[last.modelID]
    return {
      tokens: total.toLocaleString(),
      percentage: model?.limit.context ? Math.round((total / model.limit.context) * 100) : null,
    }
  })
  const usageBar = createMemo(() =>
    bar({
      pct: context()?.percentage,
      busy: status().type !== "idle",
      tick: tick(),
    }),
  )

  const directory = useDirectory()
  const kv = useKV()

  const hasProviders = createMemo(() =>
    sync.data.provider.length > 0,
  )
  const gettingStartedDismissed = createMemo(() => kv.get("dismissed_getting_started", false))

  return (
    <Show when={session()}>
      <box
        backgroundColor={theme.backgroundPanel}
        width={42}
        height="100%"
        paddingTop={1}
        paddingBottom={1}
        paddingLeft={2}
        paddingRight={2}
        position={props.overlay ? "absolute" : "relative"}
      >
        <scrollbox
          flexGrow={1}
          verticalScrollbarOptions={{
            trackOptions: {
              backgroundColor: theme.background,
              foregroundColor: theme.borderActive,
            },
          }}
        >
          <box flexShrink={0} gap={1} paddingRight={1}>
            <box paddingRight={1}>
              <text fg={theme.text}>
                <b>{session().title}</b>
              </text>
              <Show when={session().share?.url}>
                <text fg={theme.textMuted}>{session().share!.url}</text>
              </Show>
            </box>
            <box>
              <text fg={theme.text}>
                <b>Context</b>
              </text>
              <text fg={theme.textMuted}>{context()?.tokens ?? 0} tokens</text>
              <text fg={theme.textMuted}>{context()?.percentage ?? 0}% used</text>
              <text fg={status().type === "idle" ? theme.textMuted : theme.primary}>{usageBar()}</text>
            </box>
            <Show when={mcpEntries().length > 0}>
              <box>
                <box
                  flexDirection="row"
                  gap={1}
                  onMouseDown={() => mcpEntries().length > 2 && setExpanded("mcp", !expanded.mcp)}
                >
                  <Show when={mcpEntries().length > 2}>
                    <text fg={theme.text}>{expanded.mcp ? "▼" : "▶"}</text>
                  </Show>
                  <text fg={theme.text}>
                    <b>MCP</b>
                    <Show when={!expanded.mcp}>
                      <span style={{ fg: theme.textMuted }}>
                        {" "}
                        ({connectedMcpCount()} active
                        {errorMcpCount() > 0 ? `, ${errorMcpCount()} error${errorMcpCount() > 1 ? "s" : ""}` : ""})
                      </span>
                    </Show>
                  </text>
                </box>
                <Show when={mcpEntries().length <= 2 || expanded.mcp}>
                  <For each={mcpEntries()}>
                    {([key, item]) => (
                      <box flexDirection="row" gap={1}>
                        <text
                          flexShrink={0}
                          style={{
                            fg: (
                              {
                                connected: theme.success,
                                failed: theme.error,
                                disabled: theme.textMuted,
                                needs_auth: theme.warning,
                                needs_client_registration: theme.error,
                              } as Record<string, typeof theme.success>
                            )[item.status],
                          }}
                        >
                          •
                        </text>
                        <text fg={theme.text} wrapMode="word">
                          {key}{" "}
                          <span style={{ fg: theme.textMuted }}>
                            <Switch fallback={item.status}>
                              <Match when={item.status === "connected"}>Connected</Match>
                              <Match when={item.status === "failed" && item}>{(val) => <i>{val().error}</i>}</Match>
                              <Match when={item.status === "disabled"}>Disabled</Match>
                              <Match when={(item.status as string) === "needs_auth"}>Needs auth</Match>
                              <Match when={(item.status as string) === "needs_client_registration"}>
                                Needs client ID
                              </Match>
                            </Switch>
                          </span>
                        </text>
                      </box>
                    )}
                  </For>
                </Show>
              </box>
            </Show>
            <box>
              <box
                flexDirection="row"
                gap={1}
                onMouseDown={() => sync.data.lsp.length > 2 && setExpanded("lsp", !expanded.lsp)}
              >
                <Show when={sync.data.lsp.length > 2}>
                  <text fg={theme.text}>{expanded.lsp ? "▼" : "▶"}</text>
                </Show>
                <text fg={theme.text}>
                  <b>LSP</b>
                </text>
              </box>
              <Show when={sync.data.lsp.length <= 2 || expanded.lsp}>
                <Show when={sync.data.lsp.length === 0}>
                  <text fg={theme.textMuted}>
                    {sync.data.config.lsp === false
                      ? "LSPs have been disabled in settings"
                      : "LSPs will activate as files are read"}
                  </text>
                </Show>
                <For each={sync.data.lsp}>
                  {(item) => (
                    <box flexDirection="row" gap={1}>
                      <text
                        flexShrink={0}
                        style={{
                          fg: {
                            connected: theme.success,
                            error: theme.error,
                          }[item.status],
                        }}
                      >
                        •
                      </text>
                      <text fg={theme.textMuted}>
                        {item.id} {item.root}
                      </text>
                    </box>
                  )}
                </For>
              </Show>
            </box>
            {/* Debugging & Refactoring Engine section. Mirrors the LSP
                section's pattern (always visible heading, fallback text
                when empty, expand/collapse at >2 items) so users can
                tell at a glance whether DRE is ready to use. Gated on
                the experimental flag — when the flag is off, no
                section appears. The server returns zero counts when
                the flag is off, so the inner state branches here are
                never reached in the "flag off" case. The empty-state
                layout shows tool count, graph readiness, and a
                discoverability hint pointing at the DRE slash
                commands. See PRD-debug-refactor-engine-ui-tier-3.md
                §6.9 for the design rationale. */}
            <Show when={Flag.AX_CODE_EXPERIMENTAL_DEBUG_ENGINE}>
              <box>
                <box
                  flexDirection="row"
                  gap={1}
                  onMouseDown={() =>
                    sync.data.debugEngine.plans.length > 2 && setExpanded("dre", !expanded.dre)
                  }
                >
                  <Show when={sync.data.debugEngine.plans.length > 2}>
                    <text fg={theme.text}>{expanded.dre ? "▼" : "▶"}</text>
                  </Show>
                  <text fg={theme.text}>
                    <b>DRE</b>
                  </text>
                </box>
                <Show when={sync.data.debugEngine.plans.length <= 2 || expanded.dre}>
                  {/* Empty state: no pending refactor plans. Show
                      readiness facts instead of just "DRE is active",
                      so users can tell whether the tools will produce
                      real results (graph indexed) or empty ones
                      (graph not indexed — run `ax-code index`). */}
                  <Show when={sync.data.debugEngine.plans.length === 0}>
                    {/* Row 1: tool count. Dot is green when tools
                        registered, muted otherwise. Zero toolCount
                        means the server is an older peer that
                        doesn't report this field; fall back to
                        hiding the row rather than lying. */}
                    <Show when={sync.data.debugEngine.toolCount > 0}>
                      <box flexDirection="row" gap={1}>
                        <text flexShrink={0} style={{ fg: theme.success }}>
                          •
                        </text>
                        <text fg={theme.textMuted}>
                          {sync.data.debugEngine.toolCount} tools ready
                        </text>
                      </box>
                    </Show>
                    {/* Row 2: graph readiness. Four cases:
                        - indexing: blue dot + "indexing... (N/M)"
                          so users see live progress from auto-index
                          or a sibling `ax-code index` run in
                          another terminal.
                        - failed: error dot + short error message.
                          Previously failures were silently logged
                          and the sidebar stayed stuck on "not
                          indexed", which is what the v2.3.12 user
                          report flagged.
                        - nodeCount > 0: success dot + count. DRE
                          tools will produce real results.
                        - otherwise: warning dot + "not indexed ·
                          run ax-code index". */}
                    <box flexDirection="row" gap={1}>
                      <text
                        flexShrink={0}
                        style={{
                          fg:
                            sync.data.debugEngine.graph.state === "failed"
                              ? theme.error
                              : sync.data.debugEngine.graph.state === "indexing"
                                ? theme.info
                                : sync.data.debugEngine.graph.nodeCount > 0
                                  ? theme.success
                                  : theme.warning,
                        }}
                      >
                        •
                      </text>
                      <text fg={theme.textMuted}>
                        {sync.data.debugEngine.graph.state === "failed"
                          ? `index failed: ${sync.data.debugEngine.graph.error ?? "unknown error"}`
                          : sync.data.debugEngine.graph.state === "indexing"
                            ? `indexing... (${sync.data.debugEngine.graph.completed.toLocaleString()}/${sync.data.debugEngine.graph.total.toLocaleString()})`
                            : sync.data.debugEngine.graph.nodeCount > 0
                              ? `${sync.data.debugEngine.graph.nodeCount.toLocaleString()} symbols indexed`
                              : "graph not indexed · run `ax-code index`"}
                      </text>
                    </box>
                    {/* Row 3: discoverability hint. Points at the
                        slash commands shipped in v2.3.1. Users who
                        see the section but don't know what to type
                        get a concrete next step. */}
                    <text fg={theme.textMuted}>Try /debug /refactor /impact</text>
                  </Show>
                  {/* Non-empty state: per-plan rows unchanged from v2.3.3. */}
                  <For each={sync.data.debugEngine.plans}>
                    {(plan) => (
                      <box flexDirection="row" gap={1}>
                        <text
                          flexShrink={0}
                          style={{
                            fg:
                              plan.risk === "high"
                                ? theme.error
                                : plan.risk === "medium"
                                  ? theme.warning
                                  : theme.success,
                          }}
                        >
                          •
                        </text>
                        <text fg={theme.textMuted}>
                          {plan.kind} · {plan.affectedFileCount} file
                          {plan.affectedFileCount === 1 ? "" : "s"}
                        </text>
                      </box>
                    )}
                  </For>
                </Show>
              </box>
            </Show>
            <Show when={todo().length > 0 && todo().some((t) => t.status !== "completed")}>
              <box>
                <box
                  flexDirection="row"
                  gap={1}
                  onMouseDown={() => todo().length > 2 && setExpanded("todo", !expanded.todo)}
                >
                  <Show when={todo().length > 2}>
                    <text fg={theme.text}>{expanded.todo ? "▼" : "▶"}</text>
                  </Show>
                  <text fg={theme.text}>
                    <b>Todo</b>
                  </text>
                </box>
                <Show when={todo().length <= 2 || expanded.todo}>
                  <For each={todo()}>{(todo) => <TodoItem status={todo.status} content={todo.content} />}</For>
                </Show>
              </box>
            </Show>
            <Show when={diff().length > 0}>
              <box>
                <box
                  flexDirection="row"
                  gap={1}
                  onMouseDown={() => diff().length > 2 && setExpanded("diff", !expanded.diff)}
                >
                  <Show when={diff().length > 2}>
                    <text fg={theme.text}>{expanded.diff ? "▼" : "▶"}</text>
                  </Show>
                  <text fg={theme.text}>
                    <b>Modified Files</b>
                  </text>
                </box>
                <Show when={diff().length <= 2 || expanded.diff}>
                  <For each={diff() || []}>
                    {(item) => {
                      return (
                        <box flexDirection="row" gap={1} justifyContent="space-between">
                          <text fg={theme.textMuted} wrapMode="none">
                            {item.file}
                          </text>
                          <box flexDirection="row" gap={1} flexShrink={0}>
                            <Show when={item.additions}>
                              <text fg={theme.diffAdded}>+{item.additions}</text>
                            </Show>
                            <Show when={item.deletions}>
                              <text fg={theme.diffRemoved}>-{item.deletions}</text>
                            </Show>
                          </box>
                        </box>
                      )
                    }}
                  </For>
                </Show>
              </box>
            </Show>
          </box>
        </scrollbox>

        <box flexShrink={0} gap={1} paddingTop={1}>
          <Show when={!hasProviders() && !gettingStartedDismissed()}>
            <box
              backgroundColor={theme.backgroundElement}
              paddingTop={1}
              paddingBottom={1}
              paddingLeft={2}
              paddingRight={2}
              flexDirection="row"
              gap={1}
            >
              <text flexShrink={0} fg={theme.text}>
                ⬖
              </text>
              <box flexGrow={1} gap={1}>
                <box flexDirection="row" justifyContent="space-between">
                  <text fg={theme.text}>
                    <b>Getting started</b>
                  </text>
                  <text fg={theme.textMuted} onMouseDown={() => kv.set("dismissed_getting_started", true)}>
                    ✕
                  </text>
                </box>
                <text fg={theme.textMuted}>ax-code includes free models so you can start immediately.</text>
                <text fg={theme.textMuted}>
                  Connect from 75+ providers to use other models, including Claude, GPT, Gemini etc
                </text>
                <box flexDirection="row" gap={1} justifyContent="space-between">
                  <text fg={theme.text}>Connect provider</text>
                  <text fg={theme.textMuted}>/connect</text>
                </box>
              </box>
            </box>
          </Show>
          <text>
            <span style={{ fg: theme.textMuted }}>{directory().split("/").slice(0, -1).join("/")}/</span>
            <span style={{ fg: theme.text }}>{directory().split("/").at(-1)}</span>
          </text>
          <text fg={theme.textMuted}>
            <span style={{ fg: theme.success }}>•</span> <b>AX</b>
            <span style={{ fg: theme.text }}>
              <b> Code</b>
            </span>{" "}
            <span>v{Installation.VERSION}</span>
          </text>
        </box>
      </box>
    </Show>
  )
}
