import { createMemo, For, Match, Show, Switch } from "solid-js"
import { useTheme } from "@tui/context/theme"
import { arenaView, councilView, type EnsembleTone } from "./ensemble-view"
import { BlockTool, InlineTool, type ToolProps } from "./primitives"

function toneColor(theme: ReturnType<typeof useTheme>["theme"], tone: EnsembleTone) {
  switch (tone) {
    case "ok":
      return theme.success
    case "warn":
      return theme.warning
    case "error":
      return theme.error
    case "muted":
      return theme.textMuted
  }
}

/**
 * Council transcript renderer. Completed runs show the agreement breakdown
 * (consensus / majority / minority / singleton), the member roster, and any
 * skip/budget notes. Running and error states stay a one-line row so a long
 * fan-out does not reflow the transcript before metadata exists.
 */
export function CouncilToolView(props: ToolProps<any>) {
  const { theme } = useTheme()
  const status = createMemo(() => props.part.state.status)
  const view = createMemo(() => councilView(props.metadata, props.input))

  return (
    <Switch>
      <Match when={status() === "pending" || status() === "running"}>
        <InlineTool icon="*" pending="Council members reviewing..." complete={false} part={props.part}>
          Council running
        </InlineTool>
      </Match>
      <Match when={status() === "completed"}>
        <BlockTool title={`# Council: ${view().statusLabel}`} part={props.part}>
          <box flexDirection="column" gap={1}>
            <Show when={view().membersLabel}>
              <box flexDirection="row" gap={2}>
                <text fg={theme.textMuted}>Members</text>
                <text fg={theme.text}>{view().membersLabel}</text>
              </box>
            </Show>
            <Show when={view().chips.length > 0}>
              <box flexDirection="row" gap={2} flexWrap="wrap">
                <For each={view().chips}>
                  {(chip) => (
                    <box flexDirection="row" gap={1}>
                      <text fg={toneColor(theme, chip.tone)}>{chip.label}</text>
                      <text fg={theme.text}>{chip.count}</text>
                    </box>
                  )}
                </For>
              </box>
            </Show>
            <Show when={view().roster.length > 0}>
              <box flexDirection="column">
                <text fg={theme.textMuted}>Models</text>
                <For each={view().roster}>{(name) => <text fg={theme.text}>{"  " + name}</text>}</For>
              </box>
            </Show>
            <Show when={view().debateLabel}>
              <text fg={theme.textMuted}>{view().debateLabel}</text>
            </Show>
            <Show when={view().notes.length > 0}>
              <box flexDirection="column">
                <For each={view().notes}>{(note) => <text fg={theme.warning}>{note}</text>}</For>
              </box>
            </Show>
          </box>
        </BlockTool>
      </Match>
      <Match when={true}>
        <InlineTool icon="*" pending="Council" complete={true} part={props.part}>
          Council
        </InlineTool>
      </Match>
    </Switch>
  )
}

/**
 * Arena transcript renderer. Completed runs show mode, strategy, the ranked
 * contestants (best first), and failure/budget notes. Implement preflight
 * failures (not_git / no_base_commit / dirty_worktree) surface as an error
 * title so the fix is obvious.
 */
export function ArenaToolView(props: ToolProps<any>) {
  const { theme } = useTheme()
  const status = createMemo(() => props.part.state.status)
  const view = createMemo(() => arenaView(props.metadata, props.input))

  return (
    <Switch>
      <Match when={status() === "pending" || status() === "running"}>
        <InlineTool icon="*" pending="Arena contestants planning..." complete={false} part={props.part}>
          Arena running
        </InlineTool>
      </Match>
      <Match when={status() === "completed"}>
        <BlockTool title={`# Arena: ${view().statusLabel}`} part={props.part}>
          <box flexDirection="column" gap={1}>
            <Show when={view().modeLabel || view().strategyLabel}>
              <box flexDirection="row" gap={2}>
                <Show when={view().modeLabel}>
                  <text fg={theme.text}>{view().modeLabel}</text>
                </Show>
                <Show when={view().strategyLabel}>
                  <text fg={theme.textMuted}>{view().strategyLabel}</text>
                </Show>
              </box>
            </Show>
            <Show when={view().rankedLabel}>
              <text fg={theme.text}>{view().rankedLabel}</text>
            </Show>
            <Show when={view().ranked.length > 0}>
              <box flexDirection="column">
                <For each={view().ranked}>
                  {(name, index) => (
                    <box flexDirection="row" gap={1}>
                      <text fg={index() === 0 ? theme.success : theme.textMuted}>{`${index() + 1}.`}</text>
                      <text fg={index() === 0 ? theme.text : theme.textMuted}>{name}</text>
                    </box>
                  )}
                </For>
              </box>
            </Show>
            <Show when={view().notes.length > 0}>
              <box flexDirection="column">
                <For each={view().notes}>{(note) => <text fg={theme.warning}>{note}</text>}</For>
              </box>
            </Show>
          </box>
        </BlockTool>
      </Match>
      <Match when={true}>
        <InlineTool icon="*" pending="Arena" complete={true} part={props.part}>
          Arena
        </InlineTool>
      </Match>
    </Switch>
  )
}
