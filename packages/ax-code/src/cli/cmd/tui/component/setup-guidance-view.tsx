import { Show } from "solid-js"
import { useTheme } from "@tui/context/theme"
import { useCommandDialog } from "./dialog-command"
import type { SetupGuidance } from "./setup-guidance"

/** Action first, explanation on its own wrapping line, with no modal state. */
export function SetupGuidanceView(props: { guidance: SetupGuidance }) {
  const { theme } = useTheme()
  const command = useCommandDialog()
  return (
    <box flexDirection="column" width="100%" maxWidth={75} paddingLeft={2} paddingRight={2} flexShrink={0}>
      <Show when={props.guidance.action}>
        {(action) => (
          <box onMouseUp={() => command.trigger(action().command)}>
            <text fg={theme.accent} selectable={false} wrapMode="word">
              {action().label}
            </text>
          </box>
        )}
      </Show>
      <Show when={props.guidance.message}>
        <text fg={props.guidance.state === "failed" ? theme.warning : theme.textMuted} wrapMode="word">
          {props.guidance.message}
        </text>
      </Show>
      <Show when={props.guidance.showIntroduction}>
        <text fg={theme.text} wrapMode="word">
          Type a question to start. Use @ to attach files or invoke subagents.
        </text>
        <box onMouseUp={() => command.trigger("help.show")}>
          <text fg={theme.accent} selectable={false} wrapMode="word">
            /help - commands and shortcuts
          </text>
        </box>
      </Show>
      <box onMouseUp={() => command.trigger("session.navigation")}>
        <text fg={theme.textMuted} selectable={false} wrapMode="word">
          /navigation - sessions and agents
        </text>
      </box>
    </box>
  )
}
