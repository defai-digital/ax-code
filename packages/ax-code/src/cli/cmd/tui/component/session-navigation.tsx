import type { RGBA } from "ax-tui"
import { createMemo, For, Show, type Setter } from "solid-js"
import { useKV } from "@tui/context/kv"
import { navigationPanelInnerWidth, navigationRailInnerWidth } from "../navigation/navigation-layout"
import { activeNavigationSessions, navigationFilter, projectLabel } from "../navigation/navigation-model"
import { useSync } from "@tui/context/sync"
import { useSDK } from "@tui/context/sdk"
import { useRoute } from "@tui/context/route"
import { useTheme } from "@tui/context/theme"
import { useLocal } from "@tui/context/local"
import { useCommandDialog } from "./dialog-command"
import { ScheduleStatus } from "./schedule-status"
import { SplitBorder } from "./border"
import { sessionNavigationEntries } from "./session-list-data"
import { createSessionActivityIndex, knownAttentionRequests } from "../util/session-activity"
import { truncateToCellWidth } from "../routes/session/last-input-view-model"

function RailRule(props: { width: number; color: RGBA }) {
  return (
    <text flexShrink={0} fg={props.color} selectable={false}>
      {"─".repeat(Math.max(0, props.width))}
    </text>
  )
}

export function SessionNavigation(props: {
  width: number
  expanded: ReadonlySet<string>
  setExpanded: Setter<ReadonlySet<string>>
}) {
  const sync = useSync()
  const kv = useKV()
  const sdk = useSDK()
  const route = useRoute()
  const local = useLocal()
  const command = useCommandDialog()
  const { theme } = useTheme()
  const expanded = () => props.expanded
  const setExpanded = (value: Parameters<Setter<ReadonlySet<string>>>[0]) => props.setExpanded(value)
  const directory = () => sdk.directory ?? sync.data.path.directory
  const current = () => (route.data.type === "session" ? route.data.sessionID : undefined)
  const sessions = createMemo(() => sync.data.session.filter((session) => session.directory === directory()))
  const filter = () => navigationFilter(kv.get("navigation_filter"))
  const observed = () => sdk.sseConnected && sync.data.session_loaded
  const visibleSessions = createMemo(() =>
    filter() === "recent"
      ? sessions()
      : activeNavigationSessions({
          sessions: sessions(),
          statuses: sync.data.session_status,
          permissions: sync.data.permission,
          questions: sync.data.question,
          currentID: current(),
          observed: observed(),
        }),
  )
  const rows = createMemo(() => sessionNavigationEntries(visibleSessions(), local.session.pinned(), expanded()))
  const activity = createMemo(() =>
    createSessionActivityIndex({
      sessions: sessions(),
      statuses: sync.data.session_status,
      permissions: sync.data.permission,
      questions: sync.data.question,
    }),
  )
  const pendingCount = createMemo(() => knownAttentionRequests(sync.data.permission, sync.data.question).length)
  const slots = createMemo(() => new Map(local.session.slots().map((id, index) => [id, index + 1])))
  const innerWidth = () => navigationRailInnerWidth(props.width)
  const panelWidth = () => navigationPanelInnerWidth(props.width)

  return (
    <box
      width={props.width}
      flexShrink={0}
      height="100%"
      paddingTop={1}
      paddingBottom={1}
      paddingLeft={1}
      paddingRight={0}
      gap={1}
      backgroundColor={theme.backgroundPanel}
      border={["right"]}
      borderColor={theme.border}
      customBorderChars={SplitBorder.customBorderChars}
    >
      <box flexShrink={0} backgroundColor={theme.backgroundElement} paddingLeft={1} paddingRight={1}>
        <text flexShrink={0} fg={theme.text} selectable={false}>
          <b>Project</b>
        </text>
        <box flexShrink={0} onMouseUp={() => command.trigger("session.navigation.info")}>
          <text fg={theme.text} selectable={false}>
            <b>{truncateToCellWidth(projectLabel(directory()), panelWidth())}</b>
          </text>
        </box>
        <box flexShrink={0} onMouseUp={() => command.trigger("session.new")}>
          <text fg={theme.primary} selectable={false}>
            + New session
          </text>
        </box>
        <ScheduleStatus width={panelWidth()} />
      </box>
      <box flexShrink={0} backgroundColor={theme.backgroundElement} paddingLeft={1} paddingRight={1}>
        <text flexShrink={0} fg={theme.text} selectable={false}>
          <b>Across workspaces</b>
        </text>
        <box flexShrink={0} onMouseUp={() => command.trigger("session.attention")}>
          <text fg={pendingCount() ? theme.warning : theme.textMuted} selectable={false}>
            {truncateToCellWidth(`Known requests (${pendingCount()})`, panelWidth())}
          </text>
        </box>
        <Show when={!sdk.sseConnected}>
          <text flexShrink={0} fg={theme.textMuted} selectable={false}>
            {truncateToCellWidth("Cached; disconnected", panelWidth())}
          </text>
        </Show>
      </box>
      <box flexShrink={0} flexDirection="row" gap={1}>
        <For each={["recent", "active"] as const}>
          {(value) => (
            <box
              flexShrink={0}
              paddingLeft={1}
              paddingRight={1}
              backgroundColor={filter() === value ? theme.backgroundElement : undefined}
              onMouseUp={() => kv.set("navigation_filter", value)}
            >
              <text fg={filter() === value ? theme.primary : theme.textMuted} selectable={false}>
                <span style={{ bold: filter() === value }}>{value === "recent" ? "Recent" : "Active"}</span>
              </text>
            </box>
          )}
        </For>
      </box>
      <Show when={filter() === "active"}>
        <text flexShrink={0} fg={theme.textMuted} selectable={false} wrapMode="word">
          {observed() ? "Includes current session" : "Cached sessions; reconnect to filter"}
        </text>
      </Show>
      <scrollbox
        flexGrow={1}
        minHeight={0}
        verticalScrollbarOptions={{
          trackOptions: {
            backgroundColor: theme.background,
            foregroundColor: theme.borderActive,
          },
        }}
      >
        <Show when={rows().length === 0}>
          <text flexShrink={0} fg={theme.textMuted} selectable={false}>
            {!sync.data.session_loaded
              ? "Loading sessions"
              : filter() === "active"
                ? "No active sessions"
                : "No sessions here"}
          </text>
        </Show>
        <For each={rows()}>
          {(row) => {
            const state = createMemo(() =>
              sdk.sseConnected && sync.data.session_loaded ? activity().get(row.session.id) : undefined,
            )
            const indent = () => Math.min(row.depth, 3)
            const slot = () => slots().get(row.session.id)
            const selected = () => current() === row.session.id
            const label = () => state()?.label ?? ""
            const titleWidth = () => Math.max(0, innerWidth() - 3 - indent())
            const openSession = () => route.navigate({ type: "session", sessionID: row.session.id })
            return (
              <box
                flexDirection="row"
                marginLeft={indent()}
                backgroundColor={selected() ? theme.backgroundElement : undefined}
              >
                <box width={1} flexShrink={0} backgroundColor={selected() ? theme.primary : undefined} />
                <box flexGrow={1} minWidth={0} flexDirection="column">
                  <box flexDirection="row">
                    <box
                      width={2}
                      flexShrink={0}
                      onMouseUp={(event) => {
                        event.stopPropagation()
                        if (!row.hasChildren) return
                        setExpanded((previous) => {
                          const next = new Set(previous)
                          if (next.has(row.session.id)) next.delete(row.session.id)
                          else next.add(row.session.id)
                          return next
                        })
                      }}
                    >
                      <text flexShrink={0} fg={selected() ? theme.text : theme.textMuted} selectable={false}>
                        {row.hasChildren ? (expanded().has(row.session.id) ? "−" : "+") : " "}
                      </text>
                    </box>
                    <box flexGrow={1} minWidth={0} onMouseUp={openSession}>
                      <text fg={selected() ? theme.primary : theme.text} selectable={false}>
                        {truncateToCellWidth(`${slot() ? `${slot()} ` : ""}${row.session.title}`, titleWidth())}
                      </text>
                    </box>
                  </box>
                  <Show when={label()}>
                    <box flexDirection="row" gap={1} paddingLeft={2} onMouseUp={openSession}>
                      <text flexShrink={0} fg={state()?.attention ? theme.warning : theme.primary} selectable={false}>
                        •
                      </text>
                      <text fg={state()?.attention ? theme.warning : theme.textMuted} selectable={false}>
                        {truncateToCellWidth(label(), Math.max(0, titleWidth() - 2))}
                      </text>
                    </box>
                  </Show>
                </box>
              </box>
            )
          }}
        </For>
      </scrollbox>
      <box flexShrink={0} gap={1}>
        <RailRule width={innerWidth()} color={theme.borderSubtle} />
        <box flexShrink={0} flexDirection="row" gap={2}>
          <box flexShrink={0} onMouseUp={() => command.trigger("session.navigation.info")}>
            <text flexShrink={0} fg={theme.textMuted} selectable={false}>
              Details
            </text>
          </box>
          <box flexShrink={0} onMouseUp={() => command.trigger("session.navigation.width")}>
            <text flexShrink={0} fg={theme.textMuted} selectable={false}>{`Width ${props.width}`}</text>
          </box>
        </box>
        <box flexShrink={0} onMouseUp={() => command.trigger("session.navigation")}>
          <text flexShrink={0} fg={theme.text} selectable={false}>
            /navigation <span style={{ fg: theme.textMuted }}>to hide</span>
          </text>
        </box>
      </box>
    </box>
  )
}
