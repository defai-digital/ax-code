import { useLanguage } from "@tui/context/language"
import { createMemo, Show, type Accessor } from "solid-js"
import { useSync } from "@tui/context/sync"
import { useTheme } from "../../context/theme"
import { useCommandDialog } from "../../component/dialog-command"
import { disabledProviderIDs } from "../../component/provider-list-view-model"
import { footerSessionStatusOrIdle, footerSessionStatusView } from "./footer-view-model"
import { sessionTopBarLayout } from "./top-bar-view-model"

// Slim bar pinned to the top of the session route. It carries the session
// identity block (title, live status, share URL) and the providers entry
// that previously sat at the top of the docked sidebar, so both stay visible
// at the top regardless of sidebar visibility. The title is only needed when
// the route header is not already showing it.
//
// The raw session id is deliberately not shown here: as an opaque identifier it
// cluttered the bar and read as noise. It stays reachable through `/copy`, which
// includes a "Session ID" line in the copied transcript.
export function SessionTopBar(props: {
  sessionID: string
  width: number
  showTitle: boolean
  statusTick?: Accessor<number>
}) {
  const uiText = useLanguage().t
  const sync = useSync()
  const { theme } = useTheme()
  const command = useCommandDialog()

  const session = createMemo(() => sync.session.get(props.sessionID))

  const statusView = createMemo(() => {
    props.statusTick?.()
    const current = footerSessionStatusOrIdle(sync.data.session_status?.[props.sessionID])
    if (current.type === "idle") return undefined
    return footerSessionStatusView({ status: current, now: Date.now() })
  })
  const statusColor = createMemo(() => {
    switch (statusView()?.tone) {
      case "success":
        return theme.success
      case "warning":
        return theme.warning
      case "working":
        return theme.accent
      case "muted":
      default:
        return theme.textMuted
    }
  })

  const connectedProviders = createMemo(() => sync.data.provider)
  const disabledProviders = createMemo(() =>
    disabledProviderIDs(
      sync.data.config,
      sync.data.provider.map((provider) => provider.id),
    ),
  )
  // Same rule the sidebar section followed: keep the providers entry visible
  // even when every provider is disabled, otherwise the only path back to
  // re-enable disappears.
  const hasProviderSection = createMemo(() => connectedProviders().length > 0 || disabledProviders().length > 0)

  function manage() {
    command.trigger("provider.manage")
  }

  const layout = createMemo(() =>
    sessionTopBarLayout({
      // The bar's own horizontal padding consumes two cells of the pane width.
      width: Math.max(0, props.width - 2),
      segments: {
        title: props.showTitle ? session()?.title : undefined,
        status: statusView()?.label,
        share: session()?.share?.url,
        providers: hasProviderSection() ? `${uiText("ui.providers")} (${connectedProviders().length})` : undefined,
      },
    }),
  )

  return (
    <box
      height={1}
      flexShrink={0}
      flexDirection="row"
      justifyContent="space-between"
      paddingLeft={1}
      paddingRight={1}
      backgroundColor={theme.backgroundPanel}
    >
      <box flexGrow={1} minWidth={0} flexDirection="row" gap={2}>
        <Show when={layout().title}>
          {(title) => (
            <text fg={theme.text} wrapMode="none" selectable={false}>
              <b>{title()}</b>
            </text>
          )}
        </Show>
        <Show when={layout().status}>
          {(status) => (
            <text fg={statusColor()} wrapMode="none" selectable={false}>
              {status()}
            </text>
          )}
        </Show>
        <Show when={layout().share}>
          {(url) => (
            <text fg={theme.textMuted} wrapMode="none" selectable={false}>
              {url()}
            </text>
          )}
        </Show>
      </box>
      <Show when={layout().providers}>
        {(providers) => (
          <box flexShrink={0} flexDirection="row">
            <text fg={theme.text} wrapMode="none" selectable={false} onMouseUp={manage}>
              {providers()}
            </text>
          </box>
        )}
      </Show>
    </box>
  )
}
