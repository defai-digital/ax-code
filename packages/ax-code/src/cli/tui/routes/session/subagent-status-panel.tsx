import { createMemo, createSignal, For, Show } from "solid-js"
import type { MouseEvent } from "ax-tui"
import { useRenderer } from "ax-tui/solid"
import { Spinner } from "@tui/component/spinner"
import { useTheme } from "@tui/context/theme"
import { truncateToCellWidth } from "./last-input-view-model"
import {
  isGoalPlanner,
  subagentPanelHeaderSummary,
  subagentPanelItems,
  subagentPanelTitle,
  subagentSoloDetails,
  subagentSoloTitle,
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
  const solo = createMemo(() => (layout().mode === "solo" ? active()[0] : undefined))
  const title = createMemo(() => subagentPanelTitle(active().length))
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
        <Show
          when={solo()}
          fallback={
            <box flexShrink={0}>
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
                <Show when={props.width >= 48} fallback={<text />}>
                  <text fg={theme.textMuted} flexShrink={0}>
                    {stale() > 0 ? "No recent updates" : props.collapsed ? "Expand" : "Collapse"}
                  </text>
                </Show>
              </box>
              <Show
                when={props.collapsed}
                fallback={
                  <box flexShrink={0}>
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
                              <Show when={item.sessionID} fallback={<text />}>
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
                                    [{stopping() ? "..." : "Stop"}]
                                  </text>
                                </box>
                              </Show>
                            </box>
                            <text
                              height={1}
                              fg={stopping() || item.stale ? theme.warning : theme.textMuted}
                              wrapMode="none"
                            >
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
                  </box>
                }
              >
                <text height={1} fg={stale() > 0 ? theme.warning : theme.text} wrapMode="none">
                  {truncateToCellWidth(summary(), contentBudget())}
                </text>
              </Show>
            </box>
          }
        >
          {(item) => {
            const stopping = createMemo(() => {
              const sessionID = item().sessionID
              return !!sessionID && props.stopping.has(sessionID)
            })
            const details = createMemo(() =>
              subagentSoloDetails(item(), {
                includeModel: props.width >= 84,
              }),
            )
            const label = createMemo(() => {
              const detail = details()
              return detail ? `${subagentSoloTitle(item())} - ${detail}` : subagentSoloTitle(item())
            })
            const actionsWidth = (item().sessionID ? (props.width >= 64 ? 11 : 5) : 0) + 1
            return (
              <box height={1} flexDirection="row" justifyContent="space-between" onMouseUp={() => open(item())}>
                <box flexShrink={1} overflow="hidden">
                  <Spinner color={item().stale ? theme.warning : theme.accent} fallbackPrefix="">
                    <span style={{ fg: item().stale ? theme.warning : theme.text, bold: true }}>
                      {truncateToCellWidth(label(), Math.max(1, contentBudget() - actionsWidth))}
                    </span>
                  </Spinner>
                </box>
                <Show when={item().sessionID} fallback={<text />}>
                  <box flexDirection="row" gap={1} flexShrink={0}>
                    <Show when={props.width >= 64} fallback={<text />}>
                      <text
                        fg={theme.textMuted}
                        onMouseDown={(event: MouseEvent) => event.stopPropagation()}
                        onMouseUp={(event: MouseEvent) => {
                          event.stopPropagation()
                          open(item())
                        }}
                      >
                        Open
                      </text>
                    </Show>
                    <text
                      fg={stopping() ? theme.warning : theme.textMuted}
                      onMouseDown={(event: MouseEvent) => event.stopPropagation()}
                      onMouseUp={(event: MouseEvent) => stop(event, item())}
                    >
                      {stopping() ? "..." : "Stop"}
                    </text>
                  </box>
                </Show>
              </box>
            )
          }}
        </Show>
      </box>
    </Show>
  )
}
