import { createMemo, createSignal, For, Show } from "solid-js"
import type { MouseEvent } from "@ax-code/tui"
import { useRenderer } from "@ax-code/tui/solid"
import { Spinner } from "@tui/component/spinner"
import { shouldUseTuiAnimations } from "@tui/component/spinner-profile"
import { useKV } from "@tui/context/kv"
import { useTheme } from "@tui/context/theme"
import { stringWidth } from "@/bun/node-compat"
import { truncateToCellWidth } from "./last-input-view-model"
import { subagentPanelHeaderSummary, subagentPanelTitle } from "./subagent-status-view"
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
  const kv = useKV()
  const animated = createMemo(() => shouldUseTuiAnimations({ userEnabled: kv.get("animations_enabled", true) }))
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
  const title = createMemo(() => subagentPanelTitle(active().length))
  // Collapsed panels used to read as a static "▸ Subagents 2" — nothing
  // moved and nothing said what was running, so users missed the area
  // entirely. While collapsed, the header carries the lead item's summary
  // ("agent: activity · elapsed") whenever there is room for it.
  const summary = createMemo(() => subagentPanelHeaderSummary(props.view))
  const summaryBudget = createMemo(() => {
    const staleText = stale() > 0 ? stringWidth(`${stale()} without updates`) + 1 : 0
    // Left border (1) + padding (1+1) + spinner cell/gap (1+1) + toggle
    // glyph/space (1+1) + the " · " separator (3) = 10.
    const chrome = 10 + stringWidth(title()) + staleText
    return Math.max(0, props.width - chrome)
  })

  // Truncate a row's title to what the row can actually show instead of a
  // fixed 60 columns: on narrow panes the old fixed budget let the flexbox
  // hard-clip the title mid-word while wide panes wasted space.
  function rowTitleBudget(item: SubagentStatusItem, activity: string) {
    // Elapsed text (up to ~6 cols) + 2 gaps + "[↗]" + "[×]" = 14; plus the
    // model column (truncated to 22 cols) and its gap when shown.
    const right = 14 + (showModel() && item.model ? 26 : 0)
    // Panel left border (1) + panel padding (1+1) + this row's paddingLeft
    // (2) = 5 columns of chrome around the row, on top of its own content.
    const outerChrome = 5
    // Animated spinner glyph + its gap (2) precede the agent name; the
    // non-animated fallback keeps its default "... " prefix (4) instead.
    const spinnerChrome = animated() ? 2 : 4
    const left = outerChrome + spinnerChrome + stringWidth(`${item.agent ?? "Agent"} `) + stringWidth(` — ${activity}`)
    return Math.max(8, props.width - right - left)
  }

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
        border={["left"]}
        borderColor={stale() > 0 ? theme.warning : theme.accent}
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
          <box flexDirection="row" flexShrink={1} overflow="hidden">
            <Spinner color={stale() > 0 ? theme.warning : theme.accent} fallbackPrefix="">
              <span style={{ fg: theme.text, bold: true }}>
                {props.collapsed ? "▸" : "▾"} {title()}
              </span>
              <Show when={props.collapsed && summary() && summaryBudget() > 8}>
                <span style={{ fg: theme.textMuted }}> · {truncateToCellWidth(summary() ?? "", summaryBudget())}</span>
              </Show>
            </Spinner>
          </box>
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
              const activityText = createMemo(() => (stopping() ? "Stopping" : item.activity))
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
                        {truncateToCellWidth(item.title, rowTitleBudget(item, activityText()))}
                      </span>
                      <span style={{ fg: item.stale ? theme.warning : theme.textMuted }}>
                        {" — "}
                        {activityText()}
                      </span>
                    </Spinner>
                  </box>

                  <box height={1} flexDirection="row" flexShrink={0} gap={1}>
                    <Show when={showModel() && item.model}>
                      <text fg={theme.textMuted} wrapMode="none">
                        {truncateToCellWidth(item.model ?? "", 22)}
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
