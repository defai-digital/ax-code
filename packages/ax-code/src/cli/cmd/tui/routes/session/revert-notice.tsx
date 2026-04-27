import { createSignal, For, Show } from "solid-js"
import { SplitBorder } from "@tui/component/border"
import { useTheme } from "@tui/context/theme"
import { useCommandDialog } from "@tui/component/dialog-command"
import { useDialog } from "../../ui/dialog"
import { DialogConfirm } from "@tui/ui/dialog-confirm"
import { useKeybind } from "@tui/context/keybind"
import type { DiffFile } from "./revert"

export function RevertNotice(props: { count: number; files: DiffFile[] }) {
  const { theme } = useTheme()
  const keybind = useKeybind()
  const command = useCommandDialog()
  const dialog = useDialog()
  const [hover, setHover] = createSignal(false)

  const onClick = async () => {
    const ok = await DialogConfirm.show(
      dialog,
      "Confirm Redo",
      "Are you sure you want to restore the reverted messages?",
    )
    if (ok) command.trigger("session.redo")
  }

  return (
    <box
      onMouseOver={() => setHover(true)}
      onMouseOut={() => setHover(false)}
      onMouseUp={onClick}
      marginTop={1}
      flexShrink={0}
      border={["left"]}
      customBorderChars={SplitBorder.customBorderChars}
      borderColor={theme.backgroundPanel}
    >
      <box
        paddingTop={1}
        paddingBottom={1}
        paddingLeft={2}
        backgroundColor={hover() ? theme.backgroundElement : theme.backgroundPanel}
      >
        <text fg={theme.textMuted}>
          {props.count} message{props.count === 1 ? "" : "s"} reverted
        </text>
        <text fg={theme.textMuted}>
          <span style={{ fg: theme.text }}>{keybind.print("messages_redo")}</span> or /redo to restore
        </text>
        <Show when={props.files.length}>
          <box marginTop={1}>
            <For each={props.files}>
              {(file) => (
                <text fg={theme.text}>
                  {file.filename}
                  <Show when={file.additions > 0}>
                    <span style={{ fg: theme.diffAdded }}> +{file.additions}</span>
                  </Show>
                  <Show when={file.deletions > 0}>
                    <span style={{ fg: theme.diffRemoved }}> -{file.deletions}</span>
                  </Show>
                </text>
              )}
            </For>
          </box>
        </Show>
      </box>
    </box>
  )
}
