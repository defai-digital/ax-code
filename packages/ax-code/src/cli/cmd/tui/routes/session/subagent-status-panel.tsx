import { createMemo, createSignal, For, Show } from "solid-js"
import type { MouseEvent } from "@ax-code/opentui-core"
import { useRenderer } from "@ax-code/opentui-solid"
import { Spinner } from "@tui/component/spinner"
import { useTheme } from "@tui/context/theme"
import { Locale } from "@/util/locale"
import type { SubagentStatusItem, SubagentStatusView } from "./subagent-status-view"

const MAX_PANEL_ROWS = 8
const MAX_TERMINAL_FRACTION = 0.15

function bodyRowBudget(terminalHeight: number) {
  const panelRows = Math.max(2, Math.min(MAX_PANEL_ROWS, Math.floor(terminalHeight * MAX_TERMINAL_FRACTION)))
  return panelRows - 1
}

export function SubagentStatusPanel(props: {
  view: SubagentStatusView
  collapsed: boolean
  terminalHeight: number
  width: number
  stopping: ReadonlySet<string>
  onToggle: () => void
  onOpen: (item: SubagentStatusItem) => void
  onStop: (item: SubagentStatusItem) => void | Promise<void>
}) {
  const { theme } = useTheme()
  const renderer = useRenderer()
  const [hovered, setHovered] = createSignal<string>()
  const active = createMemo(() => props.view.items.filter((item) => item.active))
  const stale = createMemo(() => active().filter((item) => item.stale).length)
  const rowBudget = createMemo(() => bodyRowBudget(props.terminalHeight))
  const visibleLimit = createMemo(() => {
    if (active().length <= rowBudget()) return rowBudget()
    return rowBudget() > 1 ? rowBudget() - 1 : rowBudget()
  })
  const visible = createMemo(() => active().slice(0, visibleLimit()))
  const hidden = createMemo(() => active().length - visible().length)
  const showModel = createMemo(() => props.width >= 84)

  function open(item: SubagentStatusItem) {
    if (!item.sessionID) return
    if (renderer.getSelection()?.getSelectedText()) return
    props.onOpen(item)
  }

  function stop(event: MouseEvent, item: SubagentStatusItem) {
    event.stopPropagation()
    if (!item.sessionID || props.stopping.has(item.sessionID)) return
    void props.onStop(item)
  }

  return (
    <Show when={active().length > 0}>
      <box
        flexShrink={0}
        backgroundColor={theme.backgroundPanel}
        paddingLeft={1}
        paddingRight={1}
        gap={0}
      >
        <box
          height={1}
          flexDirection="row"
          justifyContent="space-between"
          onMouseUp={() => {
            if (renderer.getSelection()?.getSelectedText()) return
            props.onToggle()
          }}
        >
          <text fg={theme.textMuted} wrapMode="none">
            {props.collapsed ? "▸" : "▾"} <b>Subagents</b> {active().length}
          </text>
          <Show when={stale() > 0}>
            <text flexShrink={0} fg={theme.warning} wrapMode="none">
              {stale()} without updates
            </text>
          </Show>
        </box>

        <Show when={!props.collapsed}>
          <For each={visible()}>
            {(item) => {
              const stopping = createMemo(() => !!item.sessionID && props.stopping.has(item.sessionID))
              const rowColor = createMemo(() => {
                if (stopping() || item.stale) return theme.warning
                return hovered() === item.id ? theme.text : theme.textMuted
              })
              return (
                <box
                  height={1}
                  paddingLeft={2}
                  flexDirection="row"
                  justifyContent="space-between"
                  backgroundColor={hovered() === item.id ? theme.backgroundMenu : undefined}
                  onMouseOver={() => setHovered(item.id)}
                  onMouseOut={() => setHovered(undefined)}
                  onMouseUp={() => open(item)}
                >
                  <box height={1} flexDirection="row" flexShrink={1} overflow="hidden">
                    <Spinner color={rowColor()}>
                      <span style={{ fg: theme.primary }}>{item.agent ?? "Agent"}</span>{" "}
                      <span style={{ fg: hovered() === item.id ? theme.text : theme.textMuted }}>
                        {Locale.truncate(item.title, 60)}
                      </span>
                      <span style={{ fg: item.stale ? theme.warning : theme.textMuted }}>
                        {" — "}
                        {stopping() ? "Stopping" : item.activity}
                      </span>
                    </Spinner>
                  </box>

                  <box height={1} flexDirection="row" flexShrink={0} gap={1}>
                    <Show when={showModel() && item.model}>
                      <text fg={theme.textMuted} wrapMode="none">
                        {Locale.truncate(item.model ?? "", 22)}
                      </text>
                    </Show>
                    <Show when={item.elapsed}>
                      <text fg={theme.textMuted} wrapMode="none">
                        {item.elapsed}
                      </text>
                    </Show>
                    <Show when={item.sessionID}>
                      <text
                        fg={hovered() === item.id ? theme.text : theme.textMuted}
                        onMouseDown={(event: MouseEvent) => event.stopPropagation()}
                        onMouseUp={(event: MouseEvent) => {
                          event.stopPropagation()
                          open(item)
                        }}
                      >
                        [↗]
                      </text>
                      <text
                        fg={stopping() ? theme.warning : theme.textMuted}
                        onMouseDown={(event: MouseEvent) => event.stopPropagation()}
                        onMouseUp={(event: MouseEvent) => stop(event, item)}
                      >
                        [{stopping() ? "…" : "×"}]
                      </text>
                    </Show>
                  </box>
                </box>
              )
            }}
          </For>
          <Show when={hidden() > 0}>
            <text height={1} paddingLeft={4} fg={theme.textMuted} wrapMode="none">
              ↳ +{hidden()} more active
            </text>
          </Show>
        </Show>
      </box>
    </Show>
  )
}
