import { createMemo, Show } from "solid-js"
import { useSDK } from "@tui/context/sdk"
import { useSync } from "@tui/context/sync"
import { useTheme } from "@tui/context/theme"
import { useCommandDialog } from "./dialog-command"
import { knownAttentionRequests } from "../util/session-activity"
import { projectLabel } from "../navigation/navigation-model"
import { truncateToCellWidth } from "../routes/session/last-input-view-model"

/** A visible navigation entry survives both responsive collapse and opt-out. */
export function NavigationBar(props: { width: number }) {
  const sdk = useSDK()
  const sync = useSync()
  const { theme } = useTheme()
  const command = useCommandDialog()
  const pending = createMemo(() => knownAttentionRequests(sync.data.permission, sync.data.question).length)
  const entry = () => (props.width >= 24 && (!pending() || props.width >= 40) ? "Sessions /navigation" : "Sessions")
  const attentionLabel = () => `Pending ${pending()}${sdk.sseConnected ? "" : "*"}`
  const projectWidth = () => props.width - 1 - entry().length - 2 - (pending() ? attentionLabel().length + 2 : 0)
  return (
    <box height={1} flexShrink={0} flexDirection="row" gap={2} paddingLeft={1} backgroundColor={theme.backgroundPanel}>
      <box flexShrink={0} onMouseUp={() => command.trigger("session.navigation")}>
        <text fg={theme.accent} selectable={false}>
          {entry()}
        </text>
      </box>
      <Show when={pending() > 0}>
        <box flexShrink={0} onMouseUp={() => command.trigger("session.attention")}>
          <text fg={theme.warning} selectable={false}>
            {attentionLabel()}
          </text>
        </box>
      </Show>
      <Show when={projectWidth() >= 12}>
        <box onMouseUp={() => command.trigger("session.navigation.info")}>
          <text fg={theme.textMuted} selectable={false}>
            {truncateToCellWidth(projectLabel(sdk.directory ?? sync.data.path.directory), projectWidth())}
          </text>
        </box>
      </Show>
    </box>
  )
}
