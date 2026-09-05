import { For, Show, createSignal } from "solid-js"
import { useRenderer } from "ax-tui/solid"
import { useTheme } from "@tui/context/theme"
import type { PinnedInputBanner } from "./last-input-view-model"

export function LastInputBanner(props: { view: PinnedInputBanner; onJump: (messageID: string) => void }) {
  const { theme } = useTheme()
  const renderer = useRenderer()
  const [hover, setHover] = createSignal(false)

  return (
    <Show when={props.view.state === "visible" ? props.view : undefined}>
      {(view) => (
        <box
          flexShrink={0}
          backgroundColor={hover() ? theme.backgroundElement : theme.backgroundPanel}
          paddingLeft={1}
          paddingRight={1}
          onMouseOver={() => setHover(true)}
          onMouseOut={() => setHover(false)}
          onMouseUp={() => {
            if (renderer.getSelection()?.getSelectedText()) return
            props.onJump(view().messageID)
          }}
        >
          <For each={view().lines}>
            {(line, index) => (
              <text height={1} wrapMode="none" fg={index() === 0 ? theme.text : theme.textMuted}>
                {line}
              </text>
            )}
          </For>
        </box>
      )}
    </Show>
  )
}
