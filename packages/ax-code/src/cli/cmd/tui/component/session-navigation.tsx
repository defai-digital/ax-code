import { createMemo, For, Show, type Setter } from "solid-js"
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
  const rows = createMemo(() => sessionNavigationEntries(sessions(), local.session.pinned(), expanded()))
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
      <text fg={theme.textMuted} selectable={false}>
        Sessions
      </text>
      <box onMouseUp={() => command.trigger("session.new")}>
        <text fg={theme.accent} selectable={false}>
          + New session
        </text>
      </box>
      <box onMouseUp={() => command.trigger("session.attention")}>
        <text fg={pendingCount() ? theme.warning : theme.textMuted} selectable={false}>
          {truncateToCellWidth(`All requests (${pendingCount()})`, props.width - 2)}
        </text>
      </box>
      <Show when={!sdk.sseConnected}>
        <text fg={theme.warning} selectable={false}>
          Cached; disconnected
        </text>
      </Show>
      <scrollbox flexGrow={1} marginTop={1}>
        <Show when={rows().length === 0}>
          <text fg={theme.textMuted} selectable={false}>
            {sync.data.session_loaded ? "No sessions here" : "Loading sessions"}
          </text>
        </Show>
        <For each={rows()}>
          {(row) => {
            const state = createMemo(() =>
              sdk.sseConnected && sync.data.session_loaded ? activity().get(row.session.id) : undefined,
            )
            const indent = () => Math.min(row.depth, 3)
            const slot = () => slots().get(row.session.id)
            const label = () =>
              state()?.attention ? "Ask" : state()?.label === "Retrying" ? "Retry" : state()?.working ? "Work" : ""
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
                    <text fg={theme.textMuted} selectable={false}>
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
                  <text paddingLeft={2} fg={state()?.attention ? theme.warning : theme.textMuted} selectable={false}>
                    {label()}
                  </text>
                </Show>
              </box>
            )
          }}
        </For>
      </scrollbox>
      <box onMouseUp={() => command.trigger("session.navigation")}>
        <text fg={theme.textMuted} selectable={false}>
          /navigation to hide
        </text>
      </box>
    </box>
  )
}
