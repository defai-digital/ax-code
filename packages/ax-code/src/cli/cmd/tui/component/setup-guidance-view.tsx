import { Show } from "solid-js"
import { useTheme } from "@tui/context/theme"
import { useCommandDialog } from "./dialog-command"
import type { SetupGuidance } from "./setup-guidance"

/** Action first, explanation on its own wrapping line, with no modal state. */
export function SetupGuidanceView(props: { guidance: SetupGuidance; compact?: boolean }) {
  const { theme } = useTheme()
  const command = useCommandDialog()
  return (
    <box flexDirection="column" width="100%" flexShrink={0}>
      <Show when={props.guidance.action}>
        {(action) => (
          <box flexShrink={0} onMouseUp={() => command.trigger(action().command)}>
            <text flexShrink={0} fg={theme.accent} selectable={false} wrapMode="word">
              {action().label}
            </text>
          </box>
        )}
      </Show>
      <Show when={props.guidance.message && (!props.compact || !props.guidance.action)}>
        <text flexShrink={0} fg={props.guidance.state === "failed" ? theme.warning : theme.textMuted} wrapMode="word">
          {props.guidance.message}
        </text>
      </Show>
      <Show when={props.guidance.showIntroduction && !props.compact}>
        <text flexShrink={0} fg={theme.text} wrapMode="word">
          Type a question to start. Use @ to attach files or invoke subagents.
        </text>
        <box flexShrink={0} onMouseUp={() => command.trigger("help.show")}>
          <text flexShrink={0} fg={theme.accent} selectable={false} wrapMode="word">
            /help - commands and shortcuts
          </text>
        </box>
      </Show>
      <Show when={!props.compact}>
        <box flexShrink={0} onMouseUp={() => command.trigger("session.navigation")}>
          <text flexShrink={0} fg={theme.textMuted} selectable={false} wrapMode="word">
            /navigation - sessions and agents
          </text>
        </box>
        <box flexShrink={0} onMouseUp={() => command.trigger("session.sidebar.toggle")}>
          <text flexShrink={0} fg={theme.textMuted} selectable={false} wrapMode="word">
            /sidebar - session context
          </text>
        </box>
      </Show>
    </box>
  )
}
