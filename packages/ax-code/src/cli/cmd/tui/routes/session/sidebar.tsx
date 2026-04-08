import { useSync } from "@tui/context/sync"
import { createMemo, createSignal, For, Match, onCleanup, onMount, Show, Switch } from "solid-js"
import { createStore } from "solid-js/store"
import { useTheme } from "../../context/theme"
import type { AssistantMessage } from "@ax-code/sdk/v2"
import { Installation } from "@/installation"
import { useDirectory } from "../../context/directory"
import { useKV } from "../../context/kv"
import { TodoItem } from "../../component/todo-item"
import { useCommandDialog } from "../../component/dialog-command"
import { Usage } from "./usage"
import { Flag } from "@/flag/flag"
import type { Part } from "@ax-code/sdk/v2"

function activityIcon(tool: string): string {
  switch (tool) {
    case "bash":
      return "$"
    case "read":
      return "\u2192"
    case "edit":
    case "write":
      return "\u270E"
    case "glob":
    case "grep":
    case "codesearch":
      return "\u2315"
    case "webfetch":
    case "websearch":
      return "\u2295"
    case "task":
      return "\u25C8"
    default:
      return "\u00B7"
  }
}

function activityLabel(part: Part): string {
  if (part.type !== "tool") return ""
  const state = part.state as { status: string; title?: string; error?: string }
  if (state.title) {
    return state.title.length > 33 ? state.title.slice(0, 30) + "..." : state.title
  }
  if (state.status === "pending") return `${part.tool} (pending)`
  if (state.status === "error" && state.error) {
    const label = `${part.tool}: ${state.error.replace(/\n/g, " ")}`
    return label.length > 33 ? label.slice(0, 30) + "..." : label
  }
  return part.tool
}

function activityColor(status: string, theme: ReturnType<typeof useTheme>["theme"]) {
  switch (status) {
    case "running":
      return theme.primary
    case "completed":
      return theme.success
    case "error":
      return theme.error
    default:
      return theme.textMuted
  }
}

function bar(input: { pct?: number | null; busy: boolean; tick: number; width?: number }) {
  const width = input.width ?? 37
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
  const command = useCommandDialog()
  const session = createMemo(() => sync.session.get(props.sessionID))
  const diff = createMemo(() => sync.data.session_diff[props.sessionID] ?? [])
  const todo = createMemo(() => sync.data.todo[props.sessionID] ?? [])
  const messages = createMemo(() => sync.data.message[props.sessionID] ?? [])
  const status = createMemo(() => sync.data.session_status?.[props.sessionID] ?? { type: "idle" as const })
  const [tick, setTick] = createSignal(0)
  const [timerTick, setTimerTick] = createSignal(0)
  const [etaTick, setEtaTick] = createSignal(0)
  const [countdownTick, setCountdownTick] = createSignal(0)
  const [etaAnchor, setEtaAnchor] = createSignal<{
    computedAt: number
    remainSec: number
    elapsedSec: number
  }>()
  let etaAnchorSessionID = ""
  let prevSample: { time: number; tokens: number } | undefined
  let smoothRate: number | undefined

  onMount(() => {
    const id = setInterval(() => {
      if (status().type === "idle") return
      setTick((x) => x + 1)
    }, 120)
    const timerId = setInterval(() => setTimerTick((x) => x + 1), 10_000)
    const etaId = setInterval(() => {
      if (status().type === "idle") return
      setEtaTick((x) => x + 1)
    }, 5_000)
    const countdownId = setInterval(() => {
      if (status().type === "idle") return
      setCountdownTick((x) => x + 1)
    }, 1_000)
    onCleanup(() => {
      clearInterval(id)
      clearInterval(timerId)
      clearInterval(etaId)
      clearInterval(countdownId)
    })
  })

  const elapsed = createMemo(() => {
    timerTick()
    tick()
    const s = session()
    if (!s?.time?.created) return ""
    const ms = Date.now() - s.time.created
    const total = Math.floor(ms / 1000)
    const h = Math.floor(total / 3600)
    const m = Math.floor((total % 3600) / 60)
    const sec = total % 60
    if (h > 0) return `${h}h ${m}m`
    if (m > 0) return `${m}m ${sec}s`
    return `${sec}s`
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
    activity: true,
  })

  const activityItems = createMemo(() => {
    const msgs = messages()
    const items: Array<{ id: string; icon: string; label: string; status: string; tool: string }> = []
    for (const msg of msgs) {
      const parts = sync.data.part[msg.id]
      if (!parts) continue
      for (const part of parts) {
        if (part.type !== "tool") continue
        const state = part.state as { status: string }
        items.push({
          id: part.id,
          icon: activityIcon(part.tool),
          label: activityLabel(part),
          status: state.status,
          tool: part.tool,
        })
      }
    }
    return items.slice(-10).reverse()
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
      percentage: model?.limit?.context ? Math.round((total / model.limit.context) * 100) : null,
      raw: total,
      limit: model?.limit?.context ?? 0,
    }
  })
  // Recalculate ETA every 2s using windowed velocity (recent token rate)
  const etaEstimate = createMemo(() => {
    etaTick()
    const idle = status().type === "idle"
    const ctx = context()
    if (etaAnchorSessionID !== props.sessionID) {
      etaAnchorSessionID = props.sessionID
      setEtaAnchor(undefined)
      prevSample = undefined
      smoothRate = undefined
    }
    if (idle) {
      setEtaAnchor(undefined)
      prevSample = undefined
      smoothRate = undefined
      return
    }
    if (!ctx || !ctx.limit || !ctx.raw) return
    const now = Date.now()
    const s = session()
    if (!s?.time?.created) return
    const elapsedSec = Math.round((now - s.time.created) / 1000)
    if (elapsedSec < 10) return
    if (ctx.raw / ctx.limit < 0.02) return
    // EMA-smoothed velocity: blends instant rate into a running average
    // so the estimate adjusts gradually without jumping.
    const lifetimeRate = ctx.raw / elapsedSec
    if (prevSample && now - prevSample.time >= 5_000) {
      const dt = (now - prevSample.time) / 1000
      const instantRate = (ctx.raw - prevSample.tokens) / dt
      // EMA alpha 0.2 = slow adaptation, avoids jumps from burst/pause cycles
      smoothRate = smoothRate !== undefined ? smoothRate * 0.8 + instantRate * 0.2 : lifetimeRate
      prevSample = { time: now, tokens: ctx.raw }
    } else if (!prevSample) {
      smoothRate = lifetimeRate
      prevSample = { time: now, tokens: ctx.raw }
    }
    const tokPerSec = smoothRate ?? lifetimeRate
    if (tokPerSec <= 0) return
    const remaining = ctx.limit - ctx.raw
    if (remaining <= 0) {
      setEtaAnchor({ computedAt: now, remainSec: 0, elapsedSec })
      return
    }
    const remainSec = Math.min(3600, Math.round(remaining / tokPerSec))
    setEtaAnchor({ computedAt: now, remainSec, elapsedSec: elapsedSec + remainSec })
    return
  })

  // Countdown display: ticks every 1s, counts down from last anchor
  const eta = createMemo(() => {
    countdownTick()
    etaEstimate()
    const anchor = etaAnchor()
    if (!anchor || anchor.remainSec <= 0) return
    const sinceLast = Math.round((Date.now() - anchor.computedAt) / 1000)
    const remainSec = anchor.remainSec - sinceLast
    if (remainSec <= 0) return
    const remainPct = Math.min(100, Math.round((remainSec / anchor.elapsedSec) * 100))
    const h = Math.floor(remainSec / 3600)
    const m = Math.floor((remainSec % 3600) / 60)
    const sec = remainSec % 60
    const label = h > 0 ? `~${h}h ${m}m` : m > 0 ? `~${m}m ${sec}s` : `~${sec}s`
    return { remainPct, label, remainSec }
  })

  // Track whether ETA is active as a signal to avoid bar memos subscribing to countdown
  const etaActive = createMemo(() => !!eta())

  // Full-width bar: only computed when ETA is not active (fallback path)
  const usageBar = createMemo(() => {
    if (etaActive()) return ""
    return bar({
      pct: context()?.percentage,
      busy: status().type !== "idle",
      tick: tick(),
    })
  })
  // Half-width bars: only computed when ETA is active (two-column path)
  const usageBarHalf = createMemo(() => {
    if (!etaActive()) return ""
    return bar({
      pct: context()?.percentage,
      busy: status().type !== "idle",
      tick: tick(),
      width: 18,
    })
  })
  const etaBarHalf = createMemo(() => {
    const e = eta()
    if (!e) return ""
    const width = 18
    const filled = Math.max(0, Math.min(width, Math.round((e.remainPct / 100) * width)))
    return Array.from({ length: width }, (_, i) => (i < filled ? "▓" : "·")).join("")
  })
  const usageBarColor = createMemo(() => {
    const pct = context()?.percentage ?? 0
    if (pct >= 80) return theme.error
    if (status().type === "idle") return theme.textMuted
    if (pct < 30) return theme.success
    return theme.primary
  })
  const etaBarColor = createMemo(() => {
    const e = eta()
    if (!e) return theme.textMuted
    if (e.remainSec <= 180) return theme.success
    if (e.remainSec <= 600) return theme.primary
    return theme.warning
  })

  const directory = useDirectory()
  const kv = useKV()

  const hasProviders = createMemo(() => sync.data.provider.length > 0)
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
                <b>{session()!.title}</b>
              </text>
              <Show when={session()!.share?.url}>
                <text fg={theme.textMuted}>{session()!.share!.url}</text>
              </Show>
            </box>
            <box>
              <Show
                when={eta()}
                fallback={
                  <>
                    <text fg={theme.textMuted}>
                      {context()?.tokens ?? 0} tokens · {elapsed()}
                    </text>
                    <text fg={usageBarColor()}>{usageBar()}</text>
                    <text fg={usageBarColor()}>📊 {context()?.percentage ?? 0}% used</text>
                  </>
                }
              >
                <box flexDirection="row" gap={1}>
                  <text width={18} fg={theme.textMuted}>
                    {context()?.tokens ?? 0} tokens
                  </text>
                  <text width={18} fg={theme.textMuted}>
                    Elapsed {elapsed()}
                  </text>
                </box>
                <box flexDirection="row" gap={1}>
                  <text width={18} fg={usageBarColor()}>
                    {usageBarHalf()}
                  </text>
                  <text width={18} fg={etaBarColor()}>
                    {etaBarHalf()}
                  </text>
                </box>
                <box flexDirection="row" gap={1}>
                  <text width={18} fg={usageBarColor()}>
                    📊 {context()?.percentage ?? 0}% used
                  </text>
                  <text width={18} fg={etaBarColor()}>
                    ⏳ {eta()!.label} (Est.)
                  </text>
                </box>
              </Show>
              <Show when={(context()?.percentage ?? 0) >= 80}>
                <text fg={(context()?.percentage ?? 0) >= 95 ? theme.error : theme.warning}>
                  {(context()?.percentage ?? 0) >= 95 ? "Context nearly full — " : "Consider "}/compact
                </text>
              </Show>
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
                section appears. The empty-state layout shows tool count
                and graph readiness. */}
            <Show when={Flag.AX_CODE_EXPERIMENTAL_DEBUG_ENGINE}>
              <box>
                <box
                  flexDirection="row"
                  gap={1}
                  onMouseDown={() => sync.data.debugEngine.plans.length > 2 && setExpanded("dre", !expanded.dre)}
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
                        <text fg={theme.textMuted}>{sync.data.debugEngine.toolCount} tools ready</text>
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
                  <For each={todo()}>{(item) => <TodoItem status={item.status} content={item.content} />}</For>
                </Show>
              </box>
            </Show>
            <Show when={activityItems().length > 0}>
              <box>
                <box
                  flexDirection="row"
                  gap={1}
                  justifyContent="space-between"
                  onMouseDown={() => activityItems().length > 2 && setExpanded("activity", !expanded.activity)}
                >
                  <box flexDirection="row" gap={1}>
                    <Show when={activityItems().length > 2}>
                      <text fg={theme.text}>{expanded.activity ? "\u25BC" : "\u25B6"}</text>
                    </Show>
                    <text fg={theme.text}>
                      <b>Activity</b>
                      <Show when={!expanded.activity}>
                        <span style={{ fg: theme.textMuted }}> ({activityItems().length} actions)</span>
                      </Show>
                    </text>
                  </box>
                  <text
                    fg={theme.textMuted}
                    onMouseDown={(e: any) => {
                      e.stopPropagation()
                      command.trigger("session.activity")
                    }}
                  >
                    view all
                  </text>
                </box>
                <Show when={activityItems().length <= 2 || expanded.activity}>
                  <For each={activityItems()}>
                    {(item) => (
                      <box flexDirection="row" gap={1}>
                        <text flexShrink={0} style={{ fg: activityColor(item.status, theme) }}>
                          {item.icon}
                        </text>
                        <text fg={theme.textMuted} wrapMode="none">
                          {item.label}
                        </text>
                      </box>
                    )}
                  </For>
                </Show>
              </box>
            </Show>
            <Show when={diff().length > 0}>
              <box>
                <box
                  flexDirection="row"
                  gap={1}
                  justifyContent="space-between"
                  onMouseDown={() => diff().length > 2 && setExpanded("diff", !expanded.diff)}
                >
                  <box flexDirection="row" gap={1}>
                    <Show when={diff().length > 2}>
                      <text fg={theme.text}>{expanded.diff ? "▼" : "▶"}</text>
                    </Show>
                    <text fg={theme.text}>
                      <b>Modified Files</b>
                    </text>
                  </box>
                  <text
                    fg={theme.textMuted}
                    onMouseDown={(e: any) => {
                      e.stopPropagation()
                      command.trigger("session.undo")
                    }}
                  >
                    revert
                  </text>
                </box>
                <Show when={diff().length <= 2 || expanded.diff}>
                  <For each={diff() || []}>
                    {(item) => {
                      const icon = item.status === "added" ? "+" : item.status === "deleted" ? "-" : "~"
                      const iconColor =
                        item.status === "added"
                          ? theme.diffAdded
                          : item.status === "deleted"
                            ? theme.diffRemoved
                            : theme.warning
                      return (
                        <box flexDirection="row" gap={1} justifyContent="space-between">
                          <box flexDirection="row" gap={1} flexShrink={1}>
                            <text flexShrink={0} fg={iconColor}>
                              {icon}
                            </text>
                            <text fg={theme.textMuted} wrapMode="none">
                              {item.file.split("/").pop()}
                            </text>
                          </box>
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
            <Show
              when={directory().split("/").length > 1}
              fallback={<span style={{ fg: theme.text }}>{directory()}</span>}
            >
              <span style={{ fg: theme.textMuted }}>{directory().split("/").slice(0, -1).join("/")}/</span>
              <span style={{ fg: theme.text }}>{directory().split("/").at(-1)}</span>
            </Show>
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
