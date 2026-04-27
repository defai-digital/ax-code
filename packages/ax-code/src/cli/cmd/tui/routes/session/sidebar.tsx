import { useSync } from "@tui/context/sync"
import { createEffect, createMemo, createSignal, For, Match, onCleanup, Show, Switch } from "solid-js"
import { useTerminalDimensions } from "@opentui/solid"
import { createStore } from "solid-js/store"
import { useTheme } from "../../context/theme"
import { Installation } from "@/installation"
import { useDirectory } from "../../context/directory"
import { useKV } from "../../context/kv"
import { TodoItem } from "../../component/todo-item"
import { useCommandDialog } from "../../component/dialog-command"
import { Flag } from "@/flag/flag"
import { EventQuery } from "@/replay/query"
import { activityItems as items } from "./activity"
import { SessionDre } from "./dre"
import { SessionBranch } from "./branch"
import { SessionRollback } from "./rollback"
import { SessionSemanticDiff } from "@/session/semantic-diff"
import { footerSessionStatusView, type FooterSessionStatus } from "./footer-view-model"
import { computeSidebarWidth } from "./layout"
import type { SyncedSessionQualityReadiness } from "../../context/sync-session-risk"
import { countByWorkflow as countFindingsByWorkflow } from "@/quality/finding-counts"
import {
  renderSessionChecksSummary,
  renderSessionDebugCasesSummary,
  renderSessionQualitySidebarLine,
  sessionQualityActions,
  sessionQualityActionValue,
  sessionQualityWorkflowIcon,
} from "./quality"

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

function qualityColor(
  status: SyncedSessionQualityReadiness["overallStatus"],
  theme: ReturnType<typeof useTheme>["theme"],
) {
  if (status === "pass") return theme.success
  if (status === "warn") return theme.warning
  return theme.error
}

function sidebarStatusText(input: { status: FooterSessionStatus; hasMessages: boolean; now: number }) {
  const view = footerSessionStatusView({
    status: input.status,
    now: input.now,
  })

  if (input.status.type === "retry") {
    return {
      label: "Retrying...",
      stale: false,
    }
  }

  if (input.status.type === "busy") {
    if (view.stale) {
      return {
        label: input.status.waitState === "llm" ? "Thinking stalled" : "Processing stalled",
        stale: true,
      }
    }

    if (input.status.waitState === "llm") {
      return {
        label: "Thinking...",
        stale: false,
      }
    }

    return {
      label: "Processing...",
      stale: false,
    }
  }

  return {
    label: input.hasMessages ? "Finished" : "Ready",
    stale: false,
  }
}

export function Sidebar(props: { sessionID: string; overlay?: boolean }) {
  const sync = useSync()
  const { theme } = useTheme()
  const command = useCommandDialog()
  const session = createMemo(() => sync.session.get(props.sessionID))
  const risk = createMemo(() => sync.session.risk(props.sessionID))
  const diff = createMemo(() => sync.data.session_diff[props.sessionID] ?? [])
  const todo = createMemo(() => sync.data.todo[props.sessionID] ?? [])
  const messages = createMemo(() => sync.data.message[props.sessionID] ?? [])
  const status = createMemo<FooterSessionStatus>(
    () => (sync.data.session_status?.[props.sessionID] as FooterSessionStatus | undefined) ?? { type: "idle" },
  )
  const [statusTick, setStatusTick] = createSignal(0)
  const dimensions = useTerminalDimensions()
  const sidebarWidth = createMemo(() => computeSidebarWidth(dimensions().width))

  createEffect(() => {
    const current = status()
    if (current.type === "idle") return
    const timer = setInterval(() => setStatusTick((tick) => tick + 1), 30_000)
    onCleanup(() => clearInterval(timer))
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
  const qualityActions = createMemo(() =>
    sessionQualityActions({
      sessionID: props.sessionID,
      quality: risk()?.quality,
    }),
  )
  const findingCounts = createMemo(() => countFindingsByWorkflow(risk()?.findings ?? []))
  const checksSummary = createMemo(() => renderSessionChecksSummary(risk()?.envelopes ?? []))
  const debugCasesSummary = createMemo(() =>
    renderSessionDebugCasesSummary({
      cases: risk()?.debug?.cases ?? [],
      hypotheses: risk()?.debug?.hypotheses ?? [],
    }),
  )

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

  const directory = useDirectory()
  const kv = useKV()

  const hasProviders = createMemo(() => sync.data.provider.length > 0)
  const gettingStartedDismissed = createMemo(() => kv.get("dismissed_getting_started", false))
  const titleStatus = createMemo(() => {
    statusTick()
    return sidebarStatusText({
      status: status(),
      hasMessages: messages().length > 0,
      now: Date.now(),
    })
  })

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
                <text fg={titleStatus().stale ? theme.warning : theme.textMuted}>{titleStatus().label}</text>
                <Show when={session().share?.url}>{(url) => <text fg={theme.textMuted}>{url()}</text>}</Show>
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
                  <box border={["top"]} borderColor={theme.borderSubtle} />
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
                  <box border={["top"]} borderColor={theme.borderSubtle} />
                  <Show when={todo().length <= 2 || expanded.todo}>
                    <For each={todo()}>{(item) => <TodoItem status={item.status} content={item.content} />}</For>
                  </Show>
                </box>
              </Show>
              <Show when={qualityActions().length > 0}>
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
                  <For each={qualityActions()}>
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
