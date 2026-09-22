import { useLanguage } from "@tui/context/language"
import { DialogFollowUps } from "../../component/dialog-follow-ups"
import { useContentDimensions } from "@tui/context/content-dimensions"
import { useSync } from "@tui/context/sync"
import { createMemo, createEffect, untrack, type Accessor, For, Match, Show, Switch } from "solid-js"
import { createStore } from "solid-js/store"
import { useTheme } from "../../context/theme"
import { Installation } from "@/installation"
import { useDirectory } from "../../context/directory"
import { useKV } from "../../context/kv"
import { ModeChips } from "../../component/mode-chips"
import { GoalChip } from "../../component/goal-chip"
import { TodoItem } from "../../component/todo-item"
import { ChromeAction, ChromeWidthAction } from "../../component/chrome-action"
import { useCommandDialog } from "../../component/dialog-command"
import { useSDK } from "@tui/context/sdk"
import { useToast } from "../../ui/toast"
import { Log } from "@/util/log"
import { Flag } from "@/flag/flag"
import { EventQuery } from "@/replay/query"
import { activityItems as items } from "./activity"
import { SessionDreView } from "./dre"
import { SessionRollbackView } from "./rollback"
import { SessionSemanticDiff } from "@/session/semantic-diff"
import { Todo } from "@/session/todo"
import { footerSessionStatusOrIdle } from "./footer-view-model"
import { followUpText, isQueueableStatus } from "../../component/prompt/follow-up-queue"
import { steerBarrier, steerFollowUp } from "../../component/prompt/steer-follow-up"
import { useKeybind } from "../../context/keybind"
import {
  durableFollowUps,
  followUpAction,
  pauseFollowUp,
  followUpBody,
  followUpStatus,
  type DurableFollowUp,
} from "../../component/prompt/durable-follow-up"
import { DialogPrompt } from "../../ui/dialog-prompt"
import { useDialog } from "../../ui/dialog"

import { SIDEBAR_WIDTH_DEFAULT, chromeWidth } from "../../chrome-width"
import { computeSidebarWidth } from "./layout"
import { sidebarGraphIndexStatusText } from "./sidebar-index-view-model"
import { sidebarLocalInferenceView } from "./sidebar-local-inference-view-model"
import { Locale } from "@/util/locale"
import type { McpStatus } from "@ax-code/sdk/v2"
import type { SyncedSessionQualityReadiness } from "../../context/sync-session-risk"
import { countByWorkflow as countFindingsByWorkflow } from "@/quality/finding-counts"
import {
  hasSidebarSignal,
  renderSessionChecksSummary,
  renderSessionDebugCasesSummary,
  renderSessionDecisionHintsSummary,
  renderSessionQualitySidebarLine,
  renderSessionReviewResultsSummary,
  sessionQualityActions,
  sessionQualityActionValue,
  sessionQualityWorkflowIcon,
} from "./quality"
import {
  isWorkflowStatusAttention,
  renderWorkflowDashboardHeader,
  renderWorkflowStatusSidebarLine,
  visibleWorkflowSidebarRuns,
} from "./workflow-status"

const log = Log.create({ service: "tui.sidebar.queue" })

const QUEUED_DELETE_ICON = "x"
const QUEUED_DELETE_ICON_WIDTH = 2
const QUEUED_SEND_ICON = "▸"
const QUEUED_SEND_ICON_WIDTH = 2
const QUEUED_STEER_ICON = "»"
const QUEUED_STEER_ICON_WIDTH = 2
const QUEUED_EDIT_ICON = "✎"
const QUEUED_EDIT_ICON_WIDTH = 2

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

function mcpStatusColor(theme: ReturnType<typeof useTheme>["theme"], status: McpStatus["status"]) {
  switch (status) {
    case "connected":
      return theme.success
    case "failed":
      return theme.error
    case "needs_auth":
      return theme.warning
    case "needs_client_registration":
      return theme.error
    case "disabled":
      return theme.textMuted
    default:
      return theme.textMuted
  }
}

function qualityColor(
  status: SyncedSessionQualityReadiness["overallStatus"],
  theme: ReturnType<typeof useTheme>["theme"],
) {
  if (status === "pass") return theme.success
  if (status === "warn") return theme.warning
  if (status === "fail") return theme.error
  return theme.textMuted
}

function workflowColor(status: string, theme: ReturnType<typeof useTheme>["theme"]) {
  if (status === "running") return theme.primary
  if (status === "blocked" || status === "failed" || status === "cancelled") return theme.error
  if (status === "completed") return theme.success
  if (status === "paused") return theme.warning
  return theme.textMuted
}

export function Sidebar(props: { sessionID: string; overlay?: boolean; statusTick?: Accessor<number> }) {
  const uiText = useLanguage().t

  const sync = useSync()
  const sdk = useSDK()
  const toast = useToast()
  const { theme } = useTheme()
  const command = useCommandDialog()
  const keybind = useKeybind()

  const session = createMemo(() => sync.session.get(props.sessionID))
  const risk = createMemo(() => sync.session.risk(props.sessionID))
  const diff = createMemo(() => sync.data.session_diff[props.sessionID] ?? [])
  const todo = createMemo(() => sync.data.todo[props.sessionID] ?? [])
  const messages = createMemo(() => sync.data.message[props.sessionID] ?? [])
  const status = createMemo(() => {
    const candidate = sync.data.session_status?.[props.sessionID]
    return footerSessionStatusOrIdle(candidate)
  })
  const dimensions = useContentDimensions()
  const kv = useKV()
  const sidebarWidth = createMemo(() => computeSidebarWidth(dimensions().width, kv.get("sidebar_width")))

  const todoRemaining = createMemo(() => Todo.countActive(todo()))

  const queueDialog = useDialog()
  const queued = createMemo(() => durableFollowUps(sync.data.task_queue, props.sessionID))

  const [expanded, setExpanded] = createStore({
    mcp: true,
    diff: true,
    todo: true,
    queued: true,
    // DRE section defaults to expanded so users see the pending-plan
    // list (or the "DRE is active" placeholder) immediately after
    // enabling the experimental flag. Collapses if the plan list
    // grows beyond 2 entries, same rule as Todo.
    dre: true,
    workflows: true,
    activity: true,
  })

  // When the queue drains to zero, reset the expanded flag so the section
  // opens automatically the next time items are enqueued. Without this, a user
  // who collapsed a queue of 3+ items would see an empty collapsed section on
  // the next enqueue and have to manually expand it again.
  createEffect(() => {
    if (queued().length === 0) setExpanded("queued", true)
  })

  function updateQueue(item: DurableFollowUp) {
    sync.set("task_queue", (rows) => [...rows.filter((row) => row.id !== item.id), item])
  }

  async function queueOperation(run: () => Promise<void>) {
    try {
      await run()
    } catch (error) {
      log.warn("follow-up action failed", { error })
      toast.show({ message: error instanceof Error ? error.message : "Follow-up action failed", variant: "error" })
    }
  }

  function dropQueued(id: string) {
    void queueOperation(async () => updateQueue(await followUpAction(sdk, id, "cancel")))
  }

  function editQueued(id: string) {
    void queueOperation(async () => {
      // Pause first: editing cannot race a queued body into execution.
      const paused = await pauseFollowUp(sdk, id)
      updateQueue(paused)
      const body = followUpBody(paused)
      const text = await DialogPrompt.show(queueDialog, "Edit paused follow-up", {
        value: followUpText(body),
        placeholder: uiText("ui.saveChangesThenResumeWhenReady"),
      })
      if (text === null) return
      const parts = [...body.parts]
      const index = parts.findIndex((part) => part.type === "text")
      if (index < 0) parts.unshift({ type: "text", text })
      else parts[index] = { ...parts[index], text }
      updateQueue(
        await followUpAction(sdk, id, "edit", {
          expectedUpdatedAt: paused.time.updated,
          title: text.trim().slice(0, 200) || "Follow-up",
          payload: { ...paused.payload, body: { ...body, parts } },
        }),
      )
      toast.show({ message: uiText("ui.followUpSavedAndPausedResumeWhenReady"), variant: "info" })
    })
  }

  async function togglePauseQueued(id: string) {
    await queueOperation(async () => {
      const item = queued().find((row) => row.id === id)
      if (!item) return
      updateQueue(await followUpAction(sdk, id, item.status === "paused" ? "resume" : "pause"))
    })
  }

  // Steer-now: inject the row into the running turn at its next step boundary
  // via the atomic server endpoint; when no generation is active the row is
  // prioritized to the front of the queue instead and the toast says so.
  async function steerQueued(id: string) {
    await queueOperation(async () => {
      const item = queued().find((row) => row.id === id)
      if (!item) return
      const outcome = await steerFollowUp(sdk, item)
      if (outcome.kind === "delivered") {
        updateQueue(outcome.item)
        toast.show({ message: uiText("ui.steeredFollowUps", { count: 1 }), variant: "info" })
        return
      }
      if (outcome.kind === "queued_next") {
        updateQueue(outcome.item)
        toast.show({ message: uiText("ui.steerQueuedNext"), variant: "info" })
        return
      }
      toast.show({ message: uiText("ui.steerFailed", { message: outcome.message }), variant: "error" })
    })
  }

  // Coarse refresh key for sidebar surfaces that read the session event log.
  // Changes only when the message count grows or the session status type
  // transitions (e.g. running -> idle), NOT on every streamed part update.
  // This gates the expensive full-log SQLite loads behind a low-frequency
  // signal while leaving the cheap in-memory derivations fully reactive.
  const logRefreshKey = createMemo(() => `${messages().length}:${status().type}`)

  // The event-log rows feeding the activity list are fetched behind the coarse
  // key so a full SELECT no longer runs on every message.part.updated. The
  // activity list only ever displays ~10 items, so a LIMITed recent query
  // returns the same visible items as the previous full-log load. Parts stay
  // reactive in the memo below so tool activity still updates live.
  //
  // The window (all event types, not just the route/agent-control rows the list
  // consumes) is sized well above the largest realistic per-turn event burst so
  // a sparse-but-recent routing/control event can't be evicted from the top-10
  // by unrelated lifecycle events. Event-log rows are discrete lifecycle events
  // (no streaming deltas), so this covers many dozens of steps; the only residual
  // gap is a cosmetic missing/stale Activity row in a pathologically long turn,
  // never a wrong rollback target. A type-filtered recent query would make this
  // provably exact and is the natural follow-up.
  const ACTIVITY_ROW_WINDOW = 400
  const activityRows = createMemo(() => {
    logRefreshKey()
    const sid = props.sessionID as Parameters<typeof EventQuery.recentBySessionWithTimestamp>[0]
    return EventQuery.recentBySessionWithTimestamp(sid, ACTIVITY_ROW_WINDOW)
  })
  const activity = createMemo(() => {
    const msgs = messages()
    const parts = msgs.flatMap((msg) => sync.data.part[msg.id] ?? [])
    return items(parts, activityRows(), sync.data.agent, 10)
  })
  const localInference = createMemo(() => {
    props.statusTick?.()
    return sidebarLocalInferenceView({
      messages: messages(),
      partsByMessage: sync.data.part,
      now: Date.now(),
    })
  })

  const dre = createMemo(() => {
    messages()
    diff()
    status()
    const sid = props.sessionID as Parameters<typeof SessionDreView.load>[0]
    return SessionDreView.load(sid)
  })

  // The sidebar only renders the rollback step count and step numbers (via
  // SessionRollbackView.summary + `.length`), never the graph-derived tool
  // detail. Use the cheap points()-only path (indexed step.start query, no
  // execution-graph build) and recompute on the coarse key instead of on
  // every streamed part update — the previous load() ran two full 10k-row
  // loads plus a graph build per assistant step. Message/part reads are
  // untracked so the coarse key is the sole reactive trigger.
  const rollback = createMemo(() => {
    logRefreshKey()
    return untrack(() =>
      SessionRollbackView.points(
        props.sessionID as Parameters<typeof SessionRollbackView.points>[0],
        messages().map((item) => ({
          info: item,
          parts: sync.data.part[item.id] ?? [],
        })),
      ),
    )
  })

  const semantic = createMemo(() => SessionSemanticDiff.summarize(diff()))
  const qualityActions = createMemo(() =>
    sessionQualityActions({
      sessionID: props.sessionID,
      quality: risk()?.quality,
    }),
  )
  const findingCounts = createMemo(() => countFindingsByWorkflow(risk()?.findings ?? []))
  // Only surface workflows that have a user-actionable signal — see
  // hasSidebarSignal. The /quality dialog still uses qualityActions() directly.
  const sidebarQualityActions = createMemo(() =>
    qualityActions().filter((action) => hasSidebarSignal(action, findingCounts()[action.workflow]?.total)),
  )
  const checksSummary = createMemo(() => renderSessionChecksSummary(risk()?.envelopes ?? []))
  const reviewResultsSummary = createMemo(() => renderSessionReviewResultsSummary(risk()?.reviewResults ?? []))
  const decisionHintsSummary = createMemo(() => renderSessionDecisionHintsSummary(risk()?.decisionHints))
  const debugCasesSummary = createMemo(() =>
    renderSessionDebugCasesSummary({
      cases: risk()?.debug?.cases ?? [],
      hypotheses: risk()?.debug?.hypotheses ?? [],
      rollups: risk()?.debug?.rollups,
    }),
  )
  const workflowRuns = createMemo(() => visibleWorkflowSidebarRuns(sync.data.workflowDashboard))

  // Sort MCP servers alphabetically for consistent display order
  const mcpEntries = createMemo(() =>
    Object.entries(sync.data.mcp as Record<string, McpStatus>).sort(([a], [b]) => a.localeCompare(b)),
  )

  // Count connected and error MCP servers for collapsed header display
  const connectedMcpCount = createMemo(() => mcpEntries().filter(([_, item]) => item.status === "connected").length)
  const errorMcpCount = createMemo(
    () =>
      mcpEntries().filter(
        ([_, item]) =>
          item.status === "failed" || item.status === "needs_auth" || item.status === "needs_client_registration",
      ).length,
  )

  const directory = useDirectory()

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
              <Show when={mcpEntries().length > 0}>
                <box backgroundColor={theme.backgroundElement} paddingLeft={1} paddingRight={1}>
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
                          ({connectedMcpCount()} {uiText("ui.active2")}
                          {errorMcpCount() > 0 ? `, ${Locale.pluralize(errorMcpCount(), "{} error", "{} errors")}` : ""}
                          )
                        </span>
                      </Show>
                    </text>
                  </box>

                  <Show when={mcpEntries().length <= 2 || expanded.mcp}>
                    <For each={mcpEntries()}>
                      {([key, item]) => (
                        <box flexDirection="row" gap={1}>
                          <text flexShrink={0} style={{ fg: mcpStatusColor(theme, item.status) }}>
                            •
                          </text>
                          <text fg={theme.text} wrapMode="word">
                            {key}{" "}
                            <span style={{ fg: theme.textMuted }}>
                              <Switch fallback={item.status}>
                                <Match when={item.status === "connected"}>{uiText("ui.connected")}</Match>
                                <Match when={item.status === "failed" && item}>{(val) => <i>{val().error}</i>}</Match>
                                <Match when={item.status === "disabled"}>{uiText("ensemble.disabled")}</Match>
                                <Match when={item.status === "needs_auth"}>{uiText("ui.needsAuth")}</Match>
                                <Match when={item.status === "needs_client_registration" && item}>
                                  {(val) => <i>{val().error}</i>}
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
                <box backgroundColor={theme.backgroundElement} paddingLeft={1} paddingRight={1}>
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
                        <b>{uiText("ui.analysis")}</b>
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
                      {uiText("ui.dashboard")}
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
                      <text fg={theme.textMuted}>{sidebarGraphIndexStatusText(sync.data.debugEngine.graph)}</text>
                    </box>
                    {/* Session trust signals — quality, changes, risk drivers, plan */}
                    <Show when={dre()}>
                      {(summary) => (
                        <box flexDirection="column" gap={0}>
                          {/* Quality: test status + confidence + execution stats */}
                          <text fg={theme.textMuted} wrapMode="word">
                            {summary().decision} {uiText("ui.confidence")} {Math.round(summary().confidence * 100)}% ·{" "}
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
                                  {sem().headline} · {sem().risk} {uiText("ui.changeRisk")}
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
                              {plan.kind} · {uiText("ui.fileCount", { count: plan.affectedFileCount })}
                            </text>
                          </box>
                        )}
                      </For>
                    </Show>
                  </Show>
                </box>
              </Show>
              <Show when={queued().length > 0}>
                <box backgroundColor={theme.backgroundElement} paddingLeft={1} paddingRight={1}>
                  <box
                    flexDirection="row"
                    gap={1}
                    onMouseDown={() => queued().length > 2 && setExpanded("queued", !expanded.queued)}
                  >
                    <Show when={queued().length > 2}>
                      <text fg={theme.text}>{expanded.queued ? "−" : "+"}</text>
                    </Show>
                    <text fg={theme.text}>
                      <b>
                        {uiText("ui.followUps")}
                        {sdk.sseConnected ? "" : ` (${uiText("ui.cached")})`}
                      </b>
                      <span style={{ fg: theme.textMuted }}> ({queued().length})</span>
                    </text>
                  </box>

                  <Show when={queued().length <= 2 || expanded.queued}>
                    <For each={queued()}>
                      {(item) => (
                        <box flexDirection="row" gap={1}>
                          <Show when={["queued", "waiting_for_idle", "paused"].includes(item.status)}>
                            <box
                              flexShrink={0}
                              width={QUEUED_EDIT_ICON_WIDTH}
                              onMouseUp={() => {
                                editQueued(item.id)
                              }}
                            >
                              <text style={{ fg: theme.text }}>{QUEUED_EDIT_ICON}</text>
                            </box>
                            <Show when={steerBarrier(item) === null}>
                              <box
                                flexShrink={0}
                                width={QUEUED_STEER_ICON_WIDTH}
                                onMouseUp={() => {
                                  void steerQueued(item.id)
                                }}
                              >
                                <text style={{ fg: theme.accent }}>{QUEUED_STEER_ICON}</text>
                              </box>
                            </Show>
                            <box
                              flexShrink={0}
                              width={QUEUED_SEND_ICON_WIDTH}
                              onMouseUp={() => {
                                void togglePauseQueued(item.id)
                              }}
                            >
                              <text style={{ fg: theme.primary }}>
                                {item.status === "paused" ? QUEUED_SEND_ICON : "Ⅱ"}
                              </text>
                            </box>
                            <box
                              flexShrink={0}
                              width={QUEUED_DELETE_ICON_WIDTH}
                              onMouseUp={() => {
                                dropQueued(item.id)
                              }}
                            >
                              <text style={{ fg: theme.warning }}>{QUEUED_DELETE_ICON}</text>
                            </box>
                          </Show>
                          <box
                            flexGrow={1}
                            onMouseUp={() =>
                              queueDialog.replace(() => (
                                <DialogFollowUps
                                  sessionID={props.sessionID}
                                  onAttention={() => command.trigger("session.attention")}
                                />
                              ))
                            }
                          >
                            <text fg={theme.textMuted} wrapMode="word">
                              {followUpStatus(item)}: {item.title}
                            </text>
                          </box>
                        </box>
                      )}
                    </For>
                  </Show>
                  <Show when={isQueueableStatus(status().type) && keybind.print("input_submit_steer")}>
                    <text fg={theme.textMuted}>
                      {uiText("ui.steerNowHint", { keybind: keybind.print("input_submit_steer") })}
                    </text>
                  </Show>
                </box>
              </Show>
              <Show when={todoRemaining() > 0}>
                <box backgroundColor={theme.backgroundElement} paddingLeft={1} paddingRight={1}>
                  <box
                    flexDirection="row"
                    gap={1}
                    onMouseDown={() => todoRemaining() > 2 && setExpanded("todo", !expanded.todo)}
                  >
                    <Show when={todoRemaining() > 2}>
                      <text fg={theme.text}>{expanded.todo ? "−" : "+"}</text>
                    </Show>
                    <text fg={theme.text}>
                      <b>{uiText("ui.todo")}</b>
                      <Show when={!expanded.todo}>
                        <span style={{ fg: theme.textMuted }}>
                          {" "}
                          ({todoRemaining()} {uiText("ui.remaining")}
                        </span>
                      </Show>
                    </text>
                  </box>

                  <Show when={todoRemaining() <= 2 || expanded.todo}>
                    <For each={todo()}>{(item) => <TodoItem status={item.status} content={item.content} />}</For>
                  </Show>
                </box>
              </Show>
              <Show when={sidebarQualityActions().length > 0}>
                <box backgroundColor={theme.backgroundElement} paddingLeft={1} paddingRight={1}>
                  <box flexDirection="row" justifyContent="space-between">
                    <text fg={theme.text}>
                      <b>{uiText("ui.quality")}</b>
                    </text>
                    <text
                      fg={theme.textMuted}
                      onMouseUp={() => {
                        command.trigger("session.quality")
                      }}
                    >
                      {uiText("ui.viewAll")}
                    </text>
                  </box>

                  <For each={sidebarQualityActions()}>
                    {(action) => (
                      <box
                        flexDirection="row"
                        gap={1}
                        onMouseUp={() => {
                          command.trigger(sessionQualityActionValue(action))
                        }}
                      >
                        <text flexShrink={0} style={{ fg: qualityColor(action.summary.overallStatus, theme) }}>
                          {sessionQualityWorkflowIcon(action.workflow)}
                        </text>
                        <text fg={theme.textMuted} wrapMode="word">
                          {renderSessionQualitySidebarLine(action, {
                            counts: findingCounts()[action.workflow],
                          })}
                        </text>
                      </box>
                    )}
                  </For>
                </box>
              </Show>
              <Show when={checksSummary().length > 0}>
                <box backgroundColor={theme.backgroundElement} paddingLeft={1} paddingRight={1}>
                  <box flexDirection="row" justifyContent="space-between">
                    <text fg={theme.text}>
                      <b>{uiText("ui.checks")}</b>
                    </text>
                  </box>

                  <text fg={theme.textMuted} wrapMode="word">
                    {checksSummary()}
                  </text>
                </box>
              </Show>
              <Show when={reviewResultsSummary().length > 0}>
                <box backgroundColor={theme.backgroundElement} paddingLeft={1} paddingRight={1}>
                  <box flexDirection="row" justifyContent="space-between">
                    <text fg={theme.text}>
                      <b>{uiText("ui.review")}</b>
                    </text>
                  </box>

                  <text fg={theme.textMuted} wrapMode="word">
                    {reviewResultsSummary()}
                  </text>
                </box>
              </Show>
              <Show when={decisionHintsSummary().length > 0}>
                <box backgroundColor={theme.backgroundElement} paddingLeft={1} paddingRight={1}>
                  <box flexDirection="row" justifyContent="space-between">
                    <text fg={theme.text}>
                      <b>{uiText("ui.hints")}</b>
                    </text>
                  </box>

                  <text fg={theme.textMuted} wrapMode="word">
                    {decisionHintsSummary()}
                  </text>
                </box>
              </Show>
              <Show when={debugCasesSummary().length > 0}>
                <box backgroundColor={theme.backgroundElement} paddingLeft={1} paddingRight={1}>
                  <box flexDirection="row" justifyContent="space-between">
                    <text fg={theme.text}>
                      <b>{uiText("ui.cases")}</b>
                    </text>
                  </box>

                  <text fg={theme.textMuted} wrapMode="word">
                    {debugCasesSummary()}
                  </text>
                </box>
              </Show>
              <Show when={workflowRuns().length > 0}>
                <box backgroundColor={theme.backgroundElement} paddingLeft={1} paddingRight={1}>
                  <box
                    flexDirection="row"
                    gap={1}
                    justifyContent="space-between"
                    onMouseDown={() => workflowRuns().length > 2 && setExpanded("workflows", !expanded.workflows)}
                  >
                    <box flexDirection="row" gap={1}>
                      <Show when={workflowRuns().length > 2}>
                        <text fg={theme.text}>{expanded.workflows ? "-" : "+"}</text>
                      </Show>
                      <text fg={theme.text}>
                        <b>{renderWorkflowDashboardHeader(sync.data.workflowDashboard)}</b>
                      </text>
                    </box>
                  </box>

                  <Show when={workflowRuns().length <= 2 || expanded.workflows}>
                    <For each={workflowRuns()}>
                      {(run) => (
                        <box flexDirection="row" gap={1}>
                          <text flexShrink={0} style={{ fg: workflowColor(run.status, theme) }}>
                            {isWorkflowStatusAttention(run.status) ? "!" : "W"}
                          </text>
                          <text fg={theme.textMuted} wrapMode="word">
                            {renderWorkflowStatusSidebarLine(run)}
                          </text>
                        </box>
                      )}
                    </For>
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
                        <b>{uiText("ui.activity")}</b>
                        <Show when={!expanded.activity}>
                          <span style={{ fg: theme.textMuted }}>
                            {" "}
                            ({activity().length} {uiText("ui.actions")}
                          </span>
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
                      {uiText("ui.viewAll")}
                    </text>
                  </box>
                  {/* Activity has no panel background, so it keeps one rule as
                      the only structural divider left in the sidebar. */}
                  <box border={["top"]} borderColor={theme.borderSubtle} />
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
                <box backgroundColor={theme.backgroundElement} paddingLeft={1} paddingRight={1}>
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
                        <b>{uiText("ui.modifiedFiles")}</b>
                      </text>
                    </box>
                    <box flexDirection="row" gap={1}>
                      <Show when={rollback().length > 0}>
                        <text
                          fg={theme.textMuted}
                          onMouseDown={(e: any) => {
                            e.stopPropagation()
                          }}
                          onMouseUp={(e: any) => {
                            e.stopPropagation()
                            command.trigger("session.rollback")
                          }}
                        >
                          {uiText("ui.steps")}
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
                        {uiText("ui.revert2")}
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
                          {SessionRollbackView.summary(rollback()) ?? ""}
                        </text>
                      </box>
                    </Show>
                    <For each={diff()}>
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
            <Show when={localInference()}>
              {(metrics) => (
                <box gap={0}>
                  <text fg={theme.text}>
                    <b>{uiText("ui.localInference")}</b>{" "}
                    <span style={{ fg: theme.textMuted }}>{metrics().modelID}</span>
                  </text>
                  <text fg={theme.textMuted} wrapMode="none">
                    {uiText("ui.prefill")} {metrics().prefillRate ?? "--"} {uiText("ui.decode")}{" "}
                    {metrics().decodeRate ?? "--"}
                  </text>
                </box>
              )}
            </Show>
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
                      <b>{uiText("ui.gettingStarted")}</b>
                    </text>
                    <text fg={theme.textMuted} onMouseUp={() => kv.set("dismissed_getting_started", true)}>
                      ✕
                    </text>
                  </box>
                  <text fg={theme.textMuted}>{uiText("ui.axCodeIncludesModelsYouCanStartWithImmediately")}</text>
                  <text fg={theme.textMuted}>
                    {uiText("ui.connectFrom75ProvidersToUseOtherModelsIncludingClaudeGptGeminiEtc")}
                  </text>
                  <box flexDirection="row" gap={1} justifyContent="space-between">
                    <text fg={theme.text}>{uiText("command.connect")}</text>
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
            <box flexShrink={0} flexDirection="row" gap={2} flexWrap="wrap">
              <ChromeAction onMouseUp={() => command.trigger("session.sidebar.toggle")}>/sidebar</ChromeAction>
              <ChromeWidthAction
                width={chromeWidth(kv.get("sidebar_width"), SIDEBAR_WIDTH_DEFAULT)}
                onMouseUp={() => command.trigger("session.sidebar.width")}
              />
            </box>
            <ModeChips />
            <GoalChip sessionID={props.sessionID} />
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
