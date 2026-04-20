import { useSync } from "@tui/context/sync"
import { createEffect, createMemo, createSignal, For, Match, onCleanup, onMount, Show, Switch } from "solid-js"
import { useTerminalDimensions } from "@opentui/solid"
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
import { EventQuery } from "@/replay/query"
import { activityItems as items } from "./activity"
import { SessionDre } from "./dre"
import { SessionBranch } from "./branch"
import { SessionRollback } from "./rollback"
import { SessionSemanticDiff } from "@/session/semantic-diff"
import type { FooterSessionStatus } from "./footer-view-model"
import { estimateContextEta, formatContextEtaLabel } from "./sidebar-eta"
import { computeSidebarWidth } from "./layout"

export function activityColor(status: string, theme: ReturnType<typeof useTheme>["theme"]) {
  switch (status) {
    case "running":
    case "delegate":
    case "switch":
      return theme.primary
    case "completed":
      return theme.success
    case "error":
      return theme.error
    default:
      return theme.textMuted
  }
}

// Eighth-block characters for sub-pixel progress bar smoothness
const EIGHTHS = ["▏", "▎", "▍", "▌", "▋", "▊", "▉"]

function bar(input: { pct?: number | null; busy: boolean; tick: number; width?: number }) {
  const width = input.width ?? 37
  const pct = Math.max(0, Math.min(100, input.pct ?? 0))
  const exact = (pct / 100) * width
  const fill = Math.floor(exact)
  const partialIdx = Math.floor((exact - fill) * 8) - 1 // -1 = no partial block

  const cells: string[] = Array.from({ length: width }, (_, i) => {
    if (i < fill) return "█"
    if (i === fill && partialIdx >= 0) return EIGHTHS[partialIdx]
    return "░"
  })

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
  const status = createMemo<FooterSessionStatus>(
    () => (sync.data.session_status?.[props.sessionID] as FooterSessionStatus | undefined) ?? { type: "idle" },
  )
  const dimensions = useTerminalDimensions()
  const sidebarWidth = createMemo(() => computeSidebarWidth(dimensions().width))
  // Bar widths scale with sidebar: full bar uses sidebar minus padding, half bar is half of that
  const barWidth = createMemo(() => sidebarWidth() - 5)
  const barWidthHalf = createMemo(() => Math.floor((sidebarWidth() - 6) / 2))

  const [tick, setTick] = createSignal(0)
  const [clockTick, setClockTick] = createSignal(0)
  const [etaAnchor, setEtaAnchor] = createSignal<{
    computedAt: number
    remainSec: number
    totalSec: number
  }>()
  let etaState: {
    sessionID: string
    run?: { startedAt: number; startTokens: number }
    prevStatusType?: FooterSessionStatus["type"]
    prevSample?: { time: number; tokens: number }
    smoothRate?: number
  } = {
    sessionID: props.sessionID,
  }

  onMount(() => {
    const animationId = setInterval(() => {
      if (status().type === "idle") return
      setTick((x) => x + 1)
    }, 120)
    const clockId = setInterval(() => setClockTick((x) => x + 1), 1_000)
    onCleanup(() => {
      clearInterval(animationId)
      clearInterval(clockId)
    })
  })

  const elapsed = createMemo(() => {
    clockTick()
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
    // DRE section defaults to expanded so users see the pending-plan
    // list (or the "DRE is active" placeholder) immediately after
    // enabling the experimental flag. Collapses if the plan list
    // grows beyond 2 entries, same rule as Todo.
    dre: true,
    activity: true,
  })

  const activity = createMemo(() => {
    const msgs = messages()
    const parts = msgs.flatMap((msg) => sync.data.part[msg.id] ?? [])
    const sid = props.sessionID as Parameters<typeof EventQuery.bySessionWithTimestamp>[0]
    const rows = EventQuery.bySessionWithTimestamp(sid)
    return items(parts, rows, sync.data.agent).slice(0, 10)
  })

  const dre = createMemo(() => {
    messages()
    diff()
    status()
    const sid = props.sessionID as Parameters<typeof SessionDre.load>[0]
    return SessionDre.load(sid)
  })

  const branch = createMemo(() => {
    messages()
    const list = sync.data.session
      .filter(
        (item) =>
          item.id === props.sessionID ||
          item.parentID === props.sessionID ||
          item.id === session()?.parentID ||
          item.parentID === session()?.parentID,
      )
      .map((item) => ({ id: item.id, title: item.title }))
    if (list.length <= 1) return
    const semantic = Object.fromEntries(
      list.map((item) => [item.id, SessionSemanticDiff.summarize(sync.data.session_diff[item.id] ?? []) ?? null]),
    )
    return SessionBranch.detail({ currentID: props.sessionID, sessions: list, semantic })
  })

  const rollback = createMemo(() => {
    messages()
    return SessionRollback.load(
      props.sessionID as Parameters<typeof SessionRollback.load>[0],
      messages().map((item) => ({
        info: item,
        parts: sync.data.part[item.id] ?? [],
      })),
    )
  })

  const semantic = createMemo(() => SessionSemanticDiff.summarize(diff()))

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
  createEffect(() => {
    clockTick()
    const sessionID = props.sessionID
    const currentStatus = status()
    const busy = currentStatus.type === "busy"
    const ctx = context()
    if (etaState.sessionID !== sessionID) {
      etaState = { sessionID }
      setEtaAnchor(undefined)
    }
    if (!busy) {
      etaState = {
        sessionID,
        prevStatusType: currentStatus.type,
      }
      setEtaAnchor(undefined)
      return
    }
    if (!ctx || !ctx.limit || !ctx.raw) {
      etaState = {
        sessionID,
        prevStatusType: currentStatus.type,
      }
      setEtaAnchor(undefined)
      return
    }
    const now = Date.now()
    if (!etaState.run || etaState.prevStatusType !== "busy" || ctx.raw < etaState.run.startTokens) {
      etaState = {
        sessionID,
        run: {
          startedAt: currentStatus.startedAt ?? now,
          startTokens: ctx.raw,
        },
        prevStatusType: currentStatus.type,
        prevSample: { time: now, tokens: ctx.raw },
        smoothRate: undefined,
      }
      setEtaAnchor(undefined)
      return
    }
    const result = estimateContextEta({
      now,
      limit: ctx.limit,
      totalTokens: ctx.raw,
      run: etaState.run,
      prevSample: etaState.prevSample,
      smoothRate: etaState.smoothRate,
    })
    etaState = {
      sessionID,
      run: etaState.run,
      prevStatusType: currentStatus.type,
      prevSample: result.prevSample,
      smoothRate: result.smoothRate,
    }
    if (!result.estimate) {
      setEtaAnchor(undefined)
      return
    }
    setEtaAnchor(result.estimate)
  })

  // Countdown display: ticks every 1s, counts down from last anchor
  const eta = createMemo(() => {
    clockTick()
    const anchor = etaAnchor()
    if (!anchor || anchor.remainSec <= 0) return
    const sinceLast = Math.round((Date.now() - anchor.computedAt) / 1000)
    const remainSec = anchor.remainSec - sinceLast
    if (remainSec <= 0) return
    const remainPct = Math.min(100, Math.round((remainSec / anchor.totalSec) * 100))
    const label = formatContextEtaLabel(remainSec)
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
      width: barWidth(),
    })
  })
  // Half-width bars: only computed when ETA is active (two-column path)
  const usageBarHalf = createMemo(() => {
    if (!etaActive()) return ""
    return bar({
      pct: context()?.percentage,
      busy: status().type !== "idle",
      tick: tick(),
      width: barWidthHalf(),
    })
  })
  const etaBarHalf = createMemo(() => {
    const e = eta()
    if (!e) return ""
    const w = barWidthHalf()
    const filled = Math.max(0, Math.min(w, Math.round((e.remainPct / 100) * w)))
    return Array.from({ length: w }, (_, i) => (i < filled ? "▓" : "·")).join("")
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
      {(session) => (
        <box
          backgroundColor={theme.backgroundPanel}
          width={sidebarWidth()}
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
                <Show when={session().share?.url}>{(url) => <text fg={theme.textMuted}>{url()}</text>}</Show>
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
                      <text fg={usageBarColor()}>ctx {context()?.percentage ?? 0}%</text>
                    </>
                  }
                >
                  {(etaValue) => (
                    <>
                      <box flexDirection="row" gap={1}>
                        <text width={barWidthHalf()} fg={theme.textMuted}>
                          {context()?.tokens ?? 0} tokens
                        </text>
                        <text width={barWidthHalf()} fg={theme.textMuted}>
                          Elapsed {elapsed()}
                        </text>
                      </box>
                      <box flexDirection="row" gap={1}>
                        <text width={barWidthHalf()} fg={usageBarColor()}>
                          {usageBarHalf()}
                        </text>
                        <text width={barWidthHalf()} fg={etaBarColor()}>
                          {etaBarHalf()}
                        </text>
                      </box>
                      <box flexDirection="row" gap={1}>
                        <text width={barWidthHalf()} fg={usageBarColor()}>
                          ctx {context()?.percentage ?? 0}%
                        </text>
                        <text width={barWidthHalf()} fg={etaBarColor()}>
                          {etaValue().label}
                        </text>
                      </box>
                    </>
                  )}
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
                      <text fg={theme.text}>{expanded.mcp ? "−" : "+"}</text>
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
              {/* Debugging & Refactoring Engine section. Always shows a
                heading and expands/collapses once the plan list grows
                beyond two entries so users can tell at a glance whether
                DRE is ready to use. Gated on the experimental flag —
                when the flag is off, no section appears. The empty-state
                layout shows tool count and graph readiness. */}
              <Show when={Flag.AX_CODE_EXPERIMENTAL_DEBUG_ENGINE}>
                <box>
                  <box
                    flexDirection="row"
                    gap={1}
                    justifyContent="space-between"
                    onMouseDown={() => sync.data.debugEngine.plans.length > 2 && setExpanded("dre", !expanded.dre)}
                  >
                    <box flexDirection="row" gap={1}>
                      <Show when={sync.data.debugEngine.plans.length > 2}>
                        <text fg={theme.text}>{expanded.dre ? "−" : "+"}</text>
                      </Show>
                      <text fg={theme.text}>
                        <b>Trust</b>
                        <Show when={dre()}>
                          {(summary) => (
                            <span
                              style={{
                                fg:
                                  summary().readiness === "blocked"
                                    ? theme.error
                                    : summary().readiness === "needs_review"
                                      ? theme.warning
                                      : summary().readiness === "needs_validation"
                                        ? theme.warning
                                        : theme.success,
                              }}
                            >
                              {" "}
                              {summary().readiness.replaceAll("_", " ")}
                            </span>
                          )}
                        </Show>
                      </text>
                    </box>
                    <text
                      fg={theme.primary}
                      onMouseDown={(e: any) => {
                        e.stopPropagation()
                      }}
                      onMouseUp={(e: any) => {
                        e.stopPropagation()
                        command.trigger("session.dre.web")
                      }}
                    >
                      dashboard
                    </text>
                  </box>
                  <Show when={sync.data.debugEngine.plans.length <= 2 || expanded.dre}>
                    {/* Graph readiness indicator */}
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
                              : "not indexed · run ax-code index"}
                      </text>
                    </box>
                    {/* Session trust signals — quality, changes, risk drivers, plan */}
                    <Show when={dre()}>
                      {(summary) => (
                        <box flexDirection="column" gap={0}>
                          {/* Quality: test status + confidence + execution stats */}
                          <text fg={theme.textMuted} wrapMode="word">
                            {summary().decision} · confidence {Math.round(summary().confidence * 100)}% ·{" "}
                            {summary().stats}
                          </text>
                          {/* Semantic diff: what changed — accessor pattern avoids unsafe ! assertions */}
                          <Show when={semantic()}>
                            {(sem) => (
                              <box flexDirection="row" gap={1}>
                                <text
                                  flexShrink={0}
                                  style={{
                                    fg:
                                      sem().risk === "high"
                                        ? theme.error
                                        : sem().risk === "medium"
                                          ? theme.warning
                                          : theme.success,
                                  }}
                                >
                                  △
                                </text>
                                <text fg={theme.textMuted} wrapMode="word">
                                  {sem().headline} · {sem().risk} change risk
                                </text>
                              </box>
                            )}
                          </Show>
                          {/* Risk drivers: specific findings */}
                          <Show when={summary().drivers.length > 0}>
                            <For each={summary().drivers}>
                              {(line) => (
                                <box flexDirection="row" gap={1}>
                                  <text flexShrink={0} style={{ fg: theme.primary }}>
                                    ▸
                                  </text>
                                  <text fg={theme.textMuted} wrapMode="word">
                                    {line}
                                  </text>
                                </box>
                              )}
                            </For>
                          </Show>
                          {/* Plan: what the session accomplished — always shown when non-empty */}
                          <Show when={summary().plan}>
                            <text fg={theme.textMuted} wrapMode="word">
                              {summary().plan}
                            </text>
                          </Show>
                        </box>
                      )}
                    </Show>
                    {/* Pending refactor plans */}
                    <Show when={sync.data.debugEngine.plans.length > 0}>
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
                              ◆
                            </text>
                            <text fg={theme.textMuted}>
                              {plan.kind} · {plan.affectedFileCount} file
                              {plan.affectedFileCount === 1 ? "" : "s"}
                            </text>
                          </box>
                        )}
                      </For>
                    </Show>
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
                      <text fg={theme.text}>{expanded.todo ? "−" : "+"}</text>
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
              <Show when={activity().length > 0}>
                <box>
                  <box
                    flexDirection="row"
                    gap={1}
                    justifyContent="space-between"
                    onMouseDown={() => activity().length > 2 && setExpanded("activity", !expanded.activity)}
                  >
                    <box flexDirection="row" gap={1}>
                      <Show when={activity().length > 2}>
                        <text fg={theme.text}>{expanded.activity ? "−" : "+"}</text>
                      </Show>
                      <text fg={theme.text}>
                        <b>Activity</b>
                        <Show when={!expanded.activity}>
                          <span style={{ fg: theme.textMuted }}> ({activity().length} actions)</span>
                        </Show>
                      </text>
                    </box>
                    <text
                      fg={theme.textMuted}
                      onMouseDown={(e: any) => {
                        e.stopPropagation()
                      }}
                      onMouseUp={(e: any) => {
                        e.stopPropagation()
                        command.trigger("session.activity")
                      }}
                    >
                      view all
                    </text>
                  </box>
                  <Show when={activity().length <= 2 || expanded.activity}>
                    <For each={activity()}>
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
                        <text fg={theme.text}>{expanded.diff ? "−" : "+"}</text>
                      </Show>
                      <text fg={theme.text}>
                        <b>Modified Files</b>
                      </text>
                    </box>
                    <box flexDirection="row" gap={1}>
                      <Show when={rollback().length > 0}>
                        <text
                          fg={theme.textMuted}
                          onMouseUp={(e: any) => {
                            e.stopPropagation()
                            command.trigger("session.rollback")
                          }}
                        >
                          steps
                        </text>
                      </Show>
                      <text
                        fg={theme.textMuted}
                        onMouseDown={(e: any) => {
                          e.stopPropagation()
                        }}
                        onMouseUp={(e: any) => {
                          e.stopPropagation()
                          command.trigger("session.undo")
                        }}
                      >
                        revert
                      </text>
                    </box>
                  </box>
                  <Show when={diff().length <= 2 || expanded.diff}>
                    <Show when={rollback().length > 0}>
                      <box flexDirection="row" gap={1}>
                        <text flexShrink={0} style={{ fg: theme.warning }}>
                          ↳
                        </text>
                        <text
                          fg={theme.textMuted}
                          wrapMode="word"
                          onMouseUp={(e: any) => {
                            e.stopPropagation()
                            command.trigger("session.rollback")
                          }}
                        >
                          {SessionRollback.summary(rollback()) ?? ""}
                        </text>
                      </box>
                    </Show>
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
      )}
    </Show>
  )
}
