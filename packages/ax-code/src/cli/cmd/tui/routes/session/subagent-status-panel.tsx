import { createMemo, createSignal, For, Show } from "solid-js"
import type { MouseEvent } from "ax-tui"
import { useRenderer } from "ax-tui/solid"
import { Spinner } from "@tui/component/spinner"
import { useTheme } from "@tui/context/theme"
import { truncateToCellWidth } from "./last-input-view-model"
import {
  isGoalPlanner,
  isGoalPlanning,
  subagentPanelHeaderSummary,
  subagentPanelItems,
  subagentPanelTitle,
} from "./subagent-status-view"
import type { SubagentStatusItem, SubagentStatusView } from "./subagent-status-view"

import { subagentPanelLayout } from "./subagent-panel-layout"

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
  const active = createMemo(() => subagentPanelItems(props.view))
  const stale = createMemo(() => active().filter((item) => item.stale).length)
  const layout = createMemo(() =>
    subagentPanelLayout({
      terminalHeight: props.terminalHeight,
      activeCount: active().length,
      collapsed: props.collapsed,
    }),
  )
  const visible = createMemo(() => active().slice(0, layout().visible))
  const planning = createMemo(() => isGoalPlanning(props.view))
  const title = createMemo(() => (planning() ? "Planning your goal" : subagentPanelTitle(active().length)))
  const summary = createMemo(() => subagentPanelHeaderSummary(props.view) ?? "Starting")
  const contentBudget = createMemo(() => Math.max(1, props.width - 5))

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
        border={["left"]}
        borderColor={stale() > 0 ? theme.warning : theme.accent}
      >
        <box
          height={1}
          flexDirection="row"
          justifyContent="space-between"
          onMouseUp={() => {
            if (!renderer.getSelection()?.getSelectedText()) props.onToggle()
          }}
        >
          <box flexShrink={1} overflow="hidden">
            <Spinner color={stale() > 0 ? theme.warning : theme.accent} fallbackPrefix="">
              <span style={{ fg: theme.text, bold: true }}>
                {props.collapsed ? "▸" : "▾"} {title()}
              </span>
            </Spinner>
          </box>
          <Show when={props.width >= 48}>
            <text fg={theme.textMuted} flexShrink={0}>
              {stale() > 0 ? "No recent updates" : props.collapsed ? "Expand" : "Collapse"}
            </text>
          </Show>
        </box>
        <text height={1} fg={stale() > 0 ? theme.warning : theme.text} wrapMode="none">
          {truncateToCellWidth(summary(), contentBudget())}
        </text>
        <Show when={!props.collapsed}>
          <For each={visible()}>
            {(item) => {
              const stopping = createMemo(() => !!item.sessionID && props.stopping.has(item.sessionID))
              const activity = createMemo(() => (stopping() ? "Stopping" : item.activity))
              const details = createMemo(() =>
                [
                  activity(),
                  item.elapsed,
                  item.stale ? "No recent updates" : undefined,
                  props.width >= 84 ? item.model : undefined,
                ]
                  .filter(Boolean)
                  .join(" · "),
              )
              return (
                <box
                  height={2}
                  paddingLeft={1}
                  backgroundColor={hovered() === item.id ? theme.backgroundMenu : undefined}
                  onMouseOver={() => setHovered(item.id)}
                  onMouseOut={() => setHovered(undefined)}
                  onMouseUp={() => open(item)}
                >
                  <box height={1} flexDirection="row" justifyContent="space-between">
                    <text fg={theme.text} flexShrink={1} wrapMode="none" overflow="hidden">
                      <b>
                        {truncateToCellWidth(
                          isGoalPlanner(item) ? "Prepare the goal plan" : item.title,
                          Math.max(1, contentBudget() - (item.sessionID ? 15 : 1)),
                        )}
                      </b>
                    </text>
                    <Show when={item.sessionID}>
                      <box flexDirection="row" gap={1} flexShrink={0}>
                        <text
                          fg={theme.primary}
                          onMouseDown={(event: MouseEvent) => event.stopPropagation()}
                          onMouseUp={(event: MouseEvent) => {
                            event.stopPropagation()
                            open(item)
                          }}
                        >
                          [Open]
                        </text>
                        <text
                          fg={stopping() ? theme.warning : theme.textMuted}
                          onMouseDown={(event: MouseEvent) => event.stopPropagation()}
                          onMouseUp={(event: MouseEvent) => stop(event, item)}
                        >
                          [{stopping() ? "…" : "Stop"}]
                        </text>
                      </box>
                    </Show>
                  </box>
                  <text height={1} fg={stopping() || item.stale ? theme.warning : theme.textMuted} wrapMode="none">
                    {truncateToCellWidth(details(), contentBudget() - 1)}
                  </text>
                </box>
              )
            }}
          </For>
          <Show when={layout().hidden > 0}>
            <text height={1} fg={theme.textMuted} wrapMode="none">
              +{layout().hidden} more active
            </text>
          </Show>
        </Show>
      </box>
    </Show>
  )
}
