import { useLanguage } from "@tui/context/language"
import { Show } from "solid-js"
import { useTheme } from "@tui/context/theme"
import { useCommandDialog } from "./dialog-command"
import type { SetupGuidance } from "./setup-guidance"

/** Action first, explanation on its own wrapping line, with no modal state. */
export function SetupGuidanceView(props: { guidance: SetupGuidance; compact?: boolean }) {
  const { t } = useLanguage()
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
          {t("setup.introduction")}
        </text>
        <box flexShrink={0} onMouseUp={() => command.trigger("help.show")}>
          <text flexShrink={0} fg={theme.accent} selectable={false} wrapMode="word">
            {t("setup.help")}
          </text>
        </box>
      </Show>
      <Show when={!props.compact}>
        <box flexShrink={0} onMouseUp={() => command.trigger("session.navigation")}>
          <text flexShrink={0} fg={theme.textMuted} selectable={false} wrapMode="word">
            {t("setup.navigation")}
          </text>
        </box>
        <box flexShrink={0} onMouseUp={() => command.trigger("session.sidebar.toggle")}>
          <text flexShrink={0} fg={theme.textMuted} selectable={false} wrapMode="word">
            {t("setup.sidebar")}
          </text>
        </box>
      </Show>
    </box>
  )
}
