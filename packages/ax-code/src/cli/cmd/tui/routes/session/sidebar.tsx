import { useSync } from "@tui/context/sync"
import { createMemo, type Accessor, For, Match, Show, Switch } from "solid-js"
import { useTerminalDimensions } from "@opentui/solid"
import { createStore } from "solid-js/store"
import { useTheme } from "../../context/theme"
import { Installation } from "@/installation"
import { useDirectory } from "../../context/directory"
import { useKV } from "../../context/kv"
import { TodoItem } from "../../component/todo-item"
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
import { footerSessionStatusOrIdle, footerSessionStatusView } from "./footer-view-model"
import { computeSidebarWidth } from "./layout"
import { sidebarGraphIndexStatusText } from "./sidebar-index-view-model"
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

const log = Log.create({ service: "tui.sidebar.queue" })

const QUEUED_DELETE_ICON = "🗑️"
const QUEUED_DELETE_ICON_WIDTH = 2
const QUEUE_SNIPPET_MAX = 48

function queuedSnippet(parts: { type: string; text?: string; synthetic?: boolean; ignored?: boolean }[]) {
  const text = parts.find((p) => p.type === "text" && !p.synthetic && !p.ignored)?.text?.trim()
  if (!text) return "(empty message)"
  const single = text.replace(/\s+/g, " ")
  return single.length > QUEUE_SNIPPET_MAX ? single.slice(0, QUEUE_SNIPPET_MAX - 1) + "…" : single
}

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

export function Sidebar(props: { sessionID: string; overlay?: boolean; statusTick?: Accessor<number> }) {
  const sync = useSync()
  const sdk = useSDK()
  const toast = useToast()
  const { theme } = useTheme()
  const command = useCommandDialog()

  const session = createMemo(() => sync.session.get(props.sessionID))
  const risk = createMemo(() => sync.session.risk(props.sessionID))
  const diff = createMemo(() => sync.data.session_diff[props.sessionID] ?? [])
  const todo = createMemo(() => sync.data.todo[props.sessionID] ?? [])
  const messages = createMemo(() => sync.data.message[props.sessionID] ?? [])
  const status = createMemo(() => {
    const candidate = sync.data.session_status?.[props.sessionID]
    return footerSessionStatusOrIdle(candidate)
  })
  const sidebarStatusView = createMemo(() => {
    props.statusTick?.()
    const current = status()
    if (current.type === "idle") return undefined
    return footerSessionStatusView({ status: current, now: Date.now() })
  })
  const sidebarStatusLabel = createMemo(() => sidebarStatusView()?.label)
  const dimensions = useTerminalDimensions()
  const sidebarWidth = createMemo(() => computeSidebarWidth(dimensions().width))

  const todoRemaining = createMemo(() => Todo.countActive(todo()))

  // A user message is "queued" iff the loop has not yet picked it up,
  // i.e. no assistant message references it as `parentID`. We can't gate
  // on assistant `finish` strings: in autonomous tool-heavy turns the
  // whole turn is a chain of `finish: "tool-calls"` steps with no
  // terminal `stop` ever emitted, so a finish-based cutoff would treat
  // already-addressed users as still pending and offer a delete that
  // the server (correctly) refuses with a busy error. The parent-link
  // signal matches what the server checks on delete.
  const queued = createMemo(() => {
    if (status().type === "idle") return []
    const msgs = messages()
    const addressed = new Set<string>()
    for (const m of msgs) {
      if (m.role === "assistant") addressed.add(m.parentID)
    }
    return msgs.filter((m) => m.role === "user" && !addressed.has(m.id))
  })

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
    activity: true,
  })

  async function dropQueued(messageID: string) {
    if (!queued().some((m) => m.id === messageID)) return
    // The generated SDK has ThrowOnError=false by default, so server-side
    // 4xx/5xx come back via `result.error` instead of a thrown exception.
    // Without this branch the failure was swallowed silently.
    try {
      const result = await sdk.client.session.deleteMessage({ sessionID: props.sessionID, messageID })
      if (result.error) {
        const detail = (result.error as { data?: { message?: string } })?.data?.message
        log.warn("delete queued message rejected", {
          command: "tui.sidebar.queue.delete",
          status: "error",
          sessionID: props.sessionID,
          messageID,
          error: result.error,
        })
        toast.show({ message: detail ?? "Failed to remove queued message", variant: "error" })
      }
    } catch (error) {
      log.warn("delete queued message failed", {
        command: "tui.sidebar.queue.delete",
        status: "error",
        sessionID: props.sessionID,
        messageID,
        error,
      })
      toast.show({ message: "Failed to remove queued message", variant: "error" })
    }
  }

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
    const sid = props.sessionID as Parameters<typeof SessionDreView.load>[0]
    return SessionDreView.load(sid)
  })

  const rollback = createMemo(() => {
    messages()
    return SessionRollbackView.load(
      props.sessionID as Parameters<typeof SessionRollbackView.load>[0],
      messages().map((item) => ({
        info: item,
        parts: sync.data.part[item.id] ?? [],
      })),
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
                <text fg={theme.textMuted}>{session().id}</text>
                <Show when={sidebarStatusLabel()}>
                  {(label) => (
                    <text fg={theme.warning} wrapMode="none">
                      {label()}
                    </text>
                  )}
                </Show>
                <Show when={session().share?.url}>{(url) => <text fg={theme.textMuted}>{url()}</text>}</Show>
              </box>
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
                          ({connectedMcpCount()} active
                          {errorMcpCount() > 0 ? `, ${Locale.pluralize(errorMcpCount(), "{} error", "{} errors")}` : ""}
                          )
                        </span>
                      </Show>
                    </text>
                  </box>
                  <box border={["top"]} borderColor={theme.borderSubtle} />
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
                                <Match when={item.status === "connected"}>Connected</Match>
                                <Match when={item.status === "failed" && item}>{(val) => <i>{val().error}</i>}</Match>
                                <Match when={item.status === "disabled"}>Disabled</Match>
                                <Match when={item.status === "needs_auth"}>Needs auth</Match>
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
                        <b>Analysis</b>
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
                  <box border={["top"]} borderColor={theme.borderSubtle} />
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
                      <b>Queued</b>
                      <span style={{ fg: theme.textMuted }}> ({queued().length})</span>
                    </text>
                  </box>
                  <box border={["top"]} borderColor={theme.borderSubtle} />
                  <Show when={queued().length <= 2 || expanded.queued}>
                    <For each={queued()}>
                      {(message) => (
                        <box flexDirection="row" gap={1}>
                          <box
                            flexShrink={0}
                            width={QUEUED_DELETE_ICON_WIDTH}
                            onMouseUp={() => {
                              void dropQueued(message.id)
                            }}
                          >
                            <text style={{ fg: theme.warning }}>{QUEUED_DELETE_ICON}</text>
                          </box>
                          <text fg={theme.textMuted} wrapMode="word">
                            {queuedSnippet(sync.data.part[message.id] ?? [])}
                          </text>
                        </box>
                      )}
                    </For>
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
                      <b>Todo</b>
                      <Show when={!expanded.todo}>
                        <span style={{ fg: theme.textMuted }}> ({todoRemaining()} remaining)</span>
                      </Show>
                    </text>
                  </box>
                  <box border={["top"]} borderColor={theme.borderSubtle} />
                  <Show when={todoRemaining() <= 2 || expanded.todo}>
                    <For each={todo()}>{(item) => <TodoItem status={item.status} content={item.content} />}</For>
                  </Show>
                </box>
              </Show>
              <Show when={sidebarQualityActions().length > 0}>
                <box backgroundColor={theme.backgroundElement} paddingLeft={1} paddingRight={1}>
                  <box flexDirection="row" justifyContent="space-between">
                    <text fg={theme.text}>
                      <b>Quality</b>
                    </text>
                    <text
                      fg={theme.textMuted}
                      onMouseUp={() => {
                        command.trigger("session.quality")
                      }}
                    >
                      view all
                    </text>
                  </box>
                  <box border={["top"]} borderColor={theme.borderSubtle} />
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
                      <b>Checks</b>
                    </text>
                  </box>
                  <box border={["top"]} borderColor={theme.borderSubtle} />
                  <text fg={theme.textMuted} wrapMode="word">
                    {checksSummary()}
                  </text>
                </box>
              </Show>
              <Show when={reviewResultsSummary().length > 0}>
                <box backgroundColor={theme.backgroundElement} paddingLeft={1} paddingRight={1}>
                  <box flexDirection="row" justifyContent="space-between">
                    <text fg={theme.text}>
                      <b>Review</b>
                    </text>
                  </box>
                  <box border={["top"]} borderColor={theme.borderSubtle} />
                  <text fg={theme.textMuted} wrapMode="word">
                    {reviewResultsSummary()}
                  </text>
                </box>
              </Show>
              <Show when={decisionHintsSummary().length > 0}>
                <box backgroundColor={theme.backgroundElement} paddingLeft={1} paddingRight={1}>
                  <box flexDirection="row" justifyContent="space-between">
                    <text fg={theme.text}>
                      <b>Hints</b>
                    </text>
                  </box>
                  <box border={["top"]} borderColor={theme.borderSubtle} />
                  <text fg={theme.textMuted} wrapMode="word">
                    {decisionHintsSummary()}
                  </text>
                </box>
              </Show>
              <Show when={debugCasesSummary().length > 0}>
                <box backgroundColor={theme.backgroundElement} paddingLeft={1} paddingRight={1}>
                  <box flexDirection="row" justifyContent="space-between">
                    <text fg={theme.text}>
                      <b>Cases</b>
                    </text>
                  </box>
                  <box border={["top"]} borderColor={theme.borderSubtle} />
                  <text fg={theme.textMuted} wrapMode="word">
                    {debugCasesSummary()}
                  </text>
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
                        <b>Modified Files</b>
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
                  <box border={["top"]} borderColor={theme.borderSubtle} />
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
                    <text fg={theme.textMuted} onMouseUp={() => kv.set("dismissed_getting_started", true)}>
                      ✕
                    </text>
                  </box>
                  <text fg={theme.textMuted}>ax-code includes models you can start with immediately.</text>
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
