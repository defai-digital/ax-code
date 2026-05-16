import { TextAttributes } from "@opentui/core"
import { useTheme } from "@tui/context/theme"
import { createMemo, For, onMount, Show } from "solid-js"
import { useDialog } from "../../ui/dialog"
import { SessionGraph } from "./graph"

export function DialogDreGraph(props: { sessionID: string }) {
  const dialog = useDialog()
  const { theme } = useTheme()

  onMount(() => {
    dialog.setSize("large")
  })

  const graph = createMemo(() =>
    SessionGraph.loadGraph(props.sessionID as Parameters<typeof SessionGraph.loadGraph>[0]),
  )
  const lines = createMemo(() => {
    const data = graph()
    if (!data) return []
    return SessionGraph.ascii(data)
  })
  const items = createMemo(() => {
    const data = graph()
    if (!data) return []
    return SessionGraph.entries(data)
  })

  return (
    <box paddingLeft={2} paddingRight={2} paddingBottom={1} flexDirection="column" gap={1}>
      <box flexDirection="row" justifyContent="space-between">
        <text attributes={TextAttributes.BOLD} fg={theme.text}>
          DRE Graph
        </text>
        <text fg={theme.textMuted} onMouseUp={() => dialog.clear()}>
          esc
        </text>
      </box>
      <Show
        when={lines().length > 0}
        fallback={
          <box paddingTop={1}>
            <text fg={theme.textMuted}>
              No execution graph recorded. Run a session with tools or routes to populate execution evidence.
            </text>
          </box>
        }
      >
        <box>
          <text fg={theme.accent} attributes={TextAttributes.BOLD}>
            Visual
          </text>
        </box>
        <scrollbox maxHeight={10} paddingLeft={1} scrollbarOptions={{ visible: false }}>
          <box flexDirection="column">
            <For each={lines()}>
              {(line, idx) => <text fg={idx() === 0 ? theme.textMuted : theme.text}>{line}</text>}
            </For>
          </box>
        </scrollbox>
        <Show when={items().length > 0}>
          <box paddingTop={1}>
            <text fg={theme.accent} attributes={TextAttributes.BOLD}>
              Detail
            </text>
          </box>
          <scrollbox maxHeight={12} paddingLeft={1} paddingRight={1} scrollbarOptions={{ visible: false }}>
            <box flexDirection="column">
              <For each={items()}>
                {(item) => (
                  <box paddingBottom={1}>
                    <text fg={theme.text}>
                      <b>{item.title}</b>
                    </text>
                    <Show when={item.description}>
                      <text fg={theme.textMuted}>{item.description}</text>
                    </Show>
                    <Show when={item.footer}>
                      <text fg={theme.textMuted}>{item.footer}</text>
                    </Show>
                  </box>
                )}
              </For>
            </box>
          </scrollbox>
        </Show>
      </Show>
    </box>
  )
}
