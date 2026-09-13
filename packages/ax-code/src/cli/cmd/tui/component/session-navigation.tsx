import { createMemo, For, Show, type Setter } from "solid-js"
import { useKV } from "@tui/context/kv"
import { activeNavigationSessions, navigationFilter, projectLabel } from "../navigation/navigation-model"
import { useSync } from "@tui/context/sync"
import { useSDK } from "@tui/context/sdk"
import { useRoute } from "@tui/context/route"
import { useTheme } from "@tui/context/theme"
import { useLocal } from "@tui/context/local"
import { useCommandDialog } from "./dialog-command"
import { sessionNavigationEntries } from "./session-list-data"
import { createSessionActivityIndex, knownAttentionRequests } from "../util/session-activity"
import { truncateToCellWidth } from "../routes/session/last-input-view-model"

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

  return (
    <box width={props.width} flexShrink={0} height="100%" padding={1} backgroundColor={theme.backgroundPanel}>
      <text flexShrink={0} fg={theme.textMuted} selectable={false}>
        Project
      </text>
      <box flexShrink={0} onMouseUp={() => command.trigger("session.navigation.info")}>
        <text fg={theme.text} selectable={false}>
          {truncateToCellWidth(projectLabel(directory()), props.width - 2)}
        </text>
      </box>
      <box flexShrink={0} onMouseUp={() => command.trigger("session.new")}>
        <text fg={theme.accent} selectable={false}>
          + New session
        </text>
      </box>
      <text flexShrink={0} fg={theme.textMuted} selectable={false}>
        Across workspaces
      </text>
      <box flexShrink={0} onMouseUp={() => command.trigger("session.attention")}>
        <text fg={pendingCount() ? theme.warning : theme.textMuted} selectable={false}>
          {truncateToCellWidth(`Known requests (${pendingCount()})`, props.width - 2)}
        </text>
      </box>
      <Show when={!sdk.sseConnected}>
        <text flexShrink={0} fg={theme.warning} selectable={false}>
          Cached; disconnected
        </text>
      </Show>
      <box flexShrink={0} flexDirection="row" gap={2} marginTop={1}>
        <For each={["recent", "active"] as const}>
          {(value) => (
            <box flexShrink={0} onMouseUp={() => kv.set("navigation_filter", value)}>
              <text fg={filter() === value ? theme.accent : theme.textMuted} selectable={false}>
                {value === "recent" ? "Recent" : "Active"}
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
      <scrollbox flexGrow={1} minHeight={0} marginTop={1}>
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
            const label = () => state()?.label ?? (current() === row.session.id ? "Current" : "")
            return (
              <box
                flexDirection="column"
                marginLeft={indent()}
                marginBottom={1}
                backgroundColor={current() === row.session.id ? theme.backgroundElement : undefined}
              >
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
                    <text flexShrink={0} fg={theme.textMuted} selectable={false}>
                      {row.hasChildren ? (expanded().has(row.session.id) ? "-" : "+") : " "}
                    </text>
                  </box>
                  <box
                    flexGrow={1}
                    minWidth={0}
                    onMouseUp={() => route.navigate({ type: "session", sessionID: row.session.id })}
                  >
                    <text fg={current() === row.session.id ? theme.accent : theme.text} selectable={false}>
                      {truncateToCellWidth(
                        `${slot() ? `${slot()} ` : ""}${row.session.title}`,
                        props.width - 4 - indent(),
                      )}
                    </text>
                  </box>
                </box>
                <Show when={label()}>
                  <text
                    paddingLeft={2}
                    fg={state()?.attention ? theme.warning : theme.textMuted}
                    selectable={false}
                    wrapMode="word"
                  >
                    {label()}
                  </text>
                </Show>
              </box>
            )
          }}
        </For>
      </scrollbox>
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
        <text flexShrink={0} fg={theme.textMuted} selectable={false}>
          /navigation to hide
        </text>
      </box>
    </box>
  )
}
